#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 tools/sync-runtime.py
python3 tools/generate-ios-project.py
xcodebuild -project ios/AmakanoPort.xcodeproj -scheme AmakanoPort \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath build/DerivedData -archivePath build/AmakanoPort.xcarchive \
  archive CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""
python3 ios/package-ipa.py --archive build/AmakanoPort.xcarchive \
  --output build/Amakano2Plus-unsigned.ipa --unsigned-complete-assets
