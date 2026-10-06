"""Read bounded CatSystem voice metadata without changing the asset manifest.

python3 -m portkit.voice_metadata --source /path/to/handoff.zip

TAG layout is inferred from this game's original files: repeated 20-byte ASCII
labels followed by little-endian u32 time values. Milliseconds are supported by
deterministic original-audio duration checks, not an official binary-format
specification. The official pcmtag and wait documentation describes the tag
semantics. LPB headers/frame indexes are validated; mouth fields remain unmapped
and preserved in the read-only original archives. No lip animation is exported.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

from .kif import FormatError, GameSource

ROOT = Path(__file__).resolve().parent.parent
MAX_TAG_BYTES = 64 * 1024
MAX_LPB_BYTES = 4 * 1024 * 1024
MAX_AUDIO_BYTES = 16 * 1024 * 1024
MAX_CATALOG_BYTES = 32 * 1024 * 1024
REFERENCES = [
    "https://cs2.suki.jp/manual/data/text/pcmtag.html",
    "https://cs2.suki.jp/manual/scene/reference/unique/wait.html",
]


def decode_tags(raw):
    """Return label -> original u32 timestamp, preserving file record order.

    Nonmonotonic times are valid: label numbers need not describe time order.
    Reject duplicate labels instead of silently discarding a record in the map.
    """
    if not raw or len(raw) > MAX_TAG_BYTES or len(raw) % 24:
        raise FormatError("TAG must contain bounded, complete 24-byte records")
    tags = {}
    for at in range(0, len(raw), 24):
        field = raw[at:at + 20]
        label, separator, padding = field.partition(b"\0")
        if not label or any(c < 32 or c > 126 for c in label):
            raise FormatError("TAG label must be nonempty printable ASCII")
        if separator and any(padding):
            raise FormatError("TAG label has nonzero null padding")
        label = label.decode("ascii")
        if label in tags:
            raise FormatError("Duplicate TAG label is ambiguous")
        tags[label] = struct.unpack_from("<I", raw, at + 20)[0]
    return tags


def decode_lpb_header(raw):
    """Validate the observed LPD layout; keep all unidentified fields opaque."""
    if len(raw) < 20 or len(raw) > MAX_LPB_BYTES:
        raise FormatError("LPB header or bounded payload is invalid")
    signature, fps, record_bytes, records = struct.unpack_from("<4s3I", raw)
    if signature != b"LPD\0":
        raise FormatError("Unknown LPB signature")
    if fps != 60 or record_bytes != 32:
        raise FormatError("Unsupported LPB rate/record layout; original preserved")
    if len(raw) != 20 + records * record_bytes:
        raise FormatError("LPB record count does not match payload length")
    for frame in range(records):
        if struct.unpack_from("<I", raw, 20 + frame * record_bytes)[0] != frame:
            raise FormatError("LPB frame indexes are not sequential")
    return {"fps": fps, "recordBytes": record_bytes, "records": records,
            "unknownHeaderWordHex": raw[16:20].hex()}


def load_inventory(path):
    if path.stat().st_size > MAX_CATALOG_BYTES:
        raise FormatError("Catalog exceeds bounded input size")
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or len(rows) > 100_000:
        raise FormatError("Catalog must be a bounded entry list")
    def priority(entry):
        archive = entry["archive"].casefold()
        return (3 if archive.startswith("cndate") else
                2 if archive.startswith("update") else 1, archive)
    return {entry["name"].casefold(): entry
            for entry in sorted((e for e in rows if "name" in e), key=priority)}


def read_bounded(source, entry, maximum):
    """Check the actual archive entry before allocating/decrypting its bytes."""
    archive = source.archive(entry["archive"])
    actual = archive.entries.get(entry["name"].casefold())
    if actual is None:
        raise FormatError("Catalog metadata entry is missing from its archive")
    if actual.length > maximum:
        raise FormatError("Original metadata entry exceeds bounded input size")
    if actual.length != entry["length"]:
        raise FormatError("Catalog length differs from original archive entry")
    return archive.read(entry["name"])


def duration_samples(source, index, voices, sample_count, ffprobe):
    """Compare original OGG durations to deterministic TAG and LPB samples."""
    eligible = sorted(name for name, voice in voices.items()
                      if "tags" in voice and name + ".ogg" in index)
    if not ffprobe or not sample_count or not eligible:
        return {"status": "not-run", "reason": "No ffprobe, samples, or matching original audio", "samples": []}
    take = min(sample_count, len(eligible))
    selected = {eligible[round(i * (len(eligible) - 1) / max(1, take - 1))]
                for i in range(take)}
    # Always cover the two independently inspected markers, the longest marker,
    # multiple labels, and reversed storage order when matching audio exists.
    for name in ["aa_01_yu01_018", "dd_05_sa15h_010"]:
        if name in eligible: selected.add(name)
    selected.add(max(eligible, key=lambda name: max(voices[name]["tags"].values())))
    for predicate in [lambda times: len(times) > 1,
                      lambda times: times != sorted(times)]:
        match = next((name for name in eligible if predicate(list(voices[name]["tags"].values()))), None)
        if match: selected.add(match)
    samples, failures = [], []
    with tempfile.TemporaryDirectory(prefix="amakano-voice-metadata-") as folder:
        path = Path(folder) / "voice.ogg"
        for name in sorted(selected):
            entry = index[name + ".ogg"]
            try:
                path.write_bytes(read_bounded(source, entry, MAX_AUDIO_BYTES))
                result = subprocess.run(
                    [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
                    capture_output=True, text=True, timeout=20, check=True)
                duration_ms = float(json.loads(result.stdout)["format"]["duration"]) * 1000
                if not math.isfinite(duration_ms) or duration_ms <= 0:
                    raise ValueError("Original audio duration is not positive and finite")
                tag_max = max(voices[name]["tags"].values())
                sample = {"voice": name, "tagMs": voices[name]["tags"],
                          "originalAudioMs": round(duration_ms, 3),
                          "allTagsWithinAudio": tag_max <= duration_ms + 50,
                          "frameUnitWouldExceedAudio": tag_max * 1000 / 60 > duration_ms + 50}
                if "lip" in voices[name]:
                    lp_ms = voices[name]["lip"]["records"] * 1000 / 60
                    sample.update(lpbTimelineMs=round(lp_ms, 3),
                                  lpbMinusAudioMs=round(lp_ms - duration_ms, 3))
                samples.append(sample)
            except (OSError, ValueError, KeyError, FormatError, subprocess.SubprocessError) as exc:
                failures.append({"voice": name, "error": str(exc)})
    return {"status": "checked" if not failures else "partial", "samples": samples,
            "failures": failures, "allTagsWithinAudio": bool(samples) and all(s["allTagsWithinAudio"] for s in samples),
            "frameUnitExcludedBySamples": bool(samples) and all(s["frameUnitWouldExceedAudio"] for s in samples),
            "conclusion": "Milliseconds fit these original clips; binary time units are inferred, not officially specified"}


def atomic_json(path, value, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False,
                                   separators=(",", ":") if compact else None,
                                   indent=None if compact else 2) + "\n", encoding="utf-8")
    temporary.replace(path)


def export(source_path, catalog_path, output_path, report_path, sample_count=32, ffprobe=None):
    index = load_inventory(catalog_path)
    wanted = sorted(name for name in index if Path(name).suffix in (".tag", ".lpb"))
    voices, failures, nonmonotonic = {}, [], []
    tag_counts, label_counts, headers, lip_archives = Counter(), Counter(), Counter(), Counter()
    requested, decoded = Counter(Path(name).suffix[1:] for name in wanted), Counter()
    source_bytes = Counter()
    with GameSource(source_path) as source:
        for name in wanted:
            entry, stem = index[name], Path(name).stem
            extension = Path(name).suffix[1:]
            try:
                raw = read_bounded(source, entry, MAX_TAG_BYTES if extension == "tag" else MAX_LPB_BYTES)
                voice = voices.setdefault(stem, {})
                if extension == "tag":
                    tags = decode_tags(raw)
                    voice["tags"] = tags
                    tag_counts[len(tags)] += 1
                    label_counts.update(tags.keys())
                    if list(tags.values()) != sorted(tags.values()):
                        nonmonotonic.append({"voice": stem, "tags": tags})
                else:
                    header = decode_lpb_header(raw)
                    # Keep eager-loaded metadata small; raw fields stay in ZIP.
                    voice["lip"] = {"records": header["records"], "archive": entry["archive"]}
                    if header["unknownHeaderWordHex"] != "00002cc2":
                        voice["lip"]["unknownHeaderWordHex"] = header["unknownHeaderWordHex"]
                    headers[(header["fps"], header["recordBytes"], header["unknownHeaderWordHex"])] += 1
                    lip_archives[entry["archive"]] += 1
                decoded[extension] += 1
                source_bytes[extension] += len(raw)
            except (OSError, ValueError, KeyError) as exc:
                failures.append({"file": name, "archive": entry["archive"], "error": str(exc)})
        samples = duration_samples(source, index, voices, sample_count, ffprobe)
    generated = datetime.now(timezone.utc).isoformat()
    missing_audio = [name for name, voice in voices.items() if "tags" in voice and name + ".ogg" not in index]
    tag_origins = sorted({index[name]["archive"] for name in wanted if name.endswith(".tag")})
    metadata = {
        "formatVersion": 1, "generatedAt": generated, "timeUnit": "milliseconds",
        "timeUnitEvidence": "inferred-original-audio-duration-samples",
        "tagFormat": {"recordBytes": 24, "labelBytes": 20, "timestampType": "uint32-le",
                      "origins": tag_origins, "recordOrder": "preserved, may be nonmonotonic"},
        "lipFormat": {"status": "preserved-unsupported", "signature": "LPD\u0000", "headerBytes": 20,
                      "fps": 60, "recordBytes": 32, "unknownHeaderWordHex": "00002cc2",
                      "knownRecordField": "uint32-le sequential frame index at byte 0",
                      "unmappedRecordBytes": 28, "rawFramesExported": False,
                      "preservation": "Original .lpb remains in its read-only source archive; voice key + .lpb identifies it"},
        "voices": dict(sorted(voices.items())),
    }
    atomic_json(output_path, metadata, compact=True)
    report = {
        "generatedAt": generated, "source": str(source_path.resolve()), "catalog": str(catalog_path.resolve()),
        "output": str(output_path.resolve()), "outputBytes": output_path.stat().st_size,
        "outputSHA256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
        "requested": dict(requested), "decoded": dict(decoded), "sourceBytesRead": dict(source_bytes),
        "completeTagCoverage": decoded["tag"] == requested["tag"] and requested["tag"] > 0,
        "completeLpbHeaderCoverage": decoded["lpb"] == requested["lpb"] and requested["lpb"] > 0,
        "lipAnimationVerified": False, "completeGame": False,
        "tagRecords": sum(count * files for count, files in tag_counts.items()),
        "tagRecordCountHistogram": dict(sorted(tag_counts.items())), "tagLabels": dict(sorted(label_counts.items())),
        "nonmonotonicTagStorage": nonmonotonic, "tagsWithoutMatchingOriginalOgg": sorted(missing_audio),
        "lpbHeaders": [{"fps": key[0], "recordBytes": key[1], "unknownHeaderWordHex": key[2], "files": count}
                       for key, count in sorted(headers.items())], "lpbArchives": dict(lip_archives),
        "failures": failures, "durationEvidence": samples, "primaryReferences": REFERENCES,
        "evidenceScope": "Official docs establish per-voice tag semantics, lower-bank priority, and missing-tag fallback. Binary layout and time units are inferred from original files and audio checks. LPB mouth fields are unmapped.",
    }
    atomic_json(report_path, report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, default=ROOT / "game-data/catalog/catalog.json")
    parser.add_argument("--output", type=Path, default=ROOT / "game-data/converted/voice-metadata.json")
    parser.add_argument("--report", type=Path, default=ROOT / "checks/voice-metadata-validation.json")
    parser.add_argument("--duration-samples", type=int, default=32)
    parser.add_argument("--ffprobe", default=shutil.which("ffprobe"))
    args = parser.parse_args(argv)
    if not 0 <= args.duration_samples <= 128:
        parser.error("--duration-samples must be between 0 and 128")
    if not args.source.exists() or not args.catalog.exists():
        parser.error("Original source and catalog must exist")
    if args.output.name == "assets.json" or args.report.name == "assets.json":
        parser.error("Voice metadata must not overwrite the asset manifest")
    if args.output.resolve() == args.report.resolve():
        parser.error("Metadata and validation report require separate files")
    report = export(args.source, args.catalog, args.output, args.report, args.duration_samples, args.ffprobe)
    print(json.dumps({key: report[key] for key in ["decoded", "tagRecords", "outputBytes", "completeTagCoverage", "completeLpbHeaderCoverage", "lipAnimationVerified"]}))
    if report["failures"]:
        print(json.dumps({"failures": report["failures"]}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
