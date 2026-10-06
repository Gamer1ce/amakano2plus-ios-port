#!/usr/bin/env python3
"""Import only resources from the user's local R20 IPA; never run/upload it."""
import argparse
import importlib.util
import json
from pathlib import Path, PurePosixPath
import plistlib
import shutil
import stat
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ios'))
from content_validation import verify_content

PREFIX = 'Payload/AmakanoPort.app/'
MAX_PAYLOAD = 32 * 1024**3
MAX_MEMBER = 512 * 1024**2


def safe_name(name):
    path = PurePosixPath(name)
    if (not name or name.startswith('/') or '\\' in name
            or any(p in ('', '.', '..') for p in name.rstrip('/').split('/'))
            or any(ord(c) < 32 for c in name)):
        raise ValueError('Unsafe archive path')
    return path


def archive_plan(archive):
    seen = set()
    total = 0
    entries = []
    for info in archive.infolist():
        safe_name(info.filename)
        key = info.filename.rstrip('/').casefold()
        if key in seen:
            raise ValueError('Duplicate archive path')
        seen.add(key)
        mode = info.external_attr >> 16
        if stat.S_ISLNK(mode) or stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ValueError('Archive contains a link or special file')
        if info.flag_bits & 1:
            raise ValueError('Encrypted ZIP members are unsupported')
        if info.file_size > MAX_MEMBER:
            raise ValueError('Archive member exceeds size limit')
        if info.filename.startswith(PREFIX + 'Content/') and not info.is_dir():
            entries.append(info)
            total += info.file_size
    if not entries or len(seen) > 100_000 or total > MAX_PAYLOAD:
        raise ValueError('Missing or oversized Content')
    return entries, total


def stream_member(archive, info, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with archive.open(info) as source, destination.open('xb') as output:
        shutil.copyfileobj(source, output, 1024 * 1024)


def import_content(ipa, ios):
    ios = Path(ios).absolute()
    # Require real ancestors; do not write through a caller-provided symlink.
    for p in (ios, *ios.parents):
        if p.is_symlink():
            raise ValueError('Output ancestor is a symlink')
    ios.mkdir(parents=True, exist_ok=True)
    targets = [ios / 'Content', ios / 'ImportedArtwork', ios / 'local-app-info.plist']
    if any(p.exists() or p.is_symlink() for p in targets):
        raise ValueError('Local Content/artwork already exists; no files overwritten')
    with zipfile.ZipFile(ipa) as archive:
        entries, total = archive_plan(archive)
        plist_entry = archive.getinfo(PREFIX + 'Info.plist')
        if plist_entry.file_size > 1024 * 1024:
            raise ValueError('Oversized app metadata')
        info = plistlib.loads(archive.read(plist_entry))
        if info.get('CFBundleIdentifier') != 'local.amakano2plus' or str(info.get('CFBundleVersion')) != '120':
            raise ValueError('Expected the ordinary local R20 IPA (build 120)')
        if shutil.disk_usage(ios).free < total + 256 * 1024**2:
            raise ValueError('Not enough disk space to import Content')
        with tempfile.TemporaryDirectory(prefix='.Content-import-', dir=ios) as folder:
            stage = Path(folder)
            content = stage / 'Content'
            for entry in entries:
                relative = entry.filename[len(PREFIX + 'Content/'):]
                stream_member(archive, entry, content / relative)
            verify_content(content, False)
            artwork = stage / 'ImportedArtwork'
            artwork.mkdir()
            # Copy only root PNG artwork explicitly referenced by the icon metadata.
            icons = set()
            for key in ('CFBundleIcons', 'CFBundleIcons~ipad'):
                primary = info.get(key, {}).get('CFBundlePrimaryIcon', {})
                icons.update(primary.get('CFBundleIconFiles', []))
            icons.update(info.get('CFBundleIconFiles', []))
            for icon in icons:
                safe_name(icon)
                if '/' in icon:
                    raise ValueError('Icon name must be a basename')
                stem = icon.removesuffix('.png')
                for entry in archive.infolist():
                    relative = entry.filename.removeprefix(PREFIX)
                    if (entry.filename.startswith(PREFIX) and '/' not in relative
                            and relative.endswith('.png')
                            and (relative == stem + '.png' or relative.startswith(stem + '@'))):
                        destination = artwork / relative
                        if not destination.exists():
                            stream_member(archive, entry, destination)
            # Keep source app plist public and copy only icon keys to a local plist.
            base = plistlib.loads((ROOT / 'ios/App/Info.plist').read_bytes())
            for key in ('CFBundleIcons', 'CFBundleIcons~ipad', 'CFBundleIconFiles'):
                if key in info:
                    base[key] = info[key]
            metadata = stage / 'local-app-info.plist'
            metadata.write_bytes(plistlib.dumps(base))
            # Roll back adoption if any rename fails; prior targets were forbidden.
            adopted = []
            try:
                for source, target in zip([content, artwork, metadata], targets):
                    source.rename(target)
                    adopted.append((source, target))
            except BaseException:
                for source, target in reversed(adopted):
                    target.rename(source)
                raise
    return total


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ipa', type=Path, required=True)
    args = parser.parse_args()
    size = import_content(args.ipa, ROOT / 'ios')
    print(f'Imported {size:,} bytes into local ignored ios/Content. Nothing uploaded.')
