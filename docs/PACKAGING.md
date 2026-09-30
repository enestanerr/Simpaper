# Packaging

How a Windows release of Simpaper is built, reproducibly, from a clean checkout. The reasoning is in
[ADR 0008](adr/0008-packaging.md); the configuration is `electron-builder.yml` and `scripts/engine/`.

## Prerequisites

- Windows 10/11 x64, Node.js 22.13 or newer (CI uses Node 22), Git for Windows (provides `gpg`).
- About 6 GB of free disk space for a full build: the engine MSI (0.36 GB; `vendor/downloads` can be deleted after
  extraction), its extracted image (1.6 GB), the prepared engine (0.74 GB, but hard links into the image when
  possible, so almost no extra space), `node_modules` (0.9 GB), the Electron and electron-builder download caches
  (about 0.2 GB) and the output in `release/` (about 1.9 GB: installer, ZIP and the unpacked app).
- Network access during the build only (the app itself never downloads anything).

## Reproducible build

```powershell
npm ci                                   # exact dependency versions from package-lock.json
npm run engine:fetch                     # download + verify + extract the pinned LibreOffice (idempotent)
npm run engine:prepare -- --verify       # build vendor/engine-dist and smoke-test it headlessly
npm run notices                          # refresh THIRD_PARTY_NOTICES.md (commit it if it changed)
npm run dist:win -- --publish never      # electron-vite build + electron-builder (NSIS installer + ZIP)
```

The output is written to `release/`:

| File | Content |
|---|---|
| `Simpaper-Setup-<version>-x64.exe` | Per-user NSIS installer (no administrator rights needed; English and Turkish) |
| `Simpaper-<version>-x64.zip` | The same application as a ZIP for portable use |

`npm run dist:dir` builds the unpacked application only (`release/win-unpacked/`), which is useful for checking the
layout without creating an installer.

## Engine lock

`scripts/engine/engine.lock.json` pins the engine:

| Field | Value |
|---|---|
| `version` | `26.8.0.3` |
| `msiUrl` | TDF's download archive (stable for pinned builds) |
| `fallbackUrl` | TDF's mirror network (`/stable/`), used only when the archive is unreachable |
| `sha256` | `4aa6c6e1895f4055104effcb556bd3362d20c6ad707c149543304f395ef9db95` |
| `sizeBytes` | `374906880` |
| `gpgFingerprint` | `C2839ECAD9408FBE9531C3E9F434A1EFAFEEAEA3` (LibreOffice Build Team code-signing key) |
| `sourceUrl` | <https://download.documentfoundation.org/libreoffice/src/26.8.0/> |

`scripts/engine/fetch-engine.ps1`:

1. stops immediately (no network access) when `vendor/libreoffice` already holds the pinned version;
2. reuses a verified MSI from `vendor/downloads`, or downloads it with retries (archive URL, then fallback);
3. verifies the size and SHA-256 digest;
4. verifies the OpenPGP signature (`.asc`) with `gpg` when available: the key is fetched over HTTPS from
   `keyserver.ubuntu.com` into a private keyring (`vendor/downloads/gnupg`) and the full fingerprint must match;
   a bad signature always fails, a missing `gpg` only warns unless `-RequireSignature` is given;
5. extracts the MSI with an administrative installation (`msiexec /a`, no system changes) into
   `vendor/libreoffice` and records the provenance in `vendor/engine-image.json`.

Useful switches: `-VerifyOnly` (verify without extracting), `-Force` (re-extract), `-RequireSignature`,
`-DownloadDir` / `-EngineDir` (for example to keep the large files on another drive). The script refuses to write
into system folders.

### Updating the engine

1. Pick the new build from <https://downloadarchive.documentfoundation.org/libreoffice/old/> (4-part version).
2. Update `engine.lock.json` (URLs, size, SHA-256 from the server's `.sha256`, fingerprint only if TDF rotates its
   key) and `sourceUrl`.
3. Run `npm run engine:fetch -- -Force`, `npm run engine:prepare -- --verify`, `npm run test:engine`.
4. Check the release notes and bug tracker for regressions in the formats of [COMPATIBILITY.md](COMPATIBILITY.md),
   update the docs and `THIRD_PARTY_NOTICES.md` (`npm run notices`).

## Engine preparation

`scripts/engine/prepare-engine.mjs` builds `vendor/engine-dist` (packaged as `resources/engine`). LibreOffice files
are taken **byte for byte**, as hard links when possible (no extra disk space) or as copies (`--copy`).

