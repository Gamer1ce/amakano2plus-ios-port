"""Decode CatSystem2 HG-3 frames with Pillow and NumPy on macOS/Linux.

Format references: Robert Jordan's TriggersTools.CatSystem2 and catsystem-py.
Preserves frame offsets, baselines and attribute rectangles for the renderer.
Malformed and unsupported tags fail explicitly rather than producing blank CGs.
"""
from dataclasses import dataclass
import io
import re
import struct
import zlib
import numpy as np
from PIL import Image
from .kif import FormatError

LIMIT = 256 * 1024 * 1024


def inflate(data, expected):
    if not 0 <= expected <= LIMIT:
        raise FormatError("HG3 decompressed size exceeds limit")
    decoder = zlib.decompressobj()
    output = decoder.decompress(data, expected + 1)
    if len(output) != expected or not decoder.eof or decoder.unused_data:
        raise FormatError("HG3 zlib length/stream mismatch")
    return output


class Bits:
    def __init__(self, data): self.data, self.position = data, 0
    def bit(self):
        pos = self.position
        self.position += 1
        if pos >= len(self.data) * 8:
            raise FormatError("HG3 command bitstream ended")
        return (self.data[pos >> 3] >> (pos & 7)) & 1
    def gamma(self):
        zeroes = 0
        while not self.bit():
            zeroes += 1
            if zeroes > 31:
                raise FormatError("HG3 invalid gamma integer")
        value = 1
        for _ in range(zeroes): value = value * 2 + self.bit()
        return value


def pixels(data, commands, width, height, depth):
    bytedepth = depth // 8
    stride = (width * bytedepth + 3) & ~3
    bits = Bits(commands)
    copy = bits.bit()
    length = bits.gamma()
    # Some translated 24-bit frames omit the usual DWORD padding on each
    # row. Only accept that layout when the bitstream length exactly matches
    # tightly packed pixels (rounded for the four bit-plane sections).
    packed_stride = width * bytedepth
    if length < stride * height and length == ((packed_stride * height + 3) & ~3):
        stride = packed_stride
    if length < stride * height or length % 4 or length > LIMIT:
        raise FormatError("HG3 decoded pixel length differs from dimensions")
    expanded = bytearray(length)
    at = src = 0
    while at < length:
        run = bits.gamma()
        if at + run > length or (copy and src + run > len(data)):
            raise FormatError("HG3 RLE run exceeds buffer")
        if copy:
            expanded[at:at + run] = data[src:src + run]
            src += run
        at += run
        copy ^= 1
    if src != len(data):
        raise FormatError("HG3 unused pixel data")
    # Each input byte holds one pair of bits from each of four output bytes.
    crumbs = np.arange(256, dtype=np.uint32)
    table = ((crumbs & 0xc0) << 18) | ((crumbs & 0x30) << 12) | ((crumbs & 0x0c) << 6) | (crumbs & 3)
    sections = np.frombuffer(expanded, dtype=np.uint8).reshape(4, -1)
    words = (table[sections[0]] << 6) | (table[sections[1]] << 4) | (table[sections[2]] << 2) | table[sections[3]]
    packed = words.astype("<u4").view(np.uint8)
    delta = ((packed >> 1) ^ np.where(packed & 1, 255, 0)).astype(np.uint8)[:stride * height].reshape(height, stride)
    # First row predicts the previous pixel; remaining rows predict vertically.
    for channel in range(bytedepth):
        delta[0, channel::bytedepth] = np.cumsum(delta[0, channel::bytedepth], dtype=np.uint32).astype(np.uint8)
    decoded = np.cumsum(delta, axis=0, dtype=np.uint32).astype(np.uint8)
    return decoded.tobytes(), stride


@dataclass
class Frame:
    metadata: dict
    image: Image.Image


