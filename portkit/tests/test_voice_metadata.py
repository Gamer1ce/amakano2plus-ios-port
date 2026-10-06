"""Boundary and original-byte vectors for auxiliary voice metadata."""
import struct
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from portkit.kif import FormatError
from portkit.voice_metadata import MAX_LPB_BYTES, MAX_TAG_BYTES, decode_lpb_header, decode_tags, read_bounded


def tag(label, milliseconds):
    return label.encode("ascii").ljust(20, b"\0") + struct.pack("<I", milliseconds)


def lpb(records=2):
    return (struct.pack("<4s3I", b"LPD\0", 60, 32, records) + bytes.fromhex("00002cc2") +
            b"".join(struct.pack("<I", i) + bytes(28) for i in range(records)))


class VoiceMetadataTests(unittest.TestCase):
    def test_original_tag_bytes_have_exact_timestamp(self):
        # DD_05_SA15H_010.tag from pcm_tag.int, independently inspected.
        raw = bytes.fromhex("303100000000000000000000000000000000000001080000")
        self.assertEqual(decode_tags(raw), {"01": 2049})

    def test_reversed_label_times_are_preserved(self):
        # Original AA_03_yuh_31_030 has label 02 earlier than label 01.
        self.assertEqual(list(decode_tags(tag("01", 3823) + tag("02", 1164)).items()),
                         [("01", 3823), ("02", 1164)])

    def test_tag_allows_full_twenty_byte_label_and_unsigned_time(self):
        self.assertEqual(decode_tags(tag("12345678901234567890", 0xffffffff)),
                         {"12345678901234567890": 0xffffffff})

    def test_tag_rejects_partial_record_empty_and_excessive_data(self):
        for raw in [b"", tag("01", 0)[:-1], bytes(MAX_TAG_BYTES + 1)]:
            with self.subTest(length=len(raw)), self.assertRaises(FormatError): decode_tags(raw)

    def test_tag_rejects_ambiguous_or_invalid_labels(self):
        for raw in [tag("01", 1) + tag("01", 2), bytes(24), b"\xff" + bytes(23),
                    b"01\0x" + bytes(16) + struct.pack("<I", 1)]:
            with self.subTest(raw=raw[:5]), self.assertRaises(FormatError): decode_tags(raw)

    def test_lpb_preserves_unknown_header_without_claiming_mouth_mapping(self):
        header = decode_lpb_header(lpb())
        self.assertEqual(header, {"fps": 60, "recordBytes": 32, "records": 2,
                                  "unknownHeaderWordHex": "00002cc2"})
        different = lpb()[:16] + bytes.fromhex("12345678") + lpb()[20:]
        self.assertEqual(decode_lpb_header(different)["unknownHeaderWordHex"], "12345678")

    def test_lpb_rejects_short_or_trailing_payload_and_huge_count(self):
        for raw in [lpb()[:-1], lpb() + b"\0", b"LPD\0", bytes(MAX_LPB_BYTES + 1),
                    struct.pack("<4s3I", b"LPD\0", 60, 32, 0xffffffff) + bytes(4)]:
            with self.subTest(length=len(raw)), self.assertRaises(FormatError): decode_lpb_header(raw)

    def test_lpb_rejects_unknown_layout_and_nonsequential_indexes(self):
        for offset, value in [(0, b"BAD\0"), (4, struct.pack("<I", 59)),
                              (8, struct.pack("<I", 16)), (52, struct.pack("<I", 42))]:
            raw = lpb()[:offset] + value + lpb()[offset + 4:]
            with self.subTest(offset=offset), self.assertRaises(FormatError): decode_lpb_header(raw)

    def test_original_entry_bounds_checked_before_archive_read(self):
        archive = Mock(entries={"v.tag": SimpleNamespace(length=MAX_TAG_BYTES + 1)})
        source = Mock(); source.archive.return_value = archive
        with self.assertRaises(FormatError):
            read_bounded(source, {"archive": "pcm_tag.int", "name": "V.tag", "length": 24}, MAX_TAG_BYTES)
        archive.read.assert_not_called()
        archive.entries["v.tag"].length = 48
        with self.assertRaises(FormatError):
            read_bounded(source, {"archive": "pcm_tag.int", "name": "V.tag", "length": 24}, MAX_TAG_BYTES)
        archive.read.assert_not_called()


if __name__ == "__main__": unittest.main()
