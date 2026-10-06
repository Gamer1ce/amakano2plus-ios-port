#!/usr/bin/env python3
"""Check tracked files (or a new source tree) for excluded data and secrets."""
from pathlib import Path
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = set(json.loads((ROOT / 'tools/private-inputs.json').read_text()))
PRIVATE.add('portkit/psb.py')
DENIED_PREFIXES = ('game-data/', 'game-inspection/', 'checks/', 'ios/Content/',
                   'ios/ImportedArtwork/', 'build/', '.venv/', 'node_modules/')
DENIED_EXTENSIONS = {'.ipa', '.zip', '.int', '.psb', '.psz', '.lpb', '.cst',
                     '.ogg', '.m4a', '.mp4', '.mov', '.webp', '.png', '.jpg',
                     '.jpeg', '.gz', '.p12', '.pem', '.key', '.mobileprovision'}
SECRET = re.compile(r'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|'
                    r'sk-proj-[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|'
                    r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)')
LOCAL = re.compile(r'/(?:Users|Volumes)/[^\s"\'<>]+|' + '/home/' + 'oai/')


def check(root=ROOT):
    tracked = subprocess.run(['git', '-C', str(root), 'ls-files', '-z'],
                             capture_output=True)
    names = tracked.stdout.decode().split('\0') if tracked.returncode == 0 else []
    names = [n for n in names if n]
    if not names:
        names = [p.relative_to(root).as_posix() for p in root.rglob('*')
                 if p.is_file() and '.git' not in p.relative_to(root).parts
                 and '__pycache__' not in p.relative_to(root).parts]
    issues = []
    for name in names:
        path = root / name
        if (name in PRIVATE or name.startswith(DENIED_PREFIXES)
                or path.suffix.lower() in DENIED_EXTENSIONS
                or name == 'ios/local-app-info.plist'
                or name.startswith('.env')):
            issues.append((name, 'excluded resource/credential path'))
            continue
        if path.is_symlink() or not path.is_file():
            issues.append((name, 'not a regular source file'))
            continue
        if path.stat().st_size > 2 * 1024**2:
            issues.append((name, 'unexpectedly large source file'))
            continue
        try:
            text = path.read_text()
        except UnicodeError:
            issues.append((name, 'binary file'))
            continue
        if SECRET.search(text):
            issues.append((name, 'secret-like value'))
        if LOCAL.search(text):
            issues.append((name, 'private local path'))
    if issues:
        for name, reason in issues:
            print(f'{name}: {reason}', file=sys.stderr)
        raise SystemExit(1)
    print(f'Public source guard passed: {len(names)} files; excluded data not tracked.')


if __name__ == '__main__':
    check()
