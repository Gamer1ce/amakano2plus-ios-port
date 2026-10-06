#!/usr/bin/env python3
"""Report environment and release blockers without claiming an iOS build ran."""
from pathlib import Path
import argparse
import json
import plistlib
import shutil
import subprocess
from content_validation import RELEASE_CHECKS, complete_asset_coverage, payload_digest, release_checks, verify_content

ROOT = Path(__file__).resolve().parent.parent


def command(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=20)
        return result.returncode == 0, (result.stdout + result.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)


def inspect(preview):
    selected_ok, selected = command(["xcode-select", "-p"])
    xcode_ok, version = command(["xcodebuild", "-version"])
    sdk_ok, sdk = command(["xcrun", "--sdk", "iphoneos", "--show-sdk-version"])
    try:
        assets = json.loads((ROOT / "game-data/converted/asset-report.json").read_text(encoding="utf-8"))
        index = json.loads((ROOT / "game-data/converted/assets.json").read_text(encoding="utf-8"))
        complete_assets = complete_asset_coverage(assets, index)
    except (OSError, ValueError, AttributeError):
        complete_assets = False
    try:
        manifest = verify_content(ROOT / "ios/Content", preview)
        content = {"verified": True, "mode": manifest["mode"], "files": len(manifest["files"]), "contentSHA256": payload_digest(manifest)}
    except (OSError, ValueError, KeyError, TypeError) as error:
        content = {"verified": False, "error": str(error)}
    acceptance = release_checks(ROOT)
    return {
        "schemaVersion": 1,
        "developerDirectory": selected if selected_ok else None,
        "xcode": {"available": xcode_ok, "details": version},
        "iPhoneOSSDK": {"available": sdk_ok, "details": sdk},
        "swiftCLIAvailable": shutil.which("swiftc") is not None,
        "completeAssets": complete_assets,
        "preparedContent": content,
        "releaseAcceptance": acceptance,
        "nativeCompilation": "notRun",
        "deviceValidation": "notRun",
        "releaseReady": bool(xcode_ok and sdk_ok and complete_assets and acceptance["ready"] and content["verified"] and not preview),
    }


def verify_archive(path, preview):
    apps = sorted((path / "Products/Applications").glob("*.app"))
    if len(apps) != 1:
        raise ValueError(f"Expected one app in archive {path}; archive the requested mode first")
    app = apps[0]
    archived = verify_content(app / "Content", preview)
    prepared = verify_content(ROOT / "ios/Content", preview)
    if archived != prepared:
        raise ValueError("Archive content differs from the current prepared payload; archive again before export")
    info = plistlib.loads((app / "Info.plist").read_bytes())
    expected = "local.amakano2plus.preview" if preview else "local.amakano2plus"
    if info.get("CFBundleIdentifier") != expected:
        raise ValueError(f"Archive identity is not {expected}; archive the requested mode again")
    return {"verified": True, "app": str(app), "mode": archived["mode"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--require-xcode", action="store_true")
    parser.add_argument("--release", action="store_true", help="Fail unless assets and recorded native/engine acceptance are ready")
    parser.add_argument("--verify-archive", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--init-release-checklist", action="store_true")
    args = parser.parse_args()
    if args.init_release_checklist:
        checklist = ROOT / "checks/release-readiness.json"
        if not checklist.exists():
            checklist.parent.mkdir(exist_ok=True)
            checklist.write_text(json.dumps({"schemaVersion": 1, "contentSHA256": "", "checks": {name: {"status": "notRun", "evidence": ""} for name in RELEASE_CHECKS}}, indent=2) + "\n", encoding="utf-8")
    report = inspect(args.preview)
    failed = False
    if args.require_xcode and not (report["xcode"]["available"] and report["iPhoneOSSDK"]["available"]):
        failed = True
    if args.release and not report["releaseReady"]:
        failed = True
    if args.verify_archive:
        try:
            report["archive"] = verify_archive(args.verify_archive.resolve(), args.preview)
        except (OSError, ValueError, KeyError, TypeError) as error:
            report["archive"] = {"verified": False, "error": str(error)}
            failed = True
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    raise SystemExit(1 if failed else 0)