| Step | Why |
|---|---|
| Keep UI languages `en-US` and `tr` only (`--ui-langs`, env `SIMPAPER_ENGINE_UI_LANGS`): `program/resource/<lang>`, `share/registry/Langpack-<lang>.xcd`, `share/registry/res/*_<lang>.xcd`, `share/autotext/<lang>`, `share/extensions/*/help/<lang>` | Simpaper offers Turkish and English only |
| Keep spelling dictionaries and word lists for `en` and `tr` only (`--dicts`, env `SIMPAPER_ENGINE_DICTIONARIES`): `share/extensions/dict-*`, `share/wordbook/*.dic` | Saves about 390 MiB; more languages can be added |
| Move `Fonts/*` to `share/fonts/truetype/` | LibreOffice registers fonts from there privately; in the admin image they are not used at all (verified: without the move, LibreOffice substitutes Calibri and Times New Roman for Carlito and Liberation Serif) |
| Move `System64/*.dll` (Visual C++ runtime) to `program/` | The MSI normally installs the runtime system-wide; a per-user app must bring it along |
| Leave out `help/`, the admin-image MSI copy, `System/` (32-bit runtime) and `__pycache__` folders | Not needed at run time |
| Keep `LICENSE.html`, `license.txt`, `NOTICE`, `CREDITS.fodt`, `readmes/` unchanged | License compliance |
| Write `SIMPAPER-ENGINE.json` | Version, build id, MSI digest, languages, sizes, and every removed or relocated item |

`--verify` runs `scripts/engine/verify-engine.mjs` on the result: a Flat ODF document with Turkish text in Carlito
and Liberation Serif is converted to PDF and DOCX with `soffice.exe --headless`, using a throw-away profile under
`test-output/`; the PDF text is read back with pdf.js, the embedded fonts are checked, and the DOCX text is read back
from `word/document.xml`. All processes are stopped afterwards, and files the engine wrote into its own folder are
removed.

## Sizes

Measured on 2026-09-29 with LibreOffice 26.8.0.3:

| Item | Size |
|---|---|
| Engine MSI | 374,906,880 bytes (357.5 MiB) |
| Extracted image (`vendor/libreoffice`) | 1,524 MiB, 19,483 files |
| Prepared engine (`vendor/engine-dist`) | **741 MiB, 6,712 files** |
| — of which left out | spelling dictionaries 393 MiB, other UI languages 349 MiB, MSI copy 19 MiB, help 11 MiB, extension help 4.5 MiB, AutoText 3 MiB, 32-bit runtime 1.5 MiB |
| Electron 44.4.5 runtime (before locale pruning) | about 368 MB |
| Unpacked application (`release/win-unpacked`, 0.1.0 build of 2026-09-29 evening) | **1,109 MiB, 6,823 files**, of which `resources/engine` 742 MiB (6,713 files) and `app.asar` 44 MiB |
| Installer `Simpaper-Setup-0.1.0-x64.exe` | 346,332,767 bytes (330.3 MiB; without `elevate.exe`) |
| ZIP `Simpaper-0.1.0-x64.zip` | 456,570,179 bytes (435.4 MiB) |

The uncompressed payload of about 1.1 GB is below NSIS's 2 GB limit. The installer was installed and used on the
development PC (per user, no administrator rights); a clean machine is still to be tried.

### Checking the package layout without an installer

`npm run dist:dir` (or `npx electron-builder --win dir --config.directories.output=<folder>` after
`npm run build`) produces `win-unpacked/`. On 2026-09-29 such a build was checked file by file: the 6,713 files
of `resources/engine` were byte-identical to `vendor/engine-dist` (SHA-256), `resources/bridge` contained only
the `simpaper_bridge` modules, koffi and `@koromix/koffi-win32-x64` were in `app.asar.unpacked` and loaded from the
packaged path, `LICENSE.txt` and `THIRD_PARTY_NOTICES.md` were next to `Simpaper.exe`, and the fuses listed below were
set. The application itself was not started (that opens windows).

## Installer behaviour

- Assisted NSIS installer, x64, **per user**: the install-mode page defaults to "Only for me"; installing for all
  users is disabled unless the installer is run as administrator (`allowElevation: false`).
- The installation folder can be changed; desktop and Start-menu shortcuts are created; the installer is English
  or Turkish depending on the Windows display language.
