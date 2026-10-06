#!/usr/bin/env python3
"""Overlay public runtime code on an existing, validated local Content."""
from pathlib import Path
import json
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ios'))
from content_validation import content_manifest, verify_content


def sync(root=ROOT):
    content = root / 'ios/Content'
    previous = verify_content(content, False)
    private = json.loads((root / 'tools/private-inputs.json').read_text())
    missing = [p for p in private if not (content / p).is_file()]
    if missing:
        raise ValueError('Missing local resource/SDK inputs: ' + ', '.join(missing))
    for source in sorted((root / 'runtime').rglob('*')):
        if not source.is_file():
            continue
        if source.is_symlink():
            raise ValueError('Runtime source contains a symlink')
        name = source.relative_to(root).as_posix()
        if name in private or source.name == 'package.json':
            continue
        if source.suffix not in ('.js', '.mjs', '.html', '.css'):
            continue
        target = content / name
        if target.is_symlink() or not target.resolve().is_relative_to(content.resolve()):
            raise ValueError('Runtime target escapes Content')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    manifest = content_manifest(content, previous['mode'], previous['completeAssets'])
    (content / 'content-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    verify_content(content, False)


if __name__ == '__main__':
    sync()
    print('Public runtime synchronized; local resources preserved; manifest verified.')
