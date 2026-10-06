"""Exercise staging rollback, stale-content removal, tamper and release gates."""
from pathlib import Path
import importlib.util
import json
import plistlib
import shutil
import sys
import tempfile
import unittest

IOS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(IOS))
from content_validation import RELEASE_CHECKS, content_manifest, payload_digest, release_checks, verify_content
spec = importlib.util.spec_from_file_location("prepare_content", IOS / "prepare-content.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
readiness_spec = importlib.util.spec_from_file_location("check_readiness", IOS / "check-readiness.py")
readiness = importlib.util.module_from_spec(readiness_spec)
readiness_spec.loader.exec_module(readiness)


class StagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "game-data/converted"
        (self.source / "scenes").mkdir(parents=True)
        (self.source / "assets").mkdir()
        (self.root / "runtime").mkdir()
        (self.root / "runtime/index.html").write_text("preview")
        (self.root / "ios/diagnostics").mkdir(parents=True)
        (self.root / "ios/diagnostics/index.html").write_text("diagnostics")
        self.write_report(False)
        self.write_json("manifest.json", {"scenes": {"a": {"file": "a.json"}}})
        self.write_json("assets.json", {"a": {"kind": "audio", "file": "assets/a.m4a"}})
        for name in ["helpers.json", "profiles.json", "vram.json", "scenes/a.json"]:
            self.write_json(name, {})
        self.voice_metadata = {"formatVersion": 1, "timeUnit": "milliseconds",
                               "lipFormat": {"status": "preserved-unsupported", "rawFramesExported": False},
                               "voices": {"a": {"tags": {"01": 1250}, "lip": {"records": 75, "archive": "pcm_AA.int"}}}}
        self.write_json("voice-metadata.json", self.voice_metadata)
        (self.source / "assets/a.m4a").write_bytes(b"testftypaudio")

    def tearDown(self):
        self.temp.cleanup()

    def write_json(self, name, value):
        (self.source / name).write_text(json.dumps(value))

    def write_report(self, complete):
        self.write_json("asset-report.json", {"completeAssets": complete, "completeGame": False, "failures": [],
                                              "totalRequiredAssets": 1, "requested": 1, "prepared": 1,
                                              "reused": 0, "indexedAssets": 1})

    def test_stale_files_are_removed(self):
        content = self.root / "ios/Content"
        content.mkdir()
        (content / "stale.exe").write_bytes(b"old")
        (self.source / "assets/unused.ogg").write_bytes(b"unreferenced")
        module.prepare(self.root, True)
        manifest = verify_content(content, True)
        self.assertFalse((content / "stale.exe").exists())
        self.assertFalse((content / "game-data/converted/assets/unused.ogg").exists())
        self.assertEqual(json.loads((content / "game-data/converted/vram.json").read_text()), {})
        self.assertEqual(json.loads((content / "game-data/converted/voice-metadata.json").read_text()), self.voice_metadata)
        self.assertEqual(manifest["mode"], "preview")

    def test_missing_vram_configuration_preserves_previous_payload(self):
        content = module.prepare(self.root, True)
        previous = (content / "content-manifest.json").read_bytes()
        (self.source / "vram.json").unlink()
        with self.assertRaises(ValueError):
            module.prepare(self.root, True)
        self.assertEqual(previous, (content / "content-manifest.json").read_bytes())
        verify_content(content, True)

    def test_old_payload_without_vram_is_rejected_even_with_matching_hashes(self):
        content = module.prepare(self.root, True)
        (content / "game-data/converted/vram.json").unlink()
        payload = content_manifest(content, "preview", False)
        (content / "content-manifest.json").write_text(json.dumps(payload))
        with self.assertRaises(ValueError):
            verify_content(content, True)

    def test_invalid_voice_metadata_preserves_previous_payload(self):
        content = module.prepare(self.root, True)
        previous = (content / "content-manifest.json").read_bytes()
        invalid_values = []
        for time in [-1, 1.5, True, 0x100000000]:
            value = json.loads(json.dumps(self.voice_metadata))
            value["voices"]["a"]["tags"]["01"] = time
            invalid_values.append(value)
        value = json.loads(json.dumps(self.voice_metadata)); value["lipFormat"]["status"] = "supported"; invalid_values.append(value)
        value = json.loads(json.dumps(self.voice_metadata)); value["voices"]["a"]["lip"]["records"] = -1; invalid_values.append(value)
        value = json.loads(json.dumps(self.voice_metadata)); value["formatVersion"] = True; invalid_values.append(value)
        for value in invalid_values:
            with self.subTest(value=value):
                self.write_json("voice-metadata.json", value)
                with self.assertRaises(ValueError):
                    module.prepare(self.root, True)
                self.assertEqual(previous, (content / "content-manifest.json").read_bytes())
                verify_content(content, True)

    def test_voice_metadata_required_and_rehashed_invalid_shape_rejected(self):
        content = module.prepare(self.root, True)
        metadata_file = content / "game-data/converted/voice-metadata.json"
        metadata_file.unlink()
        payload = content_manifest(content, "preview", False)
        (content / "content-manifest.json").write_text(json.dumps(payload))
        with self.assertRaises(ValueError):
            verify_content(content, True)
        metadata_file.write_text(json.dumps({**self.voice_metadata, "timeUnit": "frames"}))
        payload = content_manifest(content, "preview", False)
        (content / "content-manifest.json").write_text(json.dumps(payload))
        with self.assertRaises(ValueError):
            verify_content(content, True)

    def test_bad_reference_preserves_previous_payload(self):
        content = module.prepare(self.root, True)
        previous = (content / "content-manifest.json").read_bytes()
        (self.source / "assets/a.m4a").unlink()
        with self.assertRaises(ValueError):
            module.prepare(self.root, True)
        self.assertEqual(previous, (content / "content-manifest.json").read_bytes())
        verify_content(content, True)

    def test_tamper_and_mode_mismatch_are_rejected(self):
        content = module.prepare(self.root, True)
        with self.assertRaises(ValueError):
            verify_content(content, False)
        (content / "runtime/index.html").write_text("modified")
        with self.assertRaises(ValueError):
            verify_content(content, True)

    def test_exact_true_required_for_full_assets(self):
        for invalid in [False, "true", 1]:
            self.write_report(invalid)
            with self.assertRaises(ValueError):
                module.prepare(self.root, False)
        self.write_report(True)
        verify_content(module.prepare(self.root, False), False)

    def test_escaping_paths_and_symlinks_are_rejected(self):
        self.write_json("assets.json", {"a": {"kind": "audio", "file": "../../runtime/index.html"}})
        with self.assertRaises(ValueError):
            module.prepare(self.root, True)
        self.write_json("assets.json", {"a": {"kind": "audio", "file": "assets/a.m4a"}})
        content = module.prepare(self.root, True)
        (content / "external").symlink_to(self.root / "runtime", target_is_directory=True)
        with self.assertRaises(ValueError):
            verify_content(content, True)

    def test_complete_flag_without_inventory_coverage_is_rejected(self):
        self.write_report(True)
        report = json.loads((self.source / "asset-report.json").read_text())
        report["totalRequiredAssets"] = 2
        self.write_json("asset-report.json", report)
        with self.assertRaises(ValueError):
            module.prepare(self.root, False)

    def test_preview_preserves_unrelated_conversion_failures(self):
        report = json.loads((self.source / "asset-report.json").read_text())
        report["failures"] = [{"asset": "not-in-preview.psz", "error": "unconverted"}]
        self.write_json("asset-report.json", report)
        content = module.prepare(self.root, True)
        verify_content(content, True)
        copied = json.loads((content / "game-data/converted/asset-report.json").read_text())
        self.assertEqual(copied["failures"], report["failures"])
        with self.assertRaises(ValueError):
            module.prepare(self.root, False)

    def test_release_evidence_bound_to_payload(self):
        self.write_report(True)
        content = module.prepare(self.root, True)
        manifest = verify_content(content, True)
        checks = self.root / "checks"
        checks.mkdir()
        (checks / "evidence.txt").write_text("Fixture evidence only")
        checklist = {"schemaVersion": 1, "contentSHA256": payload_digest(manifest),
                     "checks": {name: {"status": "passed", "evidence": "checks/evidence.txt"} for name in RELEASE_CHECKS}}
        (checks / "release-readiness.json").write_text(json.dumps(checklist))
        self.assertTrue(release_checks(self.root)["ready"])
        (self.root / "runtime/index.html").write_text("changed runtime")
        module.prepare(self.root, True)
        self.assertFalse(release_checks(self.root)["ready"])

    def test_archive_mode_identity_and_stale_content_are_rejected(self):
        content = module.prepare(self.root, True)
        archive = self.root / "preview.xcarchive"
        app = archive / "Products/Applications/AmakanoPort.app"
        shutil.copytree(content, app / "Content")
        info = app / "Info.plist"
        info.write_bytes(plistlib.dumps({"CFBundleIdentifier": "local.amakano2plus.preview"}))
        prior_root = readiness.ROOT
        readiness.ROOT = self.root
        try:
            self.assertTrue(readiness.verify_archive(archive, True)["verified"])
            with self.assertRaises(ValueError):
                readiness.verify_archive(archive, False)
            info.write_bytes(plistlib.dumps({"CFBundleIdentifier": "local.amakano2plus"}))
            with self.assertRaises(ValueError):
                readiness.verify_archive(archive, True)
            info.write_bytes(plistlib.dumps({"CFBundleIdentifier": "local.amakano2plus.preview"}))
            (self.root / "runtime/index.html").write_text("changed runtime")
            module.prepare(self.root, True)
            with self.assertRaises(ValueError):
                readiness.verify_archive(archive, True)
        finally:
            readiness.ROOT = prior_root


if __name__ == "__main__":
    unittest.main()
