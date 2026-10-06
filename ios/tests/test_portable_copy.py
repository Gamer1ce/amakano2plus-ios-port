"""Verify real clone isolation and safe fallback, never hard-link behavior."""
from pathlib import Path
import ctypes
import errno
import hashlib
import os
import shutil
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

IOS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(IOS))
import portable_copy


class PortableCopyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=IOS)
        self.root = Path(self.temp.name)
        self.source = self.root / "source.bin"
        self.destination = self.root / "copy.bin"
        self.data = bytes(range(256)) * 512
        self.source.write_bytes(self.data)
        self.source.chmod(0o640)
        os.utime(self.source, ns=(1700000000000000000, 1700000000123456789))

    def tearDown(self):
        self.temp.cleanup()

    def assert_independent(self):
        before = self.source.read_bytes()
        source_stat = self.source.stat()
        destination_stat = self.destination.stat()
        self.assertNotEqual((source_stat.st_dev, source_stat.st_ino),
                            (destination_stat.st_dev, destination_stat.st_ino))
        self.assertEqual(destination_stat.st_nlink, 1)
        self.assertEqual(stat.S_IMODE(destination_stat.st_mode), stat.S_IMODE(source_stat.st_mode))
        self.assertEqual(destination_stat.st_mtime_ns, source_stat.st_mtime_ns)
        self.assertEqual(self.destination.read_bytes(), before)
        with self.destination.open("r+b") as destination:
            destination.seek(4096)
            destination.write(b"destination changed")
            destination.flush()
            os.fsync(destination.fileno())
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).digest(), hashlib.sha256(before).digest())
        destination_hash = hashlib.sha256(self.destination.read_bytes()).digest()
        with self.source.open("r+b") as source:
            source.seek(8192)
            source.write(b"source changed")
            source.flush()
            os.fsync(source.fileno())
        self.assertEqual(hashlib.sha256(self.destination.read_bytes()).digest(), destination_hash)

    @unittest.skipUnless(sys.platform == "darwin" and portable_copy._CLONEFILE is not None, "macOS clonefile required")
    def test_real_apfs_clone_is_independent_in_both_directions(self):
        stats = {}
        with patch.object(portable_copy.shutil, "copy2", side_effect=AssertionError("Expected a real clonefile operation")):
            portable_copy.copy_file(self.source, self.destination, stats=stats)
        self.assertEqual(stats, {"clonedFiles": 1, "clonedBytes": len(self.data)})
        self.assert_independent()

    def test_unsupported_and_cross_volume_fallback_are_independent(self):
        for error in sorted(portable_copy._FALLBACK_ERRORS):
            with self.subTest(error=error):
                self.source.write_bytes(self.data)
                if self.destination.exists():
                    self.destination.unlink()
                def fail_clone(*args):
                    ctypes.set_errno(error)
                    return -1
                stats = {}
                with patch.object(portable_copy, "_CLONEFILE", fail_clone), patch.object(portable_copy.shutil, "copy2", wraps=shutil.copy2) as copy:
                    portable_copy.copy_file(self.source, self.destination, stats=stats)
                copy.assert_called_once()
                self.assertEqual(stats, {"copiedFiles": 1, "copiedBytes": len(self.data)})
                self.assert_independent()

    def test_unexpected_clone_errors_propagate_without_copy_or_output(self):
        for error in [errno.EACCES, errno.EIO, errno.ENOSPC, errno.EEXIST]:
            with self.subTest(error=error):
                def fail_clone(*args):
                    ctypes.set_errno(error)
                    return -1
                stats = {}
                with patch.object(portable_copy, "_CLONEFILE", fail_clone), patch.object(portable_copy.shutil, "copy2", side_effect=AssertionError("Unexpected error must propagate")):
                    with self.assertRaises(OSError) as raised:
                        portable_copy.copy_file(self.source, self.destination, stats=stats)
                self.assertEqual(raised.exception.errno, error)
                self.assertFalse(self.destination.exists())
                self.assertEqual(stats, {})
                self.assertEqual(self.source.read_bytes(), self.data)

    def test_no_clone_api_symlink_and_existing_destination_use_copy2(self):
        with patch.object(portable_copy, "_CLONEFILE", None):
            portable_copy.copy_file(self.source, self.destination)
        self.assert_independent()
        self.source.write_bytes(self.data)
        self.destination.unlink()
        link = self.root / "source-link.bin"
        link.symlink_to(self.source)
        with patch.object(portable_copy, "_CLONEFILE", side_effect=AssertionError("Do not clone a symlink")):
            portable_copy.copy_file(link, self.destination)
        self.assertFalse(self.destination.is_symlink())
        self.assertEqual(self.destination.read_bytes(), self.data)
        with patch.object(portable_copy, "_CLONEFILE", side_effect=AssertionError("Do not clone over an existing file")):
            self.source.write_bytes(b"replacement")
            portable_copy.copy_file(self.source, self.destination)
        self.assertEqual(self.destination.read_bytes(), b"replacement")
        with self.assertRaises(shutil.SameFileError):
            portable_copy.copy_file(self.source, self.source)


if __name__ == "__main__":
    unittest.main()
