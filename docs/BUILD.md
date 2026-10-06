# Local resource and build workflow

## Public source boundary

`tools/private-inputs.json` names excluded runtime inputs without their bytes.
The static data modules `message-window-data.js`, `native-plane-dimensions-data.js`
and `source-image-anm-data.js` contain original-game-derived tables and are local
inputs, despite their `.js` extension. The remaining public modules refer to
these files; their absence before local import is intentional.

The FreeMote SDK is also a local dependency, not an MIT component of this repo.
Keep its original licenses. There is no publicly downloadable full-game build.

## Importing an existing local payload

The importer accepts only the R20 ordinary application identity
`local.amakano2plus`, build `120`, from a local IPA. It extracts `Content` plus
icon files referenced by the app's property list into ignored directories.
It never extracts the executable, provisioning profile or signatures.
Duplicate ZIP paths, unsafe names, symbolic links and oversized payloads fail.
Extraction uses bounded streaming reads and a new staging directory; existing
Content is never overwritten. It verifies the content manifest before adopting
the result. No network requests are made.

For a clean import:

```sh
python3 tools/import-local-content.py --ipa /path/to/your-own-R20.ipa
python3 tools/sync-runtime.py
python3 tools/generate-ios-project.py
```

`sync-runtime.py` overlays only this repo's public runtime source and rebuilds
the local content manifest. Local tables, media and SDK remain in Content.
Run it again after editing source. The importer and sync tool do not sign code.

The generated Xcode project includes local icon PNGs when provided. No Apple
team, certificate or personal path is committed. Select a signing team in your
local Xcode settings. For an unsigned device archive and IPA, use:

```sh
bash tools/build-ios.sh
```

Packaging checks architecture, iOS platform, manifest bytes and full inventory;
it reports game acceptance and device installation as unverified. Packaging a
valid archive does not prove successful playback or memory behavior on iPad.

## Starting from original Windows resources

`portkit.kif` reads original archives, `portkit.cst` reads CatScene containers,
`portkit.hg3` decodes images, and `portkit.portable_assets` supports resumable
conversion. The original game executable is never executed by these readers.
Some R20-specific extracted tables and model conversion depend on additional
local tooling not included in this source-only publication. This route is
development work, not a complete supported one-command migration.

## Public commits

Run `python3 tools/check-public-tree.py` before committing. Resource directories,
private data modules, artwork, credentials and build outputs are ignored.
The check is a publication guard, not a complete secret scanner; review your
changes, including Git history and any issue attachments, before publication.
