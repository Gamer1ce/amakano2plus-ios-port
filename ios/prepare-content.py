#!/usr/bin/env python3
"""Stage an exact, validated portable payload; never overlay a previous build."""
from pathlib import Path
import argparse
from datetime import datetime, timezone
from functools import partial
import json
import shutil
import tempfile
from content_validation import REQUIRED_PORTABLE_CONFIGS, complete_asset_coverage, confined_file, content_manifest, payload_digest, validate_voice_metadata
from portable_copy import copy_file

def prepare(root: Path, preview: bool, copy_stats=None) -> Path:
    source = root / "game-data/converted"
    report = json.loads((source / "asset-report.json").read_text(encoding="utf-8"))
    if report.get("completeAssets") is not True and not preview:
        raise ValueError("Full assets are not ready. Use --preview for development; read README.md.")
    if not isinstance(report.get("failures"), list) or (report["failures"] and not preview):
        raise ValueError("Asset conversion errors remain, or the conversion report is invalid")
    if preview and report["failures"]:
        print(f"Development preview: {len(report['failures'])} conversion failures remain in the full inventory; the report is included in Content.")
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    assets = json.loads((source / "assets.json").read_text(encoding="utf-8"))
    complete_assets = complete_asset_coverage(report, assets)
    scene_files = {"scenes/" + entry["file"] for entry in manifest["scenes"].values()}
    asset_files = set()
    for asset in assets.values():
        if asset["kind"] == "image":
            asset_files.update(frame["file"] for frame in asset["frames"])
        else:
            asset_files.add(asset["file"])
    data_files = scene_files | asset_files | set(REQUIRED_PORTABLE_CONFIGS)
    validated = {name: confined_file(source, name) for name in data_files}
    validate_voice_metadata(json.loads(validated["voice-metadata.json"].read_text(encoding="utf-8")))
    ios = root / "ios"
    target = ios / "Content"
    if target.is_symlink():
        raise ValueError("ios/Content must be a normal directory, not a symlink")
    stage = Path(tempfile.mkdtemp(prefix=".Content-stage-", dir=ios))
    backup = None
    copy = partial(copy_file, stats=copy_stats)
    try:
        shutil.copytree(root / "runtime", stage / "runtime", copy_function=copy, ignore=shutil.ignore_patterns("tests", "package.json", "trace.mjs", "emote-probe.html", "__pycache__"))
        shutil.copytree(ios / "diagnostics", stage / "diagnostics", copy_function=copy)
        for name, file in validated.items():
            destination = stage / "game-data/converted" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            copy(file, destination)
        payload = content_manifest(stage, "preview" if preview else "full", complete_assets)
        (stage / "content-manifest.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if target.exists():
            backup = Path(tempfile.mkdtemp(prefix=".Content-backup-", dir=ios))
            backup.rmdir()
            target.rename(backup)
        try:
            stage.rename(target)
        except BaseException:
            if backup is not None:
                backup.rename(target)
                backup = None
            raise
        if backup is not None:
            shutil.rmtree(backup)
        return target
    finally:
        if stage.exists():
            shutil.rmtree(stage)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true", help="Mark this payload as a development preview")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    free_before = shutil.disk_usage(root).free
    copy_stats = {"clonedFiles": 0, "clonedBytes": 0, "copiedFiles": 0, "copiedBytes": 0}
    try:
        target = prepare(root, args.preview, copy_stats)
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise SystemExit(f"Content preparation failed: {error}")
    print("Prepared", target, "(preview)" if args.preview else "(full assets; release acceptance is separate)")
    manifest = json.loads((target / "content-manifest.json").read_text(encoding="utf-8"))
    evidence = {"schemaVersion": 1, "preparedAtUTC": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "mode": manifest["mode"], "contentSHA256": payload_digest(manifest),
                "copyStrategy": "APFS clonefile with independent CoW inode; copy2 fallback where unsupported",
                "hardLinksUsed": False, "copyCounts": copy_stats,
                "payloadFiles": len(manifest["files"]), "payloadBytes": sum(item["bytes"] for item in manifest["files"].values()),
                "freeBytesBefore": free_before, "freeBytesAfter": shutil.disk_usage(root).free}
    (root / "checks").mkdir(exist_ok=True)
    (root / "checks/ios-staging.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False))