def read_frames(data):
    if len(data) < 20 or data[:4] != b"HG-3":
        raise FormatError("Missing HG-3 header")
    header_size, version = struct.unpack_from("<II", data, 4)
    if version != 0x300 or not 12 <= header_size <= len(data) - 8:
        raise FormatError(f"Unsupported HG3 version/header: {version:#x}")
    frames = []
    frame_at = header_size
    seen = set()
    while True:
        if frame_at in seen or frame_at + 8 > len(data):
            raise FormatError("Invalid/cyclic HG3 frame chain")
        seen.add(frame_at)
        next_frame, identifier = struct.unpack_from("<II", data, frame_at)
        end = frame_at + next_frame if next_frame else len(data)
        if not frame_at + 8 < end <= len(data):
            raise FormatError("HG3 next frame outside file")
        tags = {}
        tag_at = frame_at + 8
        visited = set()
        while True:
            if tag_at in visited or tag_at + 16 > end:
                raise FormatError("Invalid/cyclic HG3 tag chain")
            visited.add(tag_at)
            name, next_tag, length = struct.unpack_from("<8sII", data, tag_at)
            name = name.split(b"\0", 1)[0].decode("ascii")
            if tag_at + 16 + length > end or name in tags:
                raise FormatError("HG3 duplicate/out-of-range tag")
            tags[name] = data[tag_at + 16:tag_at + 16 + length]
            if not next_tag: break
            tag_at += next_tag
        std = tags.get("stdinfo", b"")
        if len(std) != 40:
            raise FormatError("HG3 missing/invalid stdinfo")
        width, height, depth, x, y, total_w, total_h, transparent, base_x, base_y = struct.unpack("<IIIiiIIIii", std)
        if depth not in (24, 32) or not width or not height or width * height * 4 > LIMIT:
            raise FormatError("Unsupported HG3 dimensions/depth")
        metadata = dict(id=identifier, width=width, height=height, totalWidth=total_w,
            totalHeight=total_h, x=x, y=y, baseX=base_x, baseY=base_y, transparent=bool(transparent))
        attributes = {}
        for name, payload in tags.items():
            if re.fullmatch(r"ats\d+", name):
                if len(payload) != 20: raise FormatError("Invalid HG3 attribute tag")
                ax, ay, aw, ah, color = struct.unpack("<iiIII", payload)
                attributes[name[3:]] = dict(x=ax, y=ay, width=aw, height=ah, color=color)
        if attributes: metadata["attributes"] = attributes
        for name in ("imgmode", "cptype"):
            if name in tags:
                metadata[name] = struct.unpack("<I", tags[name])[0]
        chunks = sorted((name, payload) for name, payload in tags.items() if re.fullmatch(r"img\d+", name))
        if chunks:
            canvas = Image.new("RGBA" if depth == 32 else "RGB", (width, height))
            covered = set()
            for _, payload in chunks:
                if len(payload) < 24: raise FormatError("Truncated HG3 image tag")
                row, rows, dlen, dsize, clen, csize = struct.unpack_from("<IIIIII", payload)
                if row + rows > height or not rows or len(payload) != 24 + dlen + clen:
                    raise FormatError("HG3 image slice dimensions/length mismatch")
                if covered.intersection(range(row, row + rows)):
                    raise FormatError("Overlapping HG3 image slices")
                covered.update(range(row, row + rows))
                raw, stride = pixels(inflate(payload[24:24 + dlen], dsize), inflate(payload[24 + dlen:], csize), width, rows, depth)
                # Standard HG3 pixels are BGRA/BGR and stored bottom-up.
                mode, order = ("RGBA", "BGRA") if depth == 32 else ("RGB", "BGR")
                image = Image.frombytes(mode, (width, rows), raw, "raw", order, stride, -1)
                canvas.paste(image, (0, height - row - rows))
            if len(covered) != height: raise FormatError("HG3 incomplete image slices")
            image = canvas
        elif "img_jpg" in tags or "img_wbp" in tags:
            image = Image.open(io.BytesIO(tags.get("img_jpg", tags.get("img_wbp")))).convert("RGBA")
            if image.size != (width, height): raise FormatError("HG3 embedded image dimensions mismatch")
        elif "img_al" in tags:
            image = Image.new("RGBA", (width, height), "white")
        else:
            raise FormatError("HG3 has no supported image tag")
        if "img_al" in tags:
            payload = tags["img_al"]
            compressed, expanded = struct.unpack_from("<II", payload)
            if len(payload) != 8 + compressed or expanded != width * height:
                raise FormatError("HG3 alpha length mismatch")
            alpha = Image.frombytes("L", (width, height), inflate(payload[8:], expanded))
            if "img_jpg" in tags:
                image.putalpha(alpha)
            elif not chunks and "img_wbp" not in tags:
                inverted = Image.eval(alpha, lambda value: 255 - value)
                image = Image.merge("RGB", (inverted, inverted, inverted))
            else:
                raise FormatError("Unsupported HG3 extra alpha combination")
        unknown = set(tags) - {"stdinfo", "img_jpg", "img_wbp", "img_al", "imgmode", "cptype"} - {name for name in tags if re.fullmatch(r"(?:img|ats)\d+", name)}
        if unknown:
            raise FormatError(f"Unsupported HG3 tags: {sorted(unknown)}")
        frames.append(Frame(metadata, image))
        if not next_frame: break
        frame_at = end
    return frames
