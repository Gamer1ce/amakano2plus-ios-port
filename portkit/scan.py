"""Create a lossless JSON script set and a compatibility inventory."""
from pathlib import Path
from collections import Counter, defaultdict
import argparse
import json
import re
from dataclasses import asdict
from .cst import read_scene


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, default=Path("game-data/extracted/scene"))
    parser.add_argument("--patch", type=Path, default=Path("game-data/extracted/cndate04"))
    parser.add_argument("--output", type=Path, default=Path("game-data/converted"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    scene_dir = args.output / "scenes"
    scene_dir.mkdir(exist_ok=True)
    files = {p.name.casefold(): (p, "cp932", "base") for p in args.base.glob("*.cst")}
    files.update({p.name.casefold(): (p, "utf-8", "chinese-patch") for p in args.patch.glob("*.cst")})
    commands, line_types, origins = Counter(), Counter(), Counter()
    examples = defaultdict(list)
    scenes, failures = {}, []
    for key, (path, encoding, origin) in sorted(files.items()):
        try:
            lines = read_scene(path.read_bytes(), dialogue_encoding=encoding, command_encoding=encoding, fallback_encoding="cp932" if origin == "chinese-patch" else None)
        except (ValueError, UnicodeError) as exc:
            failures.append({"scene": path.name, "origin": origin, "error": str(exc)})
            continue
        origins[origin] += 1
        message_count = sum(line.type == 0x2001 for line in lines)
        scenes[path.stem.casefold()] = {"file": path.stem + ".json", "origin": origin, "lineCount": len(lines), "messageCount": message_count}
        target = scene_dir / (path.stem + ".json")
        target.write_text(json.dumps({"id": path.stem, "origin": origin, "lines": [asdict(x) for x in lines]}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        for line in lines:
            line_types[hex(line.type)] += 1
            if line.type != 0x3001:
                continue
            text = line.text.strip()
            if not text:
                continue
            if text.startswith("#"):
                command = "assignment"
            elif text.startswith("("):
                command = "expression"
            else:
                command = re.split(r"[\s(]", text, 1)[0]
            commands[command] += 1
            if len(examples[command]) < 4:
                examples[command].append(text)
    manifest = {"formatVersion": 1, "game": "Amakano 2+", "virtualWidth": 1600, "virtualHeight": 900, "scenes": scenes}
    (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    report = {"sceneCount": len(scenes), "origins": dict(origins), "lineTypes": dict(line_types), "commands": dict(commands.most_common()), "commandExamples": dict(examples), "failures": failures}
    (args.output / "script-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"sceneCount":len(scenes), "origins":dict(origins), "commandTypes":len(commands), "failures":failures[:10]},ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
