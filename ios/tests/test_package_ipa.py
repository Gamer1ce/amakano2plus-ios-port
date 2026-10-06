"""Exercise unsigned packaging with tiny synthetic Mach-O structure fixtures.

These fixtures are never executed and do not prove an iOS build or launch.
"""
from pathlib import Path
import importlib.util
import json
import plistlib
import shutil
import stat
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

IOS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(IOS))
from content_validation import content_manifest
spec = importlib.util.spec_from_file_location("package_ipa", IOS / "package-ipa.py")
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


def macho_fixture(platform=2, cpu=0x0100000c):
    commands_size = 72 + 24 + 24
    entry = 32 + commands_size
    text = struct.pack("<2I16s4Q4I", 0x19, 72, b"__TEXT", 0x100000000, 4096, 0, entry + 4, 5, 5, 0, 0)
    build = struct.pack("<6I", 0x32, 24, platform, 17 << 16, 26 << 16, 0)
    main = struct.pack("<2I2Q", 0x80000028, 24, entry, 0)
    header = struct.pack("<8I", 0xfeedfacf, cpu, 0, 2, 3, commands_size, 0, 0)
    return header + text + build + main + bytes.fromhex("c0035fd6")


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.content = self.root / "ios/Content"
        self.converted = self.content / "game-data/converted"
        self.converted.mkdir(parents=True)
        voice = {"formatVersion": 1, "timeUnit": "milliseconds",
                 "lipFormat": {"status": "preserved-unsupported", "rawFramesExported": False}, "voices": {}}
        for name in ["manifest.json", "helpers.json", "profiles.json", "vram.json", "assets.json", "asset-report.json"]:
            (self.converted / name).write_text("{}")
        (self.converted / "voice-metadata.json").write_text(json.dumps(voice))
        (self.content / "runtime").mkdir()
        (self.content / "runtime/index.html").write_text("Synthetic test payload")
        self.refresh_manifest()
        self.archive = self.root / "preview.xcarchive"
        self.app = self.archive / "Products/Applications/AmakanoPort.app"
        shutil.copytree(self.content, self.app / "Content")
        self.executable = self.app / "AmakanoPort"
        self.executable.write_bytes(macho_fixture())
        self.executable.chmod(0o755)
        self.info = {"CFBundleIdentifier": "local.amakano2plus.preview", "CFBundleExecutable": "AmakanoPort",
                     "CFBundlePackageType": "APPL", "LSRequiresIPhoneOS": True, "CFBundleSupportedPlatforms": ["iPhoneOS"]}
        self.write_info()
        self.output = self.root / "output/fixture.ipa"

    def tearDown(self):
        self.temp.cleanup()

    def refresh_manifest(self, mode="preview"):
        value = content_manifest(self.content, mode, True)
        (self.content / "content-manifest.json").write_text(json.dumps(value))

    def write_info(self):
        (self.app / "Info.plist").write_bytes(plistlib.dumps(self.info))

    def verify(self):
        return package.verify_archive(self.archive, True, self.root)

    def prepare_unsigned_complete(self):
        """A complete tiny inventory; byte fixture proves packaging, not play."""
        (self.converted / "scenes").mkdir(exist_ok=True)
        (self.converted / "scenes/a.json").write_text('{"lines":[]}')
        (self.converted / "assets").mkdir(exist_ok=True)
        (self.converted / "assets/a.m4a").write_bytes(b"synthetic asset")
        (self.converted / "manifest.json").write_text(json.dumps({"scenes": {"a": {"file": "a.json"}}}))
        (self.converted / "assets.json").write_text(json.dumps({"a": {"kind": "audio", "file": "assets/a.m4a"}}))
        (self.converted / "asset-report.json").write_text(json.dumps({
            "completeAssets": True, "completeGame": False, "totalRequiredAssets": 1,
            "requested": 1, "prepared": 1, "reused": 0, "indexedAssets": 1, "failures": []}))
        self.refresh_manifest(mode="full")
        shutil.rmtree(self.app / "Content")
        shutil.copytree(self.content, self.app / "Content")
        self.info["CFBundleIdentifier"] = "local.amakano2plus"
        self.write_info()

    def package_unsigned_complete(self):
        return package.package_ipa(self.archive, self.output, False, self.root,
                                   artifact_scope="unsigned-complete-assets")

    def test_standard_payload_integrity_and_executable_permissions(self):
        report = package.package_ipa(self.archive, self.output, True, self.root)
        self.assertTrue(report["completeAssets"])
        self.assertFalse(report["fullGameAcceptance"])
        self.assertFalse(report["deviceInstallationVerified"])
        self.assertFalse(report["deviceBinary"]["launchVerified"])
        self.assertEqual(report["signing"], "unsigned-requires-personal-account-signing")
        with zipfile.ZipFile(self.output) as ipa:
            self.assertIn("Payload/", ipa.namelist())
            self.assertEqual(ipa.read("Payload/AmakanoPort.app/AmakanoPort"), macho_fixture())
            entry = ipa.getinfo("Payload/AmakanoPort.app/AmakanoPort")
            self.assertEqual(stat.S_IMODE(entry.external_attr >> 16), 0o755)
            # Every streamed file has a ZIP64 local header even for the tiny fixture.
            # Inspect the actual local record, rather than only trusting the
            # central-directory ZipInfo version declared by the writer.
            with self.output.open("rb") as source:
                source.seek(entry.header_offset)
                header = source.read(30)
                self.assertEqual(struct.unpack_from("<I", header)[0], 0x04034b50)
                self.assertGreaterEqual(struct.unpack_from("<H", header, 4)[0], 45)
                name_length, extra_length = struct.unpack_from("<2H", header, 26)
                source.read(name_length)
                extra = source.read(extra_length)
            self.assertEqual(struct.unpack_from("<2H", extra), (1, 16))
            self.assertEqual(struct.unpack_from("<2Q", extra, 4), (len(macho_fixture()), len(macho_fixture())))
        package.verify_ipa(self.output, self.verify())
        self.assertEqual(json.loads(self.output.with_suffix(".ipa.json").read_text())["sha256"], report["sha256"])

    def test_simulator_mac_and_non_macho_are_rejected(self):
        for data in [macho_fixture(platform=7), macho_fixture(platform=1), macho_fixture(cpu=0x01000007),
                     b"Content zip is not an executable", macho_fixture()[:20]]:
            with self.subTest(data=data[:40]):
                self.executable.write_bytes(data)
                with self.assertRaises(ValueError):
                    self.verify()

    def test_truncated_commands_segments_and_entry_point_are_rejected(self):
        malformed = []
        value = bytearray(macho_fixture()); struct.pack_into("<I", value, 20, 0xffffff); malformed.append(value)
        value = bytearray(macho_fixture()); struct.pack_into("<I", value, 36, 9); malformed.append(value)
        value = bytearray(macho_fixture()); struct.pack_into("<Q", value, 80, 4096); malformed.append(value)
        value = bytearray(macho_fixture()); struct.pack_into("<Q", value, 136, 8); malformed.append(value)
        for data in malformed:
            with self.subTest(data=bytes(data[:40])):
                self.executable.write_bytes(data)
                with self.assertRaises(ValueError):
                    self.verify()
        self.executable.write_bytes(macho_fixture())
        self.executable.chmod(0o644)
        with self.assertRaises(ValueError):
            self.verify()

    def test_info_identity_platform_and_signing_are_rejected(self):
        original = dict(self.info)
        for field, value in [("CFBundleIdentifier", "local.amakano2plus"), ("CFBundleExecutable", "../external"),
                             ("CFBundlePackageType", "BNDL"), ("LSRequiresIPhoneOS", False),
                             ("CFBundleSupportedPlatforms", ["iPhoneSimulator"])]:
            with self.subTest(field=field):
                self.info = {**original, field: value}; self.write_info()
                with self.assertRaises(ValueError):
                    self.verify()
        self.info = original; self.write_info()
        (self.app / "embedded.mobileprovision").write_bytes(b"Not an unsigned archive")
        with self.assertRaises(ValueError):
            self.verify()

    def test_content_changes_and_external_symlinks_are_rejected(self):
        (self.app / "Content/runtime/index.html").write_text("changed archive payload")
        with self.assertRaises(ValueError):
            self.verify()
        shutil.rmtree(self.app / "Content")
        shutil.copytree(self.content, self.app / "Content")
        (self.content / "runtime/index.html").write_text("new prepared payload")
        self.refresh_manifest()
        with self.assertRaises(ValueError):
            self.verify()
        (self.app / "external").symlink_to(self.root / "ios", target_is_directory=True)
        with self.assertRaises(ValueError):
            self.verify()

    def test_full_release_gate_remains_required(self):
        self.refresh_manifest(mode="full")
        shutil.rmtree(self.app / "Content")
        shutil.copytree(self.content, self.app / "Content")
        self.info["CFBundleIdentifier"] = "local.amakano2plus"; self.write_info()
        with self.assertRaisesRegex(ValueError, "release acceptance"):
            package.package_ipa(self.archive, self.output, False, self.root)
        self.assertFalse(self.output.exists())

    def test_unsigned_complete_assets_packages_with_pending_installation_and_no_acceptance_claim(self):
        self.prepare_unsigned_complete()
        checks = self.root / "checks"
        checks.mkdir()
        (checks / "release-readiness.json").write_text(json.dumps({
            "schemaVersion": 1, "checks": {"signedInstallation": {"status": "notRun", "evidence": ""}}}))
        report = self.package_unsigned_complete()
        self.assertEqual(report["artifactScope"], "unsigned-complete-assets")
        self.assertEqual(report["contentMode"], "full")
        self.assertEqual(report["bundleIdentifier"], "local.amakano2plus")
        self.assertTrue(report["completeAssets"])
        self.assertEqual(report["assetCoverage"]["requiredAssets"], 1)
        self.assertEqual(report["assetCoverage"]["scenes"], 1)
        self.assertFalse(report["fullGameAcceptance"])
        self.assertFalse(report["deviceInstallationVerified"])
        self.assertFalse(report["deviceBinary"]["launchVerified"])
        self.assertEqual(report["iPadValidation"], "notRun")
        self.assertFalse(report["releaseAcceptance"]["ready"])
        self.assertTrue(any("signedInstallation" in reason for reason in report["releaseAcceptance"]["blockers"]))
        self.assertEqual(json.loads(self.output.with_suffix(".ipa.json").read_text()), report)
        verified = package.verify_archive(self.archive, False, self.root, artifact_scope="unsigned-complete-assets")
        package.verify_ipa(self.output, verified)
        # The same full-mode artifact remains blocked by the old release gate.
        with self.assertRaisesRegex(ValueError, "release acceptance"):
            package.verify_archive(self.archive, False, self.root)

    def test_unsigned_complete_cannot_promote_passed_release_metadata_to_device_acceptance(self):
        self.prepare_unsigned_complete()
        with patch.object(package, "release_checks", return_value={"ready": True, "blockers": []}):
            report = self.package_unsigned_complete()
        self.assertTrue(report["releaseAcceptance"]["ready"])
        self.assertFalse(report["fullGameAcceptance"])
        self.assertFalse(report["deviceInstallationVerified"])
        self.assertEqual(report["iPadValidation"], "notRun")

    def test_unsigned_complete_rejects_incomplete_rehashed_inventory_before_replacing_output(self):
        self.prepare_unsigned_complete()
        original = json.loads((self.converted / "asset-report.json").read_text())
        self.output.parent.mkdir()
        self.output.write_bytes(b"Previous delivery")
        for change in [{"completeAssets": False}, {"requested": 0}, {"totalRequiredAssets": 2},
                       {"failures": [{"asset": "missing"}]}]:
            with self.subTest(change=change):
                (self.converted / "asset-report.json").write_text(json.dumps({**original, **change}))
                self.refresh_manifest(mode="full")
                shutil.rmtree(self.app / "Content")
                shutil.copytree(self.content, self.app / "Content")
                with self.assertRaises(ValueError):
                    self.package_unsigned_complete()
                self.assertEqual(self.output.read_bytes(), b"Previous delivery")

    def test_unsigned_complete_rejects_missing_scene_asset_or_image_frame_reference(self):
        self.prepare_unsigned_complete()
        original_assets = (self.converted / "assets.json").read_text()
        for config, data in [
            ("assets.json", {"a": {"kind": "audio", "file": "assets/missing.m4a"}}),
            ("assets.json", {"a": {"kind": "image", "frames": [{"id": 0, "file": "assets/missing.png"}]}}),
            ("manifest.json", {"scenes": {"a": {"file": "missing.json"}}}),
        ]:
            with self.subTest(config=config, data=data):
                (self.converted / "assets.json").write_text(original_assets)
                (self.converted / config).write_text(json.dumps(data))
                self.refresh_manifest(mode="full")
                shutil.rmtree(self.app / "Content")
                shutil.copytree(self.content, self.app / "Content")
                with self.assertRaises(ValueError):
                    self.package_unsigned_complete()

    def test_unsigned_complete_rejects_preview_scope_conflict_and_unknown_scope(self):
        self.info["CFBundleIdentifier"] = "local.amakano2plus"
        self.write_info()
        with self.assertRaisesRegex(ValueError, "not full"):
            self.package_unsigned_complete()
        for preview, scope in [(True, "unsigned-complete-assets"), (False, "development-preview"), (False, "unknown")]:
            with self.subTest(preview=preview, scope=scope), self.assertRaises(ValueError):
                package.verify_archive(self.archive, preview, self.root, artifact_scope=scope)

    def test_unsigned_complete_keeps_device_structure_identity_and_archive_content_gates(self):
        self.prepare_unsigned_complete()
        self.executable.write_bytes(macho_fixture(platform=7))
        with self.assertRaisesRegex(ValueError, "iPhoneOS"):
            self.package_unsigned_complete()
        self.executable.write_bytes(macho_fixture())
        self.info["CFBundleIdentifier"] = "local.amakano2plus.preview"
        self.write_info()
        with self.assertRaisesRegex(ValueError, "Info.plist"):
            self.package_unsigned_complete()
        self.info["CFBundleIdentifier"] = "local.amakano2plus"
        self.write_info()
        (self.app / "Content/runtime/index.html").write_text("stale archive")
        with self.assertRaisesRegex(ValueError, "content has changed"):
            self.package_unsigned_complete()

    def test_unsigned_complete_stream_verification_failure_preserves_previous_ipa(self):
        self.prepare_unsigned_complete()
        self.output.parent.mkdir()
        self.output.write_bytes(b"Previous complete delivery")
        with patch.object(package, "verify_ipa", side_effect=ValueError("Failed complete stream verification")):
            with self.assertRaises(ValueError):
                self.package_unsigned_complete()
        self.assertEqual(self.output.read_bytes(), b"Previous complete delivery")
        self.assertEqual(list(self.output.parent.glob("*.tmp")), [])

    def test_corrupt_duplicate_and_changed_permission_ipa_are_rejected(self):
        package.package_ipa(self.archive, self.output, True, self.root)
        archive = self.verify()
        with zipfile.ZipFile(self.output, "a") as ipa:
            ipa.writestr("unexpected.txt", "unexpected")
        with self.assertRaises(ValueError):
            package.verify_ipa(self.output, archive)
        package.package_ipa(self.archive, self.output, True, self.root)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(self.output, "a") as ipa:
                ipa.writestr("Payload/AmakanoPort.app/AmakanoPort", macho_fixture())
        with self.assertRaises(ValueError):
            package.verify_ipa(self.output, archive)
        package.package_ipa(self.archive, self.output, True, self.root)
        with zipfile.ZipFile(self.output, "r") as ipa:
            entries = [(item, ipa.read(item)) for item in ipa.infolist()]
        with zipfile.ZipFile(self.output, "w") as ipa:
            for item, data in entries:
                if item.filename.endswith("/runtime/index.html"):
                    data = b"x" * len(data)
                ipa.writestr(item, data)
        with self.assertRaises(ValueError):
            package.verify_ipa(self.output, archive)
        package.package_ipa(self.archive, self.output, True, self.root)
        with zipfile.ZipFile(self.output, "r") as ipa:
            entries = [(item, ipa.read(item)) for item in ipa.infolist()]
        with zipfile.ZipFile(self.output, "w") as ipa:
            for item, data in entries:
                if item.filename.endswith("/AmakanoPort"):
                    item.external_attr = (stat.S_IFREG | 0o644) << 16
                ipa.writestr(item, data)
        with self.assertRaises(ValueError):
            package.verify_ipa(self.output, archive)

    def test_failed_packaging_preserves_old_output(self):
        self.output.parent.mkdir()
        self.output.write_bytes(b"Previous delivery")
        with patch.object(package, "verify_ipa", side_effect=ValueError("Failed streamed verification")):
            with self.assertRaises(ValueError):
                package.package_ipa(self.archive, self.output, True, self.root)
        self.assertEqual(self.output.read_bytes(), b"Previous delivery")
        self.assertEqual(list(self.output.parent.glob("*.tmp")), [])

    def test_output_inside_archive_is_rejected(self):
        with self.assertRaises(ValueError):
            package.package_ipa(self.archive, self.app / "self.ipa", True, self.root)


if __name__ == "__main__":
    unittest.main()
