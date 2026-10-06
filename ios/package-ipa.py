#!/usr/bin/env python3
"""Package a compiled device archive for later personal-account signing.

Mach-O checks establish device format and identity, not a successful launch.
This tool never supplies a placeholder executable or a provisioning profile.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import plistlib
import shutil
import stat
import struct
import tempfile
import zipfile
from typing import Optional

from content_validation import (file_record, payload_digest, release_checks, verify_content,
                                verify_resident_content_tree, unsigned_complete_content_checks)

ROOT = Path(__file__).resolve().parent.parent
APP_NAME = "AmakanoPort"


def verify_device_executable(file: Path) -> dict:
    """Require a thin, executable arm64 Mach-O built for iOS devices."""
    length = file.stat().st_size
    with file.open("rb") as source:
        header = source.read(32)
        if len(header) != 32:
            raise ValueError("App executable has no complete 64-bit Mach-O header")
        magic, cpu, subtype, file_type, count, command_bytes, flags, reserved = struct.unpack("<8I", header)
        if magic != 0xfeedfacf or cpu != 0x0100000c or file_type != 2:
            raise ValueError("App executable must be a thin arm64 MH_EXECUTE Mach-O, not a simulator or resource file")
        if not 1 <= count <= 4096 or not 8 * count <= command_bytes <= 8 * 1024 * 1024 or 32 + command_bytes > length:
            raise ValueError("App executable has invalid bounded Mach-O load commands")
        commands = source.read(command_bytes)
    offset = 0
    platform = None
    entry = None
    executable_ranges = []
    for _ in range(count):
        if offset + 8 > len(commands):
            raise ValueError("Truncated Mach-O load command")
        command, size = struct.unpack_from("<2I", commands, offset)
        if size < 8 or size % 8 or offset + size > len(commands):
            raise ValueError("Invalid Mach-O load command size")
        if command == 0x32:  # LC_BUILD_VERSION; arm64 simulators also use this command.
            if size < 24 or platform is not None:
                raise ValueError("Invalid or duplicate Mach-O platform declaration")
            platform, minimum_os, sdk, tools = struct.unpack_from("<4I", commands, offset + 8)
            if size != 24 + tools * 8:
                raise ValueError("Invalid Mach-O build-version tool records")
        elif command == 0x19:  # LC_SEGMENT_64
            if size < 72:
                raise ValueError("Truncated Mach-O segment")
            _, _, name, vm_address, vm_size, file_offset, file_size, max_protection, protection, sections, segment_flags = struct.unpack_from("<2I16s4Q4I", commands, offset)
            if size != 72 + sections * 80 or file_offset + file_size > length:
                raise ValueError("Invalid Mach-O segment file bounds")
            if protection & 4 and file_size:
                executable_ranges.append((file_offset, file_offset + file_size))
        elif command == 0x80000028:  # LC_MAIN
            if size != 24 or entry is not None:
                raise ValueError("Invalid or duplicate Mach-O entry point")
            entry, stack_size = struct.unpack_from("<2Q", commands, offset + 8)
        offset += size
    if offset != len(commands):
        raise ValueError("Mach-O load-command size does not match its header")
    if platform != 2:  # PLATFORM_IOS=2; PLATFORM_IOSSIMULATOR=7.
        raise ValueError("App executable is not built for iPhoneOS devices (LC_BUILD_VERSION platform must be iOS)")
    if entry is None or entry < 32 + command_bytes or not any(start <= entry < end for start, end in executable_ranges):
        raise ValueError("App executable has no valid entry point in a file-backed executable segment")
    if not file.stat().st_mode & 0o111:
        raise ValueError("App executable is missing Unix executable permissions")
    return {"architecture": "arm64", "platform": "iOS", "fileType": "MH_EXECUTE",
            "structurallyVerified": True, "launchVerified": False}


def artifact_scope_for(preview: bool, artifact_scope: Optional[str]) -> str:
    scope = artifact_scope if artifact_scope is not None else ("development-preview" if preview else "accepted-release")
    if scope not in ("development-preview", "unsigned-complete-assets", "accepted-release"):
        raise ValueError("Unknown IPA artifact scope")
    if bool(preview) != (scope == "development-preview"):
        raise ValueError("Preview content and IPA artifact scope conflict")
    return scope


def verify_archive(archive: Path, preview: bool, root: Path = ROOT, *, artifact_scope: Optional[str] = None) -> dict:
    scope = artifact_scope_for(preview, artifact_scope)
    apps = sorted((archive / "Products/Applications").glob("*.app"))
    if len(apps) != 1 or apps[0].name != APP_NAME + ".app" or apps[0].is_symlink() or not apps[0].is_dir():
        raise ValueError("Archive must contain exactly one compiled AmakanoPort.app")
    app = apps[0]
    paths = sorted(app.rglob("*"))
    for path in paths:
        if path.is_symlink() or not path.resolve().is_relative_to(app.resolve()) or not (path.is_dir() or path.is_file()):
            raise ValueError(f"App bundle contains a symlink, external path, or unsupported file: {path}")
    if (app / "embedded.mobileprovision").exists() or (app / "_CodeSignature").exists():
        raise ValueError("Unsigned packaging requires an archive built without a personal signing profile or bundle signature")
    if scope == "unsigned-complete-assets":
        verify_resident_content_tree(app)
    info = plistlib.loads((app / "Info.plist").read_bytes())
    wanted_id = "local.amakano2plus.preview" if preview else "local.amakano2plus"
    if (info.get("CFBundleIdentifier") != wanted_id or info.get("CFBundleExecutable") != APP_NAME
            or info.get("CFBundlePackageType") != "APPL" or info.get("LSRequiresIPhoneOS") is not True
            or info.get("CFBundleSupportedPlatforms") != ["iPhoneOS"]):
        raise ValueError("Archive Info.plist must identify the requested iPhoneOS app and its compiled executable")
    binary = verify_device_executable(app / APP_NAME)
    if scope == "unsigned-complete-assets":
        verify_resident_content_tree(root / "ios/Content")
    archived = verify_content(app / "Content", preview)
    prepared = verify_content(root / "ios/Content", preview)
    if archived != prepared:
        raise ValueError("Archive content differs from the current prepared payload; rebuild before packaging")
    coverage = None
    acceptance = None
    if scope == "unsigned-complete-assets":
        coverage = unsigned_complete_content_checks(app / "Content", archived)
        if unsigned_complete_content_checks(root / "ios/Content", prepared) != coverage:
            raise ValueError("Unsigned complete inventory differs from prepared payload")
        # This is diagnostic metadata. A self-signable artifact is not evidence
        # that the game, rendered routes or a signed iPad installation passed.
        acceptance = release_checks(root)
    elif not preview:
        acceptance = release_checks(root)
        if not acceptance["ready"]:
            raise ValueError("Full-game release acceptance is incomplete: " + "; ".join(acceptance["blockers"]))
    records = {}
    for path in paths:
        if path.is_file():
            name = path.relative_to(app).as_posix()
            content_name = name.removeprefix("Content/") if name.startswith("Content/") else None
            record = archived["files"].get(content_name) if content_name is not None else None
            records[name] = {**(record or file_record(path)), "mode": stat.S_IMODE(path.stat().st_mode)}
    return {"app": app, "records": records, "directories": [""] + [path.relative_to(app).as_posix() for path in paths if path.is_dir()],
            "binary": binary, "mode": archived["mode"], "completeAssets": archived["completeAssets"],
            "contentSHA256": payload_digest(archived), "bundleIdentifier": wanted_id,
            "artifactScope": scope, "assetCoverage": coverage, "releaseAcceptance": acceptance}


def zip_info(name: str, mode: int, directory: bool = False) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name)
    info.create_system = 3
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = ((stat.S_IFDIR if directory else stat.S_IFREG) | mode) << 16
    if directory:
        info.external_attr |= 0x10
    else:
        # Every file is streamed with force_zip64 below. Older Python zipfile
        # versions do not always upgrade the provided ZipInfo version fields.
        info.extract_version = info.create_version = 45
    return info


def verify_ipa(file: Path, archive: dict) -> None:
    prefix = "Payload/" + APP_NAME + ".app/"
    expected_files = {prefix + name: record for name, record in archive["records"].items()}
    expected_directories = {"Payload/"} | {prefix + (name + "/" if name else "") for name in archive["directories"]}
    with zipfile.ZipFile(file) as package:
        names = package.namelist()
        if len(names) != len(set(names)) or set(names) != set(expected_files) | expected_directories:
            raise ValueError("IPA contains duplicate, missing, or unexpected entries")
        for info in package.infolist():
            if info.filename in expected_directories:
                if not info.is_dir():
                    raise ValueError("IPA Payload/App directories are not represented as directories")
                continue
            expected = expected_files[info.filename]
            unix_mode = info.external_attr >> 16
            if not stat.S_ISREG(unix_mode) or stat.S_IMODE(unix_mode) != expected["mode"] or info.file_size != expected["bytes"]:
                raise ValueError(f"IPA file size or Unix permissions changed: {info.filename}")
            digest = hashlib.sha256()
            with package.open(info) as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
            if digest.hexdigest() != expected["sha256"]:
                raise ValueError(f"IPA file differs from the verified archive: {info.filename}")


def package_ipa(archive: Path, output: Path, preview: bool, root: Path = ROOT, *, artifact_scope: Optional[str] = None) -> dict:
    archive = archive.resolve()
    output = output.resolve()
    if output.suffix.lower() != ".ipa" or output.is_relative_to(archive) or output.is_relative_to((root / "ios/Content").resolve()):
        raise ValueError("IPA output must be a separate .ipa file outside the archive and prepared Content")
    verified = verify_archive(archive, preview, root, artifact_scope=artifact_scope)
    output.parent.mkdir(parents=True, exist_ok=True)
    required = sum(record["bytes"] for record in verified["records"].values())
    # Stored media plus ZIP headers; stream from the archive without another App copy.
    if shutil.disk_usage(output.parent).free < required + 64 * 1024 * 1024:
        raise ValueError("Insufficient disk space for the unsigned IPA; the compiled App remains intact")
    handle, temporary_name = tempfile.mkstemp(prefix=output.name + ".", suffix=".tmp", dir=output.parent)
    os.close(handle)
    temporary = Path(temporary_name)
    try:
        prefix = "Payload/" + APP_NAME + ".app/"
        with zipfile.ZipFile(temporary, "w", allowZip64=True) as package:
            package.writestr(zip_info("Payload/", 0o755, True), b"")
            for name in verified["directories"]:
                package.writestr(zip_info(prefix + (name + "/" if name else ""), 0o755, True), b"")
            for name, record in verified["records"].items():
                info = zip_info(prefix + name, record["mode"])
                info.file_size = record["bytes"]
                digest = hashlib.sha256()
                written = 0
                with (verified["app"] / name).open("rb") as source, package.open(info, "w", force_zip64=True) as target:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        target.write(chunk)
                        digest.update(chunk)
                        written += len(chunk)
                if written != record["bytes"] or digest.hexdigest() != record["sha256"]:
                    raise ValueError(f"App file changed while packaging: {name}")
        verify_ipa(temporary, verified)
        package_record = file_record(temporary)
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    report = {"schemaVersion": 1, "ipa": str(output), **package_record,
              "signing": "unsigned-requires-personal-account-signing", "mode": verified["mode"],
              "completeAssets": verified["completeAssets"], "fullGameAcceptance": verified["artifactScope"] == "accepted-release",
              "bundleIdentifier": verified["bundleIdentifier"], "contentSHA256": verified["contentSHA256"],
              "deviceBinary": verified["binary"], "files": len(verified["records"]),
              "archiveAndIPAIntegrityVerified": True, "deviceInstallationVerified": False}
    if verified["artifactScope"] == "unsigned-complete-assets":
        report.update({"artifactScope": verified["artifactScope"], "contentMode": verified["mode"],
                       "assetCoverage": verified["assetCoverage"], "releaseAcceptance": verified["releaseAcceptance"],
                       "iPadValidation": "notRun"})
    output.with_suffix(".ipa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--preview", action="store_true", help="Package a development preview without claiming full-game acceptance")
    modes.add_argument("--unsigned-complete-assets", action="store_true",
                       help="Package full assets for user signing while game/device acceptance stays unverified")
    parser.add_argument("--content-root", type=Path, default=ROOT,
                        help="Root containing the exact prepared ios/Content and optional release checklist")
    args = parser.parse_args()
    try:
        scope = "unsigned-complete-assets" if args.unsigned_complete_assets else None
        print(json.dumps(package_ipa(args.archive, args.output, args.preview, args.content_root, artifact_scope=scope), ensure_ascii=False, indent=2))
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        raise SystemExit(f"Cannot package unsigned IPA: {error}")
