"""Read CatScene containers without executing their commands.

Format reference: TriggersTools.CatSystem2 by Robert Jordan (MIT).
This parser is an independent implementation of the documented binary layout.
"""
from dataclasses import dataclass
import struct
import zlib


class SceneFormatError(ValueError):
    pass


@dataclass(frozen=True)
class Line:
    type: int
    text: str


def read_scene(data: bytes, *, dialogue_encoding: str = "cp932", command_encoding: str = "cp932", fallback_encoding: str | None = None) -> list[Line]:
    if len(data) < 16 or data[:8] != b"CatScene":
        raise SceneFormatError("Missing CatScene header")
    compressed, expanded = struct.unpack_from("<II", data, 8)
    if expanded > 128 * 1024 * 1024:
        raise SceneFormatError("Scene exceeds size limit")
    if compressed:
        if len(data) != 16 + compressed:
            raise SceneFormatError("Compressed length mismatch")
        inflater = zlib.decompressobj()
        body = inflater.decompress(data[16:], expanded + 1)
        if len(body) != expanded or not inflater.eof or inflater.unused_data:
            raise SceneFormatError("Invalid compressed scene")
    else:
        body = data[16:]
        if len(body) != expanded:
            raise SceneFormatError("Uncompressed length mismatch")
    if len(body) < 16:
        raise SceneFormatError("Missing script header")
    size, input_count, offsets_at, strings_at = struct.unpack_from("<IIII", body)
    if size + 16 != len(body):
        raise SceneFormatError("Script length mismatch")
    if not (input_count * 8 <= offsets_at <= strings_at <= size):
        raise SceneFormatError("Invalid script tables")
    if (strings_at - offsets_at) % 4:
        raise SceneFormatError("Unaligned offset table")
    lines = []
    for index in range((strings_at - offsets_at) // 4):
        offset, = struct.unpack_from("<I", body, 16 + offsets_at + index * 4)
        start = 16 + strings_at + offset
        if start + 2 > len(body):
            raise SceneFormatError("Line offset outside script")
        kind, = struct.unpack_from("<H", body, start)
        end = body.find(b"\x00", start + 2)
        if end < 0:
            raise SceneFormatError("Unterminated script line")
        encoding = dialogue_encoding if kind in (0x2001, 0x2101) else command_encoding
        try:
            text = body[start + 2:end].decode(encoding, errors="strict")
        except UnicodeDecodeError:
            if fallback_encoding is None:
                raise
            text = body[start + 2:end].decode(fallback_encoding, errors="strict")
        lines.append(Line(kind, text))
    return lines
