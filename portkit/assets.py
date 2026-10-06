"""Resumable native preparation of original assets for the portable runtime.

The default processes assets requested by preview-trace.json. --all prepares
the complete game. Originals are read only; converted output is reproducible.
"""
from pathlib import Path
from collections import defaultdict
import argparse
import gzip
import json
import shutil
import subprocess
import struct
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "game-data"
CAT = ROOT / "tools/CatAssets/bin/Release/net462/CatAssets.exe"
GAME = DATA / "original/2+"
FREE = ROOT / "tools/freemote-toolkit"


def run(args):
    result = subprocess.run([str(x) for x in args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(result.stdout.decode("utf-8", errors="replace")[-4000:])


def inventory():
    entries = json.loads((DATA / "catalog/catalog.json").read_text(encoding="utf-8"))
    def priority(e):
        name = e["archive"].casefold()
        return (3 if name.startswith("cndate") else 2 if name.startswith("update") else 1, name)
    return {e["name"].casefold(): e for e in sorted((e for e in entries if "name" in e), key=priority)}


def windows_main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    index = inventory()
    wanted = set()
    profiles = json.loads((DATA / "converted/profiles.json").read_text(encoding="utf-8"))
    if args.all:
        wanted.update(k for k in index if k.endswith((".hg3", ".psz", ".ogg", ".mpg")))
    else:
        trace = json.loads((DATA / "converted/preview-trace.json").read_text(encoding="utf-8"))
        for row in trace["commands"]:
            cmd, parts = row["command"], row["args"].split()
            if cmd in ("bg", "cg", "fg", "eg", "fw", "pl", "mpl") and len(parts) >= 2:
                token = parts[1].split(":")[0].split(",")
                key = token[0].casefold()
                if key in profiles and len(token) >= 2:
                    profile = profiles[key]["variants"].get(token[1])
                    if profile:
                        wanted.add(profile["model"] + ".psz")
                elif key + ".hg3" in index:
                    wanted.add(key + ".hg3")
            if cmd == "pcm" and parts and parts[0].casefold() + ".ogg" in index:
                wanted.add(parts[0].casefold() + ".ogg")
            if cmd in ("bgm", "se") and len(parts) >= 2 and parts[1].casefold() + ".ogg" in index:
                wanted.add(parts[1].casefold() + ".ogg")
    output = DATA / "converted/assets"
    output.mkdir(parents=True, exist_ok=True)
    asset_path = DATA / "converted/assets.json"
    assets = json.loads(asset_path.read_text(encoding="utf-8")) if asset_path.exists() else {}
    groups = defaultdict(list)
    for key in sorted(wanted):
        if key not in index:
            raise ValueError(f"Missing original asset: {key}")
        groups[index[key]["archive"]].append(index[key]["name"])
    ffmpeg = next((ROOT / "tools/ffmpeg").rglob("ffmpeg*.exe"), None)
    if not ffmpeg:
        raise ValueError("FFmpeg missing; see tools/setup-windows.ps1")
    failures = []
    for archive, names in groups.items():
        for chunk_start in range(0, len(names), 50):
            chunk = names[chunk_start:chunk_start + 50]
            normal = [n for n in chunk if not n.lower().endswith(".hg3")]
            images = [n for n in chunk if n.lower().endswith(".hg3")]
            if normal:
                run([CAT, "extract", GAME, DATA / "asset-work/raw", archive, ";".join(normal)])
            if images:
                run([CAT, "images", GAME, DATA / "asset-work/images", archive, ";".join(images)])
            for name in chunk:
                key, stem = name.casefold(), Path(name).stem.casefold()
                try:
                    if key.endswith(".hg3"):
                        folder = DATA / "asset-work/images" / Path(archive).stem / Path(name).stem
                        frames = json.loads((folder / "frames.json").read_text(encoding="utf-8"))
                        pngs = sorted(folder.glob("*.png"))
                        if len(frames) != len(pngs):
                            raise ValueError(f"HG3 frame count mismatch {name}")
                        converted = []
                        for frame in frames:
                            expected = frame.get("file") or (Path(name).stem + ("" if len(frames) == 1 else "+" + str(frame["id"]).zfill(4)) + ".png")
                            png = folder / expected
                            if not png.exists():
                                raise ValueError(f"Missing HG3 frame file {expected}")
                            target = output / "images" / (stem + "_" + str(frame["id"]) + ".webp")
                            target.parent.mkdir(exist_ok=True)
                            if not target.exists():
                                with Image.open(png) as image:
                                    image.save(target, format="WEBP", quality=92, method=5)
                            converted.append({**frame, "file": target.relative_to(DATA / "converted").as_posix()})
                        assets[stem] = {"kind": "image", "origin": archive, "frames": converted}
                    elif key.endswith(".ogg"):
                        raw = DATA / "asset-work/raw" / Path(archive).stem / name
                        target = output / "audio" / (stem + ".m4a")
                        target.parent.mkdir(exist_ok=True)
                        if not target.exists():
                            run([ffmpeg, "-v", "error", "-nostdin", "-y", "-i", raw, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", target])
                        assets[stem] = {"kind": "audio", "origin": archive, "file": target.relative_to(DATA / "converted").as_posix()}
                    elif key.endswith(".psz"):
                        target = output / "emote" / (stem + ".psb.gz")
                        target.parent.mkdir(exist_ok=True)
                        if not target.exists():
                            pure = DATA / "converted/emote" / (stem + ".psb")
                            if not pure.exists():
                                raw = DATA / "asset-work/raw" / Path(archive).stem / name
                                work = DATA / "asset-work/emote" / stem
                                work.mkdir(parents=True, exist_ok=True)
                                run([FREE / "PsbDecompile.exe", "-o", work, raw])
                                source = work / (stem + ".json")
                                pure.parent.mkdir(parents=True, exist_ok=True)
                                run([FREE / "PsBuild.exe", "-p", "ems", "-v", "3", "-ns", "-o", pure, source])
                            with pure.open("rb") as source:
                                header = source.read(8)
                                if header[:4] != b"PSB\0" or struct.unpack_from("<H", header, 4)[0] != 3:
                                    raise ValueError("Expected verified PSB v3 ems asset")
                                source.seek(0)
                                with gzip.GzipFile(str(target), "wb", compresslevel=6, mtime=0) as dest:
                                    shutil.copyfileobj(source, dest)
                        assets[stem] = {"kind": "emote", "origin": archive, "file": target.relative_to(DATA / "converted").as_posix()}
                    else:
                        # MPG conversion is deliberately explicit; not silently omitted.
                        raise ValueError("Movie conversion is not implemented yet")
                    print(f"OK {name}", flush=True)
                except Exception as exc:
                    failures.append({"asset": name, "error": str(exc)})
                    print(f"FAILED {name}: {exc}", flush=True)
                asset_path.write_text(json.dumps(assets, ensure_ascii=False, indent=2), encoding="utf-8")
    report = {"completeGame": args.all and not failures, "requested": len(wanted), "prepared": len(assets), "failures": failures}
    (DATA / "converted/asset-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report))
    return 1 if failures else 0


def main():
    if sys.platform == "win32" and "--source" not in sys.argv:
        return windows_main()
    from .portable_assets import main as portable_main
    return portable_main()


if __name__ == "__main__":
    raise SystemExit(main())