- Uninstalling keeps the user's settings and recovery data (`deleteAppDataOnUninstall: false`).
- Electron fuses: `runAsNode` off, `NODE_OPTIONS` and `--inspect` ignored, cookie encryption on, embedded ASAR
  integrity validation on, the app is loaded only from `app.asar`.
- Packaged resources: `resources/engine` (prepared engine; program folder `resources/engine/program`, fonts in
  `resources/engine/share/fonts/truetype`), `resources/bridge` (UNO bridge without tests and caches),
  `resources/profile` (engine profile template). The main process finds them through
  `src/main/engine/locate.ts`. pdf.js' worker, CMaps, fonts and WASM decoders are bundled into `out/renderer` by
  Vite.
- The native module koffi (Win32 bindings) is unpacked from `app.asar` (`asarUnpack`), as Node-API binaries can't
  be loaded from inside an archive.
- `LICENSE.txt` (MPL-2.0) and `THIRD_PARTY_NOTICES.md` are installed next to `Simpaper.exe`; Electron's
  `LICENSE.electron.txt` and `LICENSES.chromium.html` are added by electron-builder.
- No file associations and no auto-update in v0.1 (planned for M3).

## Signing plan

Releases are **unsigned** for now; Windows SmartScreen warns on first start. `electron-builder.yml` sets
`win.signExecutable: false`, so electron-builder never signs anything, even when a certificate happens to be
configured on the build machine. Reason: electron-builder signs every `.exe` it copies from `extraResources`; a
test build queued 44 LibreOffice and Python executables for signing, which would have replaced The Document
Foundation's own signatures and changed files that must stay byte-identical to the MSI.

The plan:

1. Apply to the **SignPath Foundation** (free code signing for OSI-licensed open-source projects). Requirements:
   an OSI license (MPL-2.0), no proprietary components, a published code-signing policy, multi-factor
   authentication for maintainers, and releases built by CI from the public repository.
2. Publish the code-signing policy in this repository (who may approve a signing request, which artifacts are
   signed).
3. Add the signing steps to `.github/workflows/release.yml`: build `win-unpacked`, have SignPath sign `Simpaper.exe`
   (only Simpaper's own files, **never** anything under `resources/engine`), build the installer and the ZIP from the
   signed folder (`electron-builder --prepackaged`), then sign the installer. The uninstaller is generated inside
   the NSIS build, so signing it needs a custom signing hook that forwards only that file to SignPath; this is to
   be designed together with the SignPath setup.

Azure Artifact Signing is not an option for individual maintainers outside the US and Canada.

## Source code of the engine

LibreOffice is redistributed unmodified. Its license files are shipped in `resources/engine`, and
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md#libreoffice-engine) lists its components. The corresponding
source code of the shipped version is available from The Document Foundation at the `sourceUrl` of the lock file
(`libreoffice-26.8.0.3.tar.xz` and the dictionaries, help and translations tarballs; external libraries are listed in
the source tree's `download.lst`). **Before the first public release**, the source tarballs of the shipped version
will be attached to the GitHub release (or a dedicated source mirror), so that the source offer for the GPL/LGPL
components does not depend on a third-party server.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main`, on pull requests and on demand, on `windows-latest` with
Node 22:

| Job | Steps |
|---|---|
| `build` | `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build` |
| `engine-tests` | `npm ci` → engine image from the cache (key: hash of `scripts/engine/engine.lock.json`) or `fetch-engine.ps1` on a cache miss → `npm run test:engine` (with `ELECTRON_RUN_AS_NODE` removed) → the unit tests that need the engine image (`tests/unit/renderer/commands.test.ts`, `src/main/engine/launch.test.ts`) and the Python bridge tests; `test-output/` is uploaded as an artifact when the job fails |

The cache holds only the extracted engine image (`vendor/libreoffice`, about 1.5 GB); the MSI is deleted after
extraction (`-RemoveMsiAfterExtract`). A new lock file means a new cache key, so an engine update is always fetched
and verified again.

## Release workflow

`.github/workflows/release.yml` runs on tags `v*` (and can be started by hand for an existing tag). It never uses
the CI cache: it downloads the engine and requires a valid OpenPGP signature (`-RequireSignature`), prepares and
verifies it (`npm run engine:prepare -- --verify`), checks that the tag matches the version in `package.json`,
builds the installer and the ZIP with `npm run dist:win -- --publish never`, records SHA-256 checksums, and uploads
everything to a **draft** GitHub release for manual review. Nothing is published automatically, and nothing is
signed (see [Signing plan](#signing-plan)).
