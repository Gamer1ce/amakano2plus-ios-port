"""Resumable native asset conversion, without extracting original .int files.

python3 -m portkit.assets --source /path/to/Amakano2Plus_Mac_Handoff.zip
python3 -m portkit.assets --source /path/to/zip --all --kind image --limit 100
Native dependencies: Python, Pillow, NumPy and FFmpeg. Originals stay read-only.
"""
from pathlib import Path
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import gzip
import json
import shutil
import struct
import subprocess
import tempfile
import threading
import time
from PIL import Image
from .kif import GameSource
from .hg3 import read_frames

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "game-data"
EXTENSIONS = {".hg3": "image", ".psz": "emote", ".ogg": "audio", ".mpg": "movie"}


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def inventory():
    entries = json.loads((DATA / "catalog/catalog.json").read_text(encoding="utf-8"))
    def priority(entry):
        name = entry["archive"].casefold()
        return (3 if name.startswith("cndate") else 2 if name.startswith("update") else 1, name)
    return {entry["name"].casefold(): entry for entry in sorted((e for e in entries if "name" in e), key=priority)}


def preview_assets(index):
    wanted = set()
    profiles = json.loads((DATA / "converted/profiles.json").read_text(encoding="utf-8"))
    trace = json.loads((DATA / "converted/preview-trace.json").read_text(encoding="utf-8"))
    for row in trace["commands"]:
        command, parts = row["command"], row["args"].split()
        if command in ("bg", "cg", "fg", "eg", "fw", "pl", "mpl") and len(parts) >= 2:
            token = parts[1].split(":")[0].split(",")
            key = token[0].casefold()
            if key in profiles and len(token) >= 2:
                profile = profiles[key]["variants"].get(token[1])
                if profile: wanted.add(profile["model"].casefold() + ".psz")
            elif key + ".hg3" in index:
                wanted.add(key + ".hg3")
            else:
                # CG comma parameters are layers, not HG3 frame IDs.
                for layer, value in enumerate(token[1:]):
                    suffix = "0" * layer + value
                    if value != "0" and key + "_" + suffix + ".hg3" in index:
                        wanted.add(key + "_" + suffix + ".hg3")
        if command == "pcm" and parts and parts[0].casefold() + ".ogg" in index:
            wanted.add(parts[0].casefold() + ".ogg")
        if command in ("bgm", "se") and len(parts) >= 2 and parts[1].casefold() + ".ogg" in index:
            wanted.add(parts[1].casefold() + ".ogg")
        if command == "movie" and parts:
            candidates = [part.casefold() for part in parts]
            for name in candidates:
                name = name if name.endswith(".mpg") else name + ".mpg"
                if name in index: wanted.add(name)
    return wanted


def validate_asset(asset, output):
    kind = asset["kind"]
    if kind == "image":
        if not asset["frames"]: raise ValueError("Image has no frames")
        for frame in asset["frames"]:
            with Image.open(output / frame["file"]) as image:
                image.verify()
                if image.size != (frame["width"], frame["height"]):
                    raise ValueError("Converted image dimensions mismatch")
    elif kind == "emote":
        with gzip.open(output / asset["file"], "rb") as stream:
            header = stream.read(8)
            if header[:4] != b"PSB\0" or struct.unpack_from("<H", header, 4)[0] != 3:
                raise ValueError("Expected PSB v3 model")
            while stream.read(1024 * 1024): pass
    elif kind in ("audio", "movie"):
        path = output / asset["file"]
        size = path.stat().st_size
        atoms = set()
        with path.open("rb") as stream:
            at = 0
            while at < size:
                header = stream.read(8)
                if len(header) != 8: raise ValueError("Truncated MP4 atom header")
                length, tag = struct.unpack(">I4s", header)
                minimum = 8
                if length == 1:
                    extra = stream.read(8)
                    if len(extra) != 8: raise ValueError("Truncated MP4 extended size")
                    length, = struct.unpack(">Q", extra)
                    minimum = 16
                elif length == 0:
                    length = size - at
                if length < minimum or at + length > size:
                    raise ValueError("MP4 atom outside file")
                atoms.add(tag)
                at += length
                stream.seek(at)
        if not {b"ftyp", b"moov", b"mdat"}.issubset(atoms):
            raise ValueError("Converted media missing MP4 atoms")
    else:
        raise ValueError(f"Unknown asset kind: {kind}")


