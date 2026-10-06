"""Shared, dependency-free validation for staged iOS content and release evidence."""
from pathlib import Path
import hashlib
import json
import re
import stat

RELEASE_CHECKS = (
    "requiredCommands", "branchesAndEndings", "saveRestore", "wkSchemeModules",
    "gzipModels", "webglAnimation", "audioVideo", "landscapeChinese",
    "restartSaves", "memoryModelSwitches", "signedInstallation",
)
REQUIRED_PORTABLE_CONFIGS = ("manifest.json", "helpers.json", "profiles.json", "vram.json", "voice-metadata.json", "assets.json", "asset-report.json")


def verify_resident_content_tree(content: Path) -> None:
    """Reject placeholder or linked inputs before the unsigned artifact reads them."""
    for path in [content, *sorted(content.rglob("*"))]:
        info = path.lstat()
        if (stat.S_ISLNK(info.st_mode) or getattr(info, "st_flags", 0) & 0x40000000
                or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode))):
            raise ValueError(f"Unsigned complete content requires resident regular files/directories: {path}")


def unsigned_complete_content_checks(content: Path, manifest: dict) -> dict:
    """Validate full inventory coverage separately from game/device acceptance.

    Call after verify_content: its exact, rehashed file manifest remains the
    byte-integrity authority. These checks also require every converted scene
    and asset reference to occur in that manifest. Extra runtime resources must
    be staged by the final runtime's resource closure, not this legacy index.
    """
    if manifest.get("mode") != "full" or manifest.get("completeAssets") is not True:
        raise ValueError("Unsigned complete artifact requires full-mode complete assets")
    converted = content / "game-data/converted"
    def read_json(name):
        path = confined_file(converted, name)
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or getattr(info, "st_flags", 0) & 0x40000000:
            raise ValueError(f"Unsigned complete metadata must be resident: {name}")
        return json.loads(path.read_text(encoding="utf-8"))
    assets, report, scene_manifest = (read_json(name) for name in ("assets.json", "asset-report.json", "manifest.json"))
    if not isinstance(assets, dict) or not 1 <= len(assets) <= 100_000 or not isinstance(report, dict):
        raise ValueError("Unsigned complete artifact requires a bounded asset inventory")
    if not complete_asset_coverage(report, assets):
        raise ValueError("Unsigned complete artifact lacks complete asset coverage")
    scenes = scene_manifest.get("scenes") if isinstance(scene_manifest, dict) else None
    if not isinstance(scenes, dict) or not 1 <= len(scenes) <= 100_000:
        raise ValueError("Unsigned complete artifact requires a bounded scene inventory")
    references = set(REQUIRED_PORTABLE_CONFIGS)
    for scene in scenes.values():
        if not isinstance(scene, dict) or not isinstance(scene.get("file"), str):
            raise ValueError("Invalid unsigned complete scene reference")
        references.add("scenes/" + scene["file"])
    for asset in assets.values():
        if not isinstance(asset, dict):
            raise ValueError("Invalid unsigned complete asset reference")
        if asset.get("kind") == "image":
            frames = asset.get("frames")
            if not isinstance(frames, list) or not frames or len(frames) > 100_000:
                raise ValueError("Unsigned complete image requires bounded frames")
            for frame in frames:
                if not isinstance(frame, dict) or not isinstance(frame.get("file"), str):
                    raise ValueError("Invalid unsigned complete image frame reference")
                references.add(frame["file"])
        elif asset.get("kind") in ("audio", "emote", "movie") and isinstance(asset.get("file"), str):
            references.add(asset["file"])
        else:
            raise ValueError("Invalid unsigned complete asset kind/file")
    files = manifest.get("files", {})
    for name in references:
        confined_file(converted, name)
        if "game-data/converted/" + name not in files:
            raise ValueError(f"Unsigned complete reference missing from payload manifest: {name}")
    return {"completeAssets": True, "requiredAssets": report["totalRequiredAssets"],
            "indexedAssets": len(assets), "scenes": len(scenes), "referencedFiles": len(references)}


def validate_voice_metadata(value: dict) -> None:
    """Validate portable TAG times and opaque LPB summaries, not lip behavior."""
    if not isinstance(value, dict) or type(value.get("formatVersion")) is not int or value["formatVersion"] != 1:
        raise ValueError("Voice metadata formatVersion must be 1")
    if value.get("timeUnit") != "milliseconds":
        raise ValueError("Voice metadata must declare milliseconds")
    lip_format = value.get("lipFormat")
    if not isinstance(lip_format, dict) or lip_format.get("status") != "preserved-unsupported" or lip_format.get("rawFramesExported") is not False:
        raise ValueError("Voice metadata must preserve unsupported LPB data without claiming exported lip frames")
    voices = value.get("voices")
    if not isinstance(voices, dict) or len(voices) > 100_000:
        raise ValueError("Voice metadata voices must be a bounded object")
    for name, voice in voices.items():
        if not isinstance(name, str) or not name or any(char in name for char in "/\\\0") or not isinstance(voice, dict) or not ("tags" in voice or "lip" in voice):
            raise ValueError("Invalid voice metadata entry")
        if "tags" in voice:
            tags = voice["tags"]
            if not isinstance(tags, dict) or not tags or len(tags) > (64 * 1024) // 24:
                raise ValueError(f"Invalid bounded TAG labels for {name}")
            for label, milliseconds in tags.items():
                if (not isinstance(label, str) or not 1 <= len(label) <= 20 or any(ord(char) < 32 or ord(char) > 126 for char in label)
                        or type(milliseconds) is not int or not 0 <= milliseconds <= 0xffffffff):
                    raise ValueError(f"Invalid TAG label/timestamp for {name}")
        if "lip" in voice:
            lip = voice["lip"]
            if not isinstance(lip, dict) or type(lip.get("records")) is not int or not 0 <= lip["records"] <= (4 * 1024 * 1024 - 20) // 32:
                raise ValueError(f"Invalid opaque LPB record count for {name}")
            archive = lip.get("archive")
            if not isinstance(archive, str) or not archive.lower().endswith(".int") or any(char in archive for char in "/\\\0"):
                raise ValueError(f"Invalid LPB archive reference for {name}")
            if "unknownHeaderWordHex" in lip and (not isinstance(lip["unknownHeaderWordHex"], str) or not re.fullmatch(r"[0-9a-f]{8}", lip["unknownHeaderWordHex"])):
                raise ValueError(f"Invalid opaque LPB header word for {name}")


