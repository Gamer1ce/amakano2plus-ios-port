import importlib.util
import json
from pathlib import Path
import plistlib
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('local_import', ROOT / 'tools/import-local-content.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImportBoundaries(unittest.TestCase):
    def archive(self, path, extra=()):
        with zipfile.ZipFile(path, 'w') as z:
            z.writestr(module.PREFIX + 'Info.plist', plistlib.dumps({
                'CFBundleIdentifier': 'local.amakano2plus', 'CFBundleVersion': '120'}))
            z.writestr(module.PREFIX + 'Content/runtime/example.js', 'export const synthetic = 1;')
            z.writestr(module.PREFIX + 'AmakanoPort', b'not-an-executable')
            z.writestr(module.PREFIX + 'embedded.mobileprovision', b'not-a-profile')
            for name, value in extra:
                z.writestr(name, value)

    def test_import_only_resources_never_executable_or_profile(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); ipa = root / 'synthetic.ipa'; self.archive(ipa)
            with patch.object(module, 'verify_content') as verify:
                module.import_content(ipa, root / 'ios')
            verify.assert_called_once()
            self.assertTrue((root / 'ios/Content/runtime/example.js').is_file())
            self.assertFalse(list((root / 'ios').rglob('AmakanoPort')))
            self.assertFalse(list((root / 'ios').rglob('embedded.mobileprovision')))

    def test_real_manifest_validation_and_icon_import_with_synthetic_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); content = root / 'content'
            converted = content / 'game-data/converted'; converted.mkdir(parents=True)
            for name in module.verify_content.__globals__['REQUIRED_PORTABLE_CONFIGS']:
                value = {}
                if name == 'voice-metadata.json':
                    value = {'formatVersion': 1, 'timeUnit': 'milliseconds',
                             'lipFormat': {'status': 'preserved-unsupported', 'rawFramesExported': False},
                             'voices': {}}
                (converted / name).write_text(json.dumps(value))
            from content_validation import content_manifest
            (content / 'content-manifest.json').write_text(json.dumps(content_manifest(content, 'full', True)))
            ipa = root / 'synthetic.ipa'
            info = {'CFBundleIdentifier': 'local.amakano2plus', 'CFBundleVersion': '120',
                    'CFBundleIcons': {'CFBundlePrimaryIcon': {'CFBundleIconFiles': ['SyntheticIcon']}}}
            with zipfile.ZipFile(ipa, 'w') as z:
                z.writestr(module.PREFIX + 'Info.plist', plistlib.dumps(info))
                z.writestr(module.PREFIX + 'SyntheticIcon.png', b'synthetic-icon')
                for path in content.rglob('*'):
                    if path.is_file(): z.write(path, module.PREFIX + 'Content/' + path.relative_to(content).as_posix())
            module.import_content(ipa, root / 'ios')
            module.verify_content(root / 'ios/Content', False)
            self.assertEqual((root / 'ios/ImportedArtwork/SyntheticIcon.png').read_bytes(), b'synthetic-icon')

    def test_invalid_manifest_leaves_no_adopted_payload(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); ipa = root / 'synthetic.ipa'; self.archive(ipa)
            with patch.object(module, 'verify_content', side_effect=ValueError('bad manifest')):
                with self.assertRaises(ValueError): module.import_content(ipa, root / 'ios')
            self.assertFalse((root / 'ios/Content').exists())
            self.assertEqual(list((root / 'ios').iterdir()), [])

    def test_traversal_and_ambiguous_names_rejected(self):
        for name in ['../escape', '/absolute', 'a/../escape', 'a//b', './a', 'a\\b']:
            with self.subTest(name=name), self.assertRaises(ValueError): module.safe_name(name)

    def test_duplicate_paths_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            ipa = Path(tmp) / 'synthetic.ipa'
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                self.archive(ipa, [(module.PREFIX + 'Content/runtime/example.js', 'duplicate')])
            with zipfile.ZipFile(ipa) as z, self.assertRaisesRegex(ValueError, 'Duplicate'):
                module.archive_plan(z)

    def test_archive_links_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            ipa = Path(tmp) / 'synthetic.ipa'; self.archive(ipa)
            with zipfile.ZipFile(ipa, 'a') as z:
                info = zipfile.ZipInfo(module.PREFIX + 'Content/escape')
                info.create_system = 3; info.external_attr = (stat.S_IFLNK | 0o777) << 16
                z.writestr(info, '/outside')
            with zipfile.ZipFile(ipa) as z, self.assertRaisesRegex(ValueError, 'link'):
                module.archive_plan(z)

    def test_existing_content_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); (root / 'ios/Content').mkdir(parents=True)
            with self.assertRaisesRegex(ValueError, 'already exists'):
                module.import_content(root / 'absent.ipa', root / 'ios')

    def test_symlink_output_ancestor_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); (root / 'real').mkdir(); (root / 'link').symlink_to(root / 'real')
            with self.assertRaisesRegex(ValueError, 'symlink'):
                module.import_content(root / 'absent.ipa', root / 'link/ios')


if __name__ == '__main__': unittest.main()
