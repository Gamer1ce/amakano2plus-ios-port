# Third-party components and game content

The MIT license covers the port implementation published in this repository.
It grants no rights to the original game, its scripts, artwork, audio, movies,
models, extracted configuration tables, trademarks or separately supplied SDKs.
This is an unofficial project, without endorsement by the original publisher.

The local runtime expects `FreeMoteDriver.js` and `emoteplayer.js` from
[Project AZUSA / FreeMote-SDK](https://github.com/Project-AZUSA/FreeMote-SDK).
They are **not distributed here**. The upstream README distinguishes LGPLv3
source from CC BY-NC-SA 4.0 binaries, including JavaScript binary builds.
Obtain them separately and retain their original attribution and licenses.
`runtime/vendor/fixes.js` is this project's separate adapter, not the SDK.

The optional PSB converter previously used
[UlyssesWu / FreeMote](https://github.com/UlyssesWu/FreeMote). That converter
is not included or relicensed. `portkit.portable_assets` fails explicitly if
PSZ model conversion is requested without a separately supplied converter.

The independent CatScene, KIF and HG-3 readers refer to binary format work by
Robert Jordan:
[TriggersTools.CatSystem2](https://github.com/trigger-segfault/TriggersTools.CatSystem2)
and [catsystem-py](https://github.com/trigger-segfault/catsystem-py).
The KIF reader uses Apple's CommonCrypto on macOS, or PyCryptodome elsewhere;
HG-3 conversion uses Pillow and NumPy. FFmpeg is an external executable.
These dependencies keep their own licenses and are not bundled by this repo.

Any content imported from a locally owned IPA remains local and retains its
original ownership and license. Never upload imported assets, signing keys or
the resulting full-game IPA to this repository or its Releases.
