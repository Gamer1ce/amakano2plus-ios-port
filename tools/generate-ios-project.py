#!/usr/bin/env python3
"""Generate the project and include locally imported icon resources, if any."""
from pathlib import Path
import hashlib
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ios = ROOT / 'ios'
subprocess.run([sys.executable, str(ios / 'generate-project.py'), '--full'], check=True)
project = ios / 'AmakanoPort.xcodeproj/project.pbxproj'
text = project.read_text()
artwork = ios / 'ImportedArtwork'
build_ids = []
refs = []
objects = []
for path in sorted(artwork.glob('*.png')):
    if path.is_symlink() or not path.is_file() or not path.stem.replace('@', '').replace('-', '').replace('_', '').isalnum():
        raise ValueError('Unsafe icon resource')
    ref = 'C' + hashlib.sha256(('ref:' + path.name).encode()).hexdigest()[:23].upper()
    build = 'C' + hashlib.sha256(('build:' + path.name).encode()).hexdigest()[:23].upper()
    refs.append(ref)
    build_ids.append(build)
    objects.extend([
        f'{ref} = {{isa = PBXFileReference; lastKnownFileType = image.png; path = "ImportedArtwork/{path.name}"; sourceTree = "<group>"; }};',
        f'{build} = {{isa = PBXBuildFile; fileRef = {ref}; }};',
    ])
text = text.replace('objects = {', 'objects = {\n' + '\n'.join(objects), 1)
if refs:
    text = text.replace('children = (A00000000000000000000010,', 'children = (' + ', '.join(refs) + ', A00000000000000000000010,', 1)
    text = text.replace('files = (A00000000000000000000002);', 'files = (A00000000000000000000002, ' + ', '.join(build_ids) + ');', 1)
if (ios / 'local-app-info.plist').is_file():
    text = text.replace('INFOPLIST_FILE = App/Info.plist;', 'INFOPLIST_FILE = "local-app-info.plist";')
text = text.replace('CURRENT_PROJECT_VERSION = 1;', 'CURRENT_PROJECT_VERSION = 120;')
text = text.replace('MARKETING_VERSION = 0.1.0;', 'MARKETING_VERSION = 1.0;')
project.write_text(text)
print('Project configured; local artwork remains excluded from Git.')
