# ADR 0008: Packaging and distribution for Windows

- **Status:** Accepted for v0.1 (signing and auto-update are planned, not configured); item 4 amended 2026-09-30
  by [ADR 0010](0010-file-associations.md) (file associations)
- **Date:** 2026-09-29
- **Related:** [PACKAGING.md](../PACKAGING.md), `electron-builder.yml`, `scripts/engine/`,
  [ADR 0001](0001-engine.md), [ADR 0006](0006-license.md), [ADR 0010](0010-file-associations.md), research:
  [engine](../research/engine.md), [shell](../research/shell.md)

## Context

- Simpaper must install **without administrator rights** on Windows 10/11 x64 and run **offline**; it must never
  download the engine or anything else at run time.
- The engine is the official LibreOffice 26.8.0.3 MSI (374,906,880 bytes). Its administrative extraction is a
  self-contained folder of about 1.5 GiB with all 120+ UI languages, 55 spelling dictionaries and the offline
  help. The extraction does not deploy the Visual C++ runtime (a merge module) and puts the bundled fonts into a
  `Fonts` folder that a portable LibreOffice does not read (they are normally installed into Windows).
- NSIS installers built by electron-builder silently break above 2 GB of uncompressed payload. The `portable`
  target unpacks itself to `%TEMP%` on every start. electron-builder's built-in file associations only work for
  per-machine installs. _Update 2026-09-30:_ that is what electron-builder's documentation says, but its NSIS
  templates write the associations per user as well (below `SHELL_CONTEXT`, i.e. HKCU for a per-user install);
  [ADR 0010](0010-file-associations.md) explains why Simpaper uses its own include instead.
- Code signing: Azure Artifact Signing is not open to individual developers outside the US/Canada; the
  SignPath Foundation signs OSI-licensed projects for free when they meet its policy (published signing
  policy, MFA, builds from CI).
- License duties: keep LibreOffice's license files and notices, say where the exact source code is (MPL-2.0
  §3.2) and provide the corresponding source for its GPL/LGPL components.

## Decision

1. **Engine acquisition** (`npm run engine:fetch`, `scripts/engine/fetch-engine.ps1`): the MSI pinned in
   `scripts/engine/engine.lock.json` is downloaded from TDF's archive (fallback: the mirror network), verified
   by size, **SHA-256** and **OpenPGP signature** (key fingerprint pinned), and extracted with
   `msiexec /a` into `vendor/libreoffice`. The script is idempotent, reuses verified files and writes only
   inside the repository.
2. **Engine preparation** (`npm run engine:prepare`, `scripts/engine/prepare-engine.mjs`) builds
   `vendor/engine-dist`: LibreOffice files are taken **byte for byte**; optional parts are left out
   (UI languages other than en-US and tr, dictionaries other than English and Turkish, the offline help, the
   admin-image MSI copy, the 32-bit runtime, Python caches); bundled fonts move to `share/fonts/truetype`
   (where LibreOffice registers them privately) and the x64 Visual C++ runtime DLLs move to `program/`. The
   result is recorded in `SIMPAPER-ENGINE.json`. `--verify` runs a headless smoke test (`verify-engine.mjs`):
   Turkish text converted to PDF and DOCX, text read back, bundled fonts embedded.
3. **Installer and archive** with **electron-builder 26** (`electron-builder.yml`):
   - NSIS assisted installer, x64, **per-user** (`perMachine: false`, `allowElevation: false`), installation
     folder selectable, desktop and Start-menu shortcuts, installer in English and Turkish;
   - a ZIP archive of the same application for portable use;
   - `resources/engine` (engine-dist), `resources/bridge` (UNO bridge, without tests and caches),
     `resources/profile` (engine profile template);
   - `app.asar` with embedded integrity validation, `onlyLoadAppFromAsar`, `runAsNode` off, `NODE_OPTIONS` and
     inspector flags ignored, cookie encryption on (Electron fuses);
   - Chromium locales reduced to en-US and tr.
4. **Not in v0.1:** code signing (planned: SignPath Foundation), auto-update (electron-updater supports NSIS;
   planned M3), file associations (planned M3 through a custom NSIS include writing per-user `HKCU` ProgIDs and
   letting the user choose defaults), Microsoft Store packages. electron-builder's own signing is switched off
   (`win.signExecutable: false`, added 2026-09-29): with a certificate it would re-sign every `.exe` copied from
   `extraResources`, i.e. replace The Document Foundation's signatures on the engine and break the
   byte-identical guarantee. Signing will be a separate CI step limited to Simpaper's own files.
   _Update 2026-09-30:_ file associations are part of v0.1 after all: `build/installer.nsh` registers the file
   types with their icons and Simpaper's Default apps page, as decided in [ADR 0010](0010-file-associations.md).
5. **Never** register LibreOffice's Maintenance Service or updaters; the engine's update checks are disabled in
   the engine profile, and updates come only with new Simpaper releases.
6. **Source code of the engine:** release notes and [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)
   point to TDF's source directory for the exact version (`sourceUrl` in the lock file). Before the first public
   release, the source tarballs of the shipped engine version are mirrored with the release assets so that the
   GPL/LGPL source offer does not depend on a third-party server.
7. Releases are built by GitHub Actions on `v*` tags (`.github/workflows/release.yml`) and uploaded to a
   **draft** release for manual review.

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| Electron Forge (Squirrel.Windows, MSIX, WiX) | No NSIS maker; Squirrel is not supported by electron-updater |
| One-click NSIS installer | Less control for users (no folder choice); considered again for auto-updates |
| electron-builder `portable` target | Re-extracts the whole ~1 GB payload to `%TEMP%` on every start |
| Download the engine on first start | Violates the offline requirement and complicates verification |
| Require a separately installed LibreOffice | Version drift, macro/updater settings outside our control, admin rights |
| Ship all LibreOffice languages | Twice the size for UI languages Simpaper does not offer |
| Microsoft Store (MSIX) | Store identity, sandbox restrictions on spawning the engine; not needed for v0.1 |

## Consequences

- Measured on the development machine: the engine image shrinks from 1,524 MiB (19,483 files) to
  **741 MiB (6,712 files)**; Electron's own runtime is about 368 MB before locale pruning. The uncompressed
  payload is therefore around 1.1–1.2 GB, well below the NSIS limit. _Update 2026-09-29:_ the first 0.1.0 build
  measured 331 MiB for the installer and 436 MiB for the ZIP ([PACKAGING.md](../PACKAGING.md#sizes)).
- Unsigned installers trigger Microsoft Defender SmartScreen warnings until signing is set up.
- The "unmodified engine" statement holds because every shipped LibreOffice file is byte-identical to the MSI
  content; `SIMPAPER-ENGINE.json` lists what was left out or relocated.
- Every release must run fetch → prepare (with `--verify`) → build → package; the CI engine cache is keyed by
  the lock file.
- Adding UI languages means adding them to the prepare step (`--ui-langs`) and to Simpaper's own translations.