def complete_asset_coverage(report: dict, assets: dict) -> bool:
    if report.get("completeAssets") is not True:
        return False
    fields = ("totalRequiredAssets", "requested", "prepared", "reused", "indexedAssets")
    if any(type(report.get(name)) is not int or report[name] < 0 for name in fields):
        raise ValueError("Complete-asset report is missing valid coverage counts")
    if (report["totalRequiredAssets"] == 0 or report["requested"] != report["totalRequiredAssets"]
            or report["prepared"] + report["reused"] != report["requested"]
            or report["indexedAssets"] != len(assets)
            or len(assets) < report["totalRequiredAssets"] or report.get("failures") != []):
        raise ValueError("Complete-asset report does not cover the full inventory")
    return True


def confined_file(base: Path, name: str) -> Path:
    if not isinstance(name, str) or not name or Path(name).is_absolute():
        raise ValueError(f"Invalid portable file path: {name!r}")
    file = (base / name).resolve()
    if not file.is_relative_to(base.resolve()) or not file.is_file():
        raise ValueError(f"Missing or escaping portable file: {name}")
    return file


def file_record(file: Path) -> dict:
    digest = hashlib.sha256()
    with file.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"bytes": file.stat().st_size, "sha256": digest.hexdigest()}


def content_manifest(content: Path, mode: str, complete_assets: bool) -> dict:
    files = {}
    for file in sorted(content.rglob("*")):
        if file.is_symlink() or not file.resolve().is_relative_to(content.resolve()):
            raise ValueError(f"Content contains a symlink or external file: {file}")
        if file.is_file() and file.relative_to(content).as_posix() != "content-manifest.json":
            files[file.relative_to(content).as_posix()] = file_record(file)
    return {"schemaVersion": 1, "mode": mode, "completeAssets": complete_assets, "files": files}


def verify_content(content: Path, preview: bool) -> dict:
    manifest = json.loads((content / "content-manifest.json").read_text(encoding="utf-8"))
    wanted_mode = "preview" if preview else "full"
    if manifest.get("schemaVersion") != 1 or manifest.get("mode") != wanted_mode:
        raise ValueError(f"Prepared content is not {wanted_mode}; prepare/build it again with the requested mode")
    if not preview and manifest.get("completeAssets") is not True:
        raise ValueError("Prepared content does not contain complete assets")
    files = manifest.get("files")
    if not isinstance(files, dict) or any("game-data/converted/" + name not in files for name in REQUIRED_PORTABLE_CONFIGS):
        raise ValueError("Prepared content is missing required portable configuration; prepare/build it again")
    validate_voice_metadata(json.loads((content / "game-data/converted/voice-metadata.json").read_text(encoding="utf-8")))
    actual = content_manifest(content, wanted_mode, manifest.get("completeAssets") is True)
    if actual != manifest:
        raise ValueError("Prepared content has changed, missing, or unexpected files; prepare/build it again")
    return manifest


def payload_digest(manifest: dict) -> str:
    value = {"completeAssets": manifest["completeAssets"], "files": manifest["files"]}
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def release_checks(root: Path) -> dict:
    file = root / "checks/release-readiness.json"
    try:
        report = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return {"ready": False, "blockers": [f"Release checklist missing/unreadable: {error}"]}
    blockers = []
    if not isinstance(report, dict):
        return {"ready": False, "blockers": ["Release checklist must be a JSON object"]}
    if report.get("schemaVersion") != 1:
        blockers.append("Release checklist schemaVersion must be 1")
    checks = report.get("checks", {})
    if not isinstance(checks, dict):
        checks = {}
    try:
        manifest = json.loads((root / "ios/Content/content-manifest.json").read_text(encoding="utf-8"))
        if manifest.get("completeAssets") is not True:
            blockers.append("Release acceptance requires a complete asset payload")
        if report.get("contentSHA256") != payload_digest(manifest):
            blockers.append("Release acceptance does not match the prepared payload contentSHA256")
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        blockers.append(f"Release acceptance has no valid prepared payload: {error}")
    for name in RELEASE_CHECKS:
        value = checks.get(name, {})
        if not isinstance(value, dict) or value.get("status") != "passed":
            blockers.append(f"Release acceptance is unverified: {name}")
            continue
        try:
            evidence = confined_file(root, value.get("evidence"))
            if evidence.stat().st_size == 0:
                raise ValueError("Evidence is empty")
        except (OSError, ValueError, TypeError) as error:
            blockers.append(f"Release evidence is invalid for {name}: {error}")
    return {"ready": not blockers, "blockers": blockers}
