"""Decode FES helpers and character profiles with Chinese patch precedence."""
from pathlib import Path
import json
import re
import struct
import zlib
import argparse
import xml.etree.ElementTree as ET


def decode(data):
    # Some patched files retain CP932 lines alongside UTF-8 lines.
    result = []
    for line in data.splitlines(keepends=True):
        try:
            result.append(line.decode("utf-8-sig"))
        except UnicodeDecodeError:
            result.append(line.decode("cp932"))
    return "".join(result)


def read_fes(data):
    if len(data) < 16 or data[:4] != b"FES\0":
        raise ValueError("Invalid FES header")
    compressed, expanded, _ = struct.unpack_from("<III", data, 4)
    if compressed != len(data) - 16 or expanded > 16 * 1024 * 1024:
        raise ValueError("Invalid FES lengths")
    inflater = zlib.decompressobj()
    body = inflater.decompress(data[16:], expanded + 1)
    if len(body) != expanded or not inflater.eof or inflater.unused_data:
        raise ValueError("Invalid FES stream")
    return decode(body)


def sections(text):
    result, current = {}, None
    for raw in text.splitlines():
        line = raw.split("//", 1)[0].strip()
        if not line:
            continue
        if line.startswith("#"):
            current = line[1:].casefold()
            result.setdefault(current, [])
        elif current is not None:
            result[current].append(line)
    return result


def register_profiles(profiles, text):
    """Register exact public identifiers from the source m2view.cnf.

    PFL file stems remain usable for existing saves. No suffix, variant or
    filename is guessed: each alias must name a parsed PFL in #profile.
    """
    registrations = {}
    for line in sections(text).get("profile", []):
        parts = line.split()
        if len(parts) != 2:
            raise ValueError(f"Invalid model profile registration: {line}")
        identifier, filename = (part.casefold() for part in parts)
        if (not re.fullmatch(r"[a-z0-9_]+", identifier)
                or not re.fullmatch(r"[a-z0-9_]+\.pfl", filename)):
            raise ValueError(f"Unsafe model profile registration: {line}")
        stem = Path(filename).stem
        if stem not in profiles:
            raise ValueError(f"Registered PFL missing: {filename}")
        previous = registrations.get(identifier)
        if previous and previous != filename:
            raise ValueError(f"Conflicting profile registration: {identifier}")
        if identifier in profiles and profiles[identifier] is not profiles[stem]:
            raise ValueError(f"Profile registration overwrites PFL stem: {identifier}")
        profiles[identifier] = profiles[stem]
        registrations[identifier] = filename
    return registrations


def build(root=Path("game-data")):
    dirs = [root / "extracted/m2config", root / "extracted/fes", root / "extracted/cndate04"]
    files = {}
    for directory in dirs:
        files.update({p.name.casefold(): p for p in directory.iterdir() if p.is_file()})
    profiles, helpers = {}, {}
    for name, path in files.items():
        if name.endswith(".fes"):
            data = sections(read_fes(path.read_bytes()))
            macros = {}
            for line in data.get("macro", []):
                parts = line.split()
                if len(parts) == 2 and parts[1].isdigit():
                    macros[parts[0]] = int(parts[1])
            helpers[path.stem.casefold()] = {"macros": macros, "sections": data}
        if not name.endswith(".pfl"):
            continue
        data = sections(decode(path.read_bytes()))
        variants = {}
        for line in data.get("charaname", []):
            parts = line.split()
            if len(parts) >= 3:
                variants[parts[0]] = {"model": parts[2].casefold(), "motions": {}}
        for line in data.get("motname", []):
            parts = line.split()
            if len(parts) < 4 or parts[0] not in variants:
                continue
            variant, motion, timeline, dif = parts[:4]
            variants[variant]["motions"][motion] = timeline
            if "dif" in variants[variant]:
                continue
            dif_path = files.get(dif.casefold())
            if not dif_path:
                continue
            diff = sections(decode(dif_path.read_bytes()))
            patterns = {}
            for include in diff.get("include", []):
                inc_path = files.get(include.casefold())
                if not inc_path:
                    raise ValueError(f"Missing character include: {include}")
                inc = sections(decode(inc_path.read_bytes()))
                current = None
                for row in inc.get("pattern", []):
                    match = re.match(r"%(\d+)\s+(\S+)", row)
                    if match:
                        current = f"{match[1]}:{match[2]}"
                        patterns[current] = {}
                    elif current:
                        pair = row.split()
                        if len(pair) >= 2:
                            try:
                                patterns[current][pair[0]] = float(pair[1])
                            except ValueError:
                                raise ValueError(f"Unrecognized pattern: {row}")
            variants[variant]["dif"] = {"patterns": patterns, "position": diff.get("position", ["0 0"])[0]}
        profiles[path.stem.casefold()] = {"variants": variants,
            "source": {"file": name, "archive": path.parent.name + ".int"}}
    registration_source = files.get("m2view.cnf")
    if registration_source:
        registrations = register_profiles(profiles, decode(registration_source.read_bytes()))
        registration_report = {"source": {"file": registration_source.name,
            "archive": registration_source.parent.name + ".int"},
            "section": "profile", "registrations": registrations,
            "scope": "Only exact source registrations; PFL stem keys retained"}
    else:
        registration_report = {"source": None, "registrations": {},
            "scope": "No m2view.cnf supplied; only PFL stem identifiers registered"}
    output = root / "converted"
    output.mkdir(parents=True, exist_ok=True)
    for name, value in [("helpers", helpers), ("profiles", profiles),
                        ("profile-registrations", registration_report)]:
        (output / (name + ".json")).write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Decoded {len(helpers)} FES helpers and {len(profiles)} character profiles")


def build_vram(source_path, root=Path("game-data")):
    """Preserve original bank/plane defaults from the merged vram.xml asset."""
    from .kif import GameSource
    from .portable_assets import inventory, atomic_json
    entry = inventory()["vram.xml"]
    with GameSource(source_path) as source:
        raw = source.archive(entry["archive"]).read(entry["name"])
    document = ET.fromstring(raw)
    def value(element):
        if len(element):
            return {child.tag: value(child) for child in element}
        text = (element.text or "").strip()
        return int(text) if re.fullmatch(r"-?\d+", text) else text
    result = {"origin": entry["archive"], **value(document)}
    atomic_json(root / "converted/vram.json", result)
    original = root / "extracted/config/vram.xml"
    original.parent.mkdir(parents=True, exist_ok=True)
    original.write_bytes(raw)
    print(f"Decoded VRAM defaults: {len(result.get('plane', {}))} planes, {len(result.get('image', {}))} image banks")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Original game directory or handoff ZIP, for VRAM settings")
    parser.add_argument("--vram-only", action="store_true")
    args = parser.parse_args()
    if not args.vram_only: build()
    if args.source: build_vram(args.source)
    elif args.vram_only: parser.error("--vram-only requires --source")