def transcode(ffmpeg, raw, target, movie=False):
    target.parent.mkdir(parents=True, exist_ok=True)
    # Temporary files live beside the output and are deleted after each entry.
    # H.264/AAC yields an iOS compatible container; decoder errors are fatal.
    with tempfile.TemporaryDirectory(prefix=".convert-", dir=target.parent) as tmp:
        source = Path(tmp) / ("source.mpg" if movie else "source.ogg")
        source.write_bytes(raw)
        prepared = Path(tmp) / target.name
        args = [ffmpeg, "-v", "error", "-xerror", "-nostdin", "-y", "-i", str(source)]
        if movie:
            args += ["-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"]
        else:
            args += ["-vn", "-map", "0:a:0"]
        args += ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(prepared)]
        result = subprocess.run(args, capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr.decode("utf-8", errors="replace")[-4000:])
        if not prepared.exists(): raise RuntimeError("FFmpeg produced no media")
        prepared.replace(target)


def convert(entry, raw, output, ffmpeg):
    name = entry["name"]
    stem, extension = Path(name).stem.casefold(), Path(name).suffix.casefold()
    base = {"kind": EXTENSIONS[extension], "origin": entry["archive"]}
    if extension == ".hg3":
        folder = output / "assets/images"
        folder.mkdir(parents=True, exist_ok=True)
        converted = []
        occurrences = {}
        for frame in read_frames(raw):
            identifier = frame.metadata['id']
            occurrence = occurrences.get(identifier, 0)
            occurrences[identifier] = occurrence + 1
            suffix = f"_{occurrence}" if occurrence else ""
            # Preserve repeated source IDs without overwriting an earlier
            # frame. List order and the logical ID remain unchanged.
            target = folder / f"{stem}_{identifier}{suffix}.webp"
            temporary = target.with_suffix(".tmp.webp")
            try:
                frame.image.save(temporary, format="WEBP", quality=92, method=5)
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
                frame.image.close()
            converted.append({**frame.metadata, "file": target.relative_to(output).as_posix()})
        return {**base, "frames": converted}
    if extension in (".ogg", ".mpg"):
        movie = extension == ".mpg"
        target = output / ("assets/movies" if movie else "assets/audio") / (stem + (".mp4" if movie else ".m4a"))
        transcode(ffmpeg, raw, target, movie)
        return {**base, "file": target.relative_to(output).as_posix()}
    if extension == ".psz":
        # A portable model converter can supply this documented function.
        try:
            from .psb import convert_psz_to_v3
        except ImportError as exc:
            raise RuntimeError("Portable PSZ v4 to PSB v3/ems conversion is unavailable; existing verified models can be reused") from exc
        pure = convert_psz_to_v3(raw)
        if pure[:4] != b"PSB\0" or struct.unpack_from("<H", pure, 4)[0] != 3:
            raise ValueError("Model converter did not produce PSB v3")
        target = output / "assets/emote" / (stem + ".psb.gz")
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(".tmp.gz")
        try:
            with temporary.open("wb") as dest:
                with gzip.GzipFile(filename="", mode="wb", fileobj=dest, compresslevel=6, mtime=0) as compressed:
                    compressed.write(pure)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        return {**base, "file": target.relative_to(output).as_posix()}
    raise ValueError(f"Unsupported original extension: {extension}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DATA / "original/2+", help="Original game directory or stored handoff ZIP")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--only", action="append", default=[], help="Exact original filename; repeat for multiple files")
    parser.add_argument("--kind", choices=sorted(set(EXTENSIONS.values())), action="append")
    parser.add_argument("--limit", type=int, help="Maximum selected assets, for bounded batches")
    parser.add_argument("--force", action="store_true", help="Rebuild assets whose original archive is unchanged")
    parser.add_argument("--output", type=Path, default=DATA / "converted")
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    parser.add_argument("--workers", type=int, default=1, help="Parallel conversion jobs with independent archive readers")
    parser.add_argument("--checkpoint", type=int, default=10, help="Save manifests every N completed assets")
    parser.add_argument("--min-free-gb", "--min-free-gib", type=float, default=12, help="Stop before a job if free output disk space is below this many GiB")
    args = parser.parse_args(argv)
    if args.limit is not None and args.limit < 1: parser.error("--limit must be positive")
    if not 1 <= args.workers <= 8: parser.error("--workers must be between 1 and 8")
    if args.checkpoint < 1: parser.error("--checkpoint must be positive")
    if args.min_free_gb < 0: parser.error("--min-free-gb cannot be negative")
    if not args.source.exists(): parser.error("Original source missing; pass --source with the Desktop handoff ZIP")
    index = inventory()
    full = {name for name in index if Path(name).suffix in EXTENSIONS}
    wanted = set(name.casefold() for name in args.only) if args.only else full if args.all else preview_assets(index)
    missing = wanted - index.keys()
    if missing: parser.error(f"Original assets missing: {sorted(missing)}")
    if args.kind: wanted = {name for name in wanted if EXTENSIONS.get(Path(name).suffix) in args.kind}
    wanted = sorted(wanted)
    if args.limit: wanted = wanted[:args.limit]
    if any(name.endswith((".ogg", ".mpg")) for name in wanted) and not args.ffmpeg:
        parser.error("Native FFmpeg missing; install ffmpeg or supply --ffmpeg")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    manifest = output / "assets.json"
    assets = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else {}
    started = time.time()
    failures, prepared, reused = [], [], []
    report = {}
    def save():
        report.update(completeGame=False, completeAssets=len(wanted) == len(full) and not failures and len(prepared) + len(reused) == len(full),
            pipeline="native-python-ffmpeg", source=str(args.source.resolve()), requested=len(wanted), prepared=len(prepared), reused=len(reused),
            indexedAssets=len(assets), totalRequiredAssets=len(full), failures=failures, elapsedSeconds=round(time.time() - started, 3),
            readiness="Asset coverage alone does not verify complete engine compatibility or iPhone operation")
        atomic_json(manifest, assets)
        atomic_json(output / "asset-report.json", report)
    # Workers never share stream positions or write manifests. Keep the full
    # original index cached independently per worker to make bounded ZIP seeks
    # cheap even when a voice archive contains thousands of entries.
    readers = []
    local = threading.local()
    def prepare(name):
        entry = index[name]
        try:
            if shutil.disk_usage(output).free < args.min_free_gb * 1024**3:
                return name, None, False, f"Disk reserve reached ({args.min_free_gb:g} GiB required)"
            existing = assets.get(Path(name).stem.casefold())
            if existing and existing.get("kind") == "image" and any("baseX" not in frame or "baseY" not in frame for frame in existing.get("frames", [])):
                existing = None
            if existing and existing.get("origin") == entry["archive"] and not args.force:
                try:
                    validate_asset(existing, output)
                except (ValueError, OSError, EOFError, struct.error):
                    pass
                else:
                    return name, existing, True, None
            if not hasattr(local, "source"):
                local.source = GameSource(args.source)
                readers.append(local.source)
            raw = local.source.archive(entry["archive"]).read(name)
            asset = convert(entry, raw, output, args.ffmpeg)
            validate_asset(asset, output)
            return name, asset, False, None
        except Exception as exc:
            return name, None, False, str(exc)
    completed = 0
    try:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(prepare, name): name for name in wanted}
            for future in as_completed(futures):
                name, asset, was_reused, error = future.result()
                if error:
                    failures.append({"asset": name, "archive": index[name]["archive"], "error": error})
                    print(f"FAILED {name}: {error}", flush=True)
                    if error.startswith("Disk reserve reached"):
                        report["halted"] = error
                        for pending in futures: pending.cancel()
                        break
                else:
                    assets[Path(name).stem.casefold()] = asset
                    (reused if was_reused else prepared).append(name)
                    print(f"{'REUSED' if was_reused else 'OK'} {name}", flush=True)
                completed += 1
                if completed % args.checkpoint == 0: save()
    finally:
        for reader in readers: reader.close()
    save()
    print(json.dumps(report, ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
