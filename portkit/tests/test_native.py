"""Binary boundary checks for the portable reader and resumable converter."""
import io
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from PIL import Image
from portkit.kif import Blowfish, FormatError, KifArchive, StoredMember, mt_first
from portkit.hg3 import Bits, Frame, inflate, pixels, read_frames
from portkit.portable_assets import convert, validate_asset


class NativeFormats(unittest.TestCase):
    def test_blowfish_fixed_standard_vector_in_cs2_word_order(self):
        # Standard Blowfish ECB: key abcdefgh, plaintext 0000000000000000,
        # ciphertext 11e472de966f7475; CatSystem stores each word little-endian.
        cipher = Blowfish(b"abcdefgh")
        self.assertEqual(cipher.decrypt(bytes.fromhex("de72e41175746f96")), bytes(8))
        self.assertEqual(cipher.decrypt(bytes.fromhex("de72e41175746f96") + b"tail"), bytes(8) + b"tail")

    def test_mersenne_twister_1999_golden_outputs(self):
        # Cross-checked with the bundled reference's independently implemented
        # 624-word engine and its optimized first-word function.
        self.assertEqual([mt_first(n) for n in [0, 1, 123456789, 0xffffffff]],
                         [477480905, 3556162021, 2363614702, 1255396560])

    def test_kif_plain_entry_and_truncation(self):
        data = b"KIF\0" + struct.pack("<I", 1) + struct.pack("<64sII", b"Example.ogg", 80, 3) + b"abc"
        archive = KifArchive(io.BytesIO(data), 0)
        self.assertEqual(archive.read("EXAMPLE.OGG"), b"abc")
        with self.assertRaises(FormatError): KifArchive(io.BytesIO(data[:-1]), 0)

    def test_kif_offset_cannot_alias_table(self):
        data = b"KIF\0" + struct.pack("<I", 1) + struct.pack("<64sII", b"x.hg3", 8, 1)
        with self.assertRaises(FormatError): KifArchive(io.BytesIO(data), 0)

    def test_zip_stored_member_seek_is_bounded(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "test.zip"
            with zipfile.ZipFile(path, "w") as writer: writer.writestr("asset.int", b"abcdefgh")
            with zipfile.ZipFile(path) as reader:
                with StoredMember(path, reader.getinfo("asset.int")) as stream:
                    self.assertEqual(stream.read(3), b"abc")
                    stream.seek(-2, 2)
                    self.assertEqual(stream.read(20), b"gh")
                    with self.assertRaises(ValueError): stream.seek(9)

    def test_compressed_original_zip_is_explicitly_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "test.zip"
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as writer:
                writer.writestr("asset.int", bytes(1024))
            with zipfile.ZipFile(path) as reader:
                with self.assertRaises(FormatError): StoredMember(path, reader.getinfo("asset.int"))

    def test_hg3_truncated_header_and_excessive_dimensions_fail(self):
        with self.assertRaises(FormatError): read_frames(b"HG-3")
        data = (b"HG-3" + struct.pack("<II", 12, 0x300) + bytes(8) +
                struct.pack("<8sII", b"stdinfo", 0, 40) +
                struct.pack("<IIIiiIIIii", 0xffffffff, 0xffffffff, 32, 0, 0, 0, 0, 0, 0, 0))
        with self.assertRaises(FormatError): read_frames(data)

    def test_hg3_bit_and_inflate_bounds(self):
        with self.assertRaises(FormatError): Bits(b"").gamma()
        with self.assertRaises(FormatError): inflate(b"", 257 * 1024 * 1024)

    def test_hg3_tightly_packed_24_bit_rows(self):
        # Four one-pixel BGR rows; the translated HG3 encoder uses a 3-byte
        # stride. Copy=1, total=12, run=12 in the little-endian gamma stream.
        decoded, stride = pixels(bytes.fromhex("000000f9fffff9ffff000000"),
                                 bytes.fromhex("3118"), 1, 4, 24)
        self.assertEqual(stride, 3)
        self.assertEqual(decoded, bytes.fromhex("0a141e28323c46505a646e78"))

    def test_hg3_repeated_ids_preserve_each_source_frame(self):
        with tempfile.TemporaryDirectory() as folder:
            frames = [Frame({"id": 620, "width": 1, "height": 1}, Image.new("RGBA", (1, 1), "red")),
                      Frame({"id": 620, "width": 2, "height": 1}, Image.new("RGBA", (2, 1), "green"))]
            with patch("portkit.portable_assets.read_frames", return_value=frames):
                asset = convert({"name": "duplicate.hg3", "archive": "patch.int"}, b"", Path(folder), None)
            self.assertEqual([frame["id"] for frame in asset["frames"]], [620, 620])
            self.assertEqual(len({frame["file"] for frame in asset["frames"]}), 2)
            validate_asset(asset, Path(folder))

    def test_truncated_mp4_is_not_reused(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bad.m4a"
            path.write_bytes(struct.pack(">I4s", 1024, b"ftyp") + b"junk")
            with self.assertRaises(ValueError): validate_asset({"kind": "audio", "file": path.name}, Path(folder))


if __name__ == "__main__": unittest.main()
