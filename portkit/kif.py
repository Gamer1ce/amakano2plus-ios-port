"""Portable, read-only CatSystem2 KIF reader, including ZIP-stored originals.

Binary layout references: TriggersTools.CatSystem2 and catsystem-py (Robert
Jordan). This implementation uses native Blowfish, not their cipher sources.
No game executable is run. ZIP members must be stored, so seeks remain bounded
and never decompress a multi-gigabyte archive into memory or temporary files.
"""
from dataclasses import dataclass
from pathlib import Path
import array
import ctypes
import io
import struct
import sys
import zipfile


class FormatError(ValueError):
    pass


class Blowfish:
    """CatSystem's little-endian word representation of standard Blowfish."""
    def __init__(self, key):
        # Repeating a short key preserves the Blowfish key schedule and meets
        # CommonCrypto's eight-byte minimum.
        self.key = key * ((8 + len(key) - 1) // len(key)) if len(key) < 8 else key
        if sys.platform == "darwin":
            self.cc = ctypes.CDLL("/usr/lib/system/libcommonCrypto.dylib").CCCrypt
            self.cc.argtypes = [ctypes.c_uint, ctypes.c_uint, ctypes.c_uint,
                ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p,
                ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p,
                ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
        else:
            try:
                from Crypto.Cipher import Blowfish as Cipher
                self.cipher = Cipher.new(self.key, Cipher.MODE_ECB)
            except ImportError as exc:
                raise RuntimeError("KIF decryption needs macOS CommonCrypto or pycryptodome") from exc

    def decrypt(self, data):
        full = len(data) & ~7
        if not full:
            return data
        words = array.array("I", data[:full])
        words.byteswap()
        block = words.tobytes()
        if sys.platform == "darwin":
            output = ctypes.create_string_buffer(full)
            written = ctypes.c_size_t()
            status = self.cc(1, 6, 2, self.key, len(self.key), None,
                             block, full, output, full, ctypes.byref(written))
            if status or written.value != full:
                raise FormatError(f"CommonCrypto Blowfish failed ({status})")
            block = output.raw
        else:
            block = self.cipher.decrypt(block)
        words = array.array("I", block)
        words.byteswap()
        return words.tobytes() + data[full:]


def mt_first(seed):
    """First MT19937 output using CatSystem's 1999 initialization."""
    state = []
    for _ in range(398):
        high = seed & 0xffff0000
        seed = (69069 * seed + 1) & 0xffffffff
        state.append(high | (seed >> 16))
        seed = (69069 * seed + 1) & 0xffffffff
    joined = (state[0] & 0x80000000) | (state[1] & 0x7fffffff)
    value = state[397] ^ (joined >> 1) ^ (0x9908b0df if joined & 1 else 0)
    value ^= value >> 11
    value ^= (value << 7) & 0x9d2c5680
    value ^= (value << 15) & 0xefc60000
    return (value ^ (value >> 18)) & 0xffffffff


def name_seed(vcode):
    value = 0xffffffff
    for byte in vcode.split(b"\0", 1)[0]:
        value ^= byte << 24
        for _ in range(8):
            value = (value << 1) ^ (0x04c11db7 if value & 0x80000000 else 0)
        value = ~value & 0xffffffff
    return value


def decode_name(raw, seed, index):
    value = mt_first((seed + index) & 0xffffffff)
    key = sum((value >> bit) & 255 for bit in (0, 8, 16, 24)) & 255
    output = bytearray()
    for byte in raw.split(b"\0", 1)[0]:
        if 65 <= byte <= 90 or 97 <= byte <= 122:
            pos = byte - (65 if byte <= 90 else 71)
            pos = (pos + key) % 52
            byte = (122 if pos < 26 else 116) - pos
        output.append(byte)
        key += 1
    return output.decode("cp932")


def pe_resources(data):
    """Read named PE resources directly; no pefile or Windows dependency."""
    if data[:2] != b"MZ":
        raise FormatError("Missing PE DOS signature")
    pe, = struct.unpack_from("<I", data, 0x3c)
    if data[pe:pe + 4] != b"PE\0\0":
        raise FormatError("Missing PE signature")
    sections, = struct.unpack_from("<H", data, pe + 6)
    optional_size, = struct.unpack_from("<H", data, pe + 20)
    optional = pe + 24
    magic, = struct.unpack_from("<H", data, optional)
    directory = optional + (96 if magic == 0x10b else 112 if magic == 0x20b else 0)
    if directory == optional:
        raise FormatError("Unsupported PE optional header")
    resource_rva, = struct.unpack_from("<I", data, directory + 16)
    regions = []
    for at in range(optional + optional_size, optional + optional_size + sections * 40, 40):
        size, rva, disk_size, disk_at = struct.unpack_from("<IIII", data, at + 8)
        regions.append((rva, max(size, disk_size), disk_at))
    def offset(rva):
        for base, size, disk in regions:
            if base <= rva < base + size:
                return disk + rva - base
        raise FormatError("PE resource address outside sections")
    base = offset(resource_rva)
    results = {}
    def walk(at, names, depth):
        if depth > 3:
            raise FormatError("PE resource tree exceeds expected depth")
        named, numbered = struct.unpack_from("<HH", data, at + 12)
        for i in range(named + numbered):
            name, dest = struct.unpack_from("<II", data, at + 16 + i * 8)
            if name & 0x80000000:
                where = base + (name & 0x7fffffff)
                length, = struct.unpack_from("<H", data, where)
                name = data[where + 2:where + 2 + length * 2].decode("utf-16le")
            key = names + (name,)
            where = base + (dest & 0x7fffffff)
            if dest & 0x80000000:
                walk(where, key, depth + 1)
            else:
                rva, length = struct.unpack_from("<II", data, where)
                where = offset(rva)
                results[key] = data[where:where + length]
    walk(base, (), 0)
    return results


def vcode2(data):
    resources = pe_resources(data)
    def find(kind, name):
        return next((v for k, v in resources.items() if k[:2] == (kind, name)), None)
    key = find("KEY_CODE", "KEY")
    key = bytes(byte ^ 0xcd for byte in key) if key else b"windmill"
    code = find("V_CODE2", "DATA")
    if code is None:
        raise FormatError("Executable has no V_CODE2 resource")
    return Blowfish(key).decrypt(code).rstrip(b"\0")


class StoredMember(io.RawIOBase):
    """Independent bounded file view of a ZIP_STORED member."""
    def __init__(self, zip_path, info):
        if info.compress_type != zipfile.ZIP_STORED or info.flag_bits & 1:
            raise FormatError("Original ZIP members must be stored and unencrypted")
        self.file = Path(zip_path).open("rb")
        self.file.seek(info.header_offset)
        header = self.file.read(30)
        if header[:4] != b"PK\x03\x04":
            raise FormatError("Invalid ZIP local member header")
        name_len, extra_len = struct.unpack_from("<HH", header, 26)
        self.base = info.header_offset + 30 + name_len + extra_len
        self.size = info.file_size
        self.position = 0
    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.position
    def seek(self, offset, whence=0):
        pos = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        if not 0 <= pos <= self.size:
            raise ValueError("Seek outside ZIP member")
        self.position = pos
        return pos
    def read(self, size=-1):
        size = self.size - self.position if size < 0 else min(size, self.size - self.position)
        self.file.seek(self.base + self.position)
        data = self.file.read(size)
        self.position += len(data)
        return data
    def close(self):
        if hasattr(self, "file"):
            self.file.close()
        super().close()


class GameSource:
    def __init__(self, path):
        self.path = Path(path)
        self.zip = zipfile.ZipFile(path) if self.path.is_file() else None
        if self.zip:
            self.members = {Path(i.filename).name.casefold(): i for i in self.zip.infolist()
                            if "game-data/original/2+/" in i.filename and not i.is_dir()}
        else:
            self.members = {p.name.casefold(): p for p in self.path.iterdir() if p.is_file()}
        with self.open("cs2.exe") as stream:
            self.seed = name_seed(vcode2(stream.read()))
        self.archives = {}
    def open(self, name):
        info = self.members[name.casefold()]
        return StoredMember(self.path, info) if self.zip else info.open("rb")
    def archive(self, name):
        key = name.casefold()
        if key not in self.archives:
            stream = self.open(name)
            try:
                self.archives[key] = KifArchive(stream, self.seed)
            except Exception:
                stream.close()
                raise
        return self.archives[key]
    def close(self):
        for archive in self.archives.values(): archive.close()
        if self.zip: self.zip.close()
    def __enter__(self): return self
    def __exit__(self, *_): self.close()


@dataclass(frozen=True)
class Entry:
    name: str
    offset: int
    length: int


class KifArchive:
    def __init__(self, stream, seed):
        self.stream = stream
        header = stream.read(8)
        if len(header) != 8 or header[:4] != b"KIF\0":
            raise FormatError("Missing KIF header")
        count, = struct.unpack_from("<I", header, 4)
        if count > 1_000_000:
            raise FormatError("KIF entry count exceeds limit")
        first = stream.read(72)
        self.cipher = None
        self.entries = {}
        if not count:
            return
        # This game's archives use 64-byte names (KIF v2).
        if len(first) != 72:
            raise FormatError("Truncated KIF table")
        records = [first] + [stream.read(72) for _ in range(count - 1)]
        encrypted = first.startswith(b"__key__.dat\0")
        if encrypted:
            _, _, length = struct.unpack("<64sII", first)
            self.cipher = Blowfish(struct.pack("<I", mt_first(length)))
        stream.seek(0, 2)
        archive_size = stream.tell()
        for index, record in enumerate(records):
            if encrypted and index == 0:
                continue
            if len(record) != 72:
                raise FormatError("Truncated KIF entry")
            raw, at, length = struct.unpack("<64sII", record)
            if encrypted:
                at, length = struct.unpack("<II", self.cipher.decrypt(struct.pack("<II", (at + index) & 0xffffffff, length)))
                name = decode_name(raw, seed, index)
            else:
                name = raw.split(b"\0", 1)[0].decode("cp932")
            if at < 8 + count * 72 or at + length > archive_size:
                raise FormatError(f"KIF entry outside archive: {name}")
            self.entries[name.casefold()] = Entry(name, at, length)
    def read(self, name):
        entry = self.entries[name.casefold()]
        self.stream.seek(entry.offset)
        data = self.stream.read(entry.length)
        if len(data) != entry.length:
            raise FormatError(f"Truncated KIF payload: {name}")
        return self.cipher.decrypt(data) if self.cipher else data
    def close(self): self.stream.close()
