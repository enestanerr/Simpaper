# Repository documents, community files, CI and packaging configuration (developer notes)

Area owner files: `README.md`, `README.tr.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `LICENSE`,
`THIRD_PARTY_NOTICES.md`, `CHANGELOG.md`, `docs/**` (except `ARCHITECTURE.md`, `ROADMAP.md`, `STATUS.md`,
other areas' `docs/dev/*.md` and `docs/testing/**`), `.github/**`, `electron-builder.yml`, `build/**`,
`resources/**`, `scripts/engine/**`, `scripts/brand/**`, `scripts/generate-notices.mjs`, `.vscode/extensions.json`.
Scratch files: `test-output/repo/` (git-ignored).

## Progress

Session 2 (2026-09-29), resuming after the interrupted first pass.

| # | Item | State |
|---|---|---|
| 1 | `README.tr.md` | **done** (mirrors README.md incl. the revised status table; app's own Turkish terms) |
| 2 | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md` | **done** (CoC = official 2.1 text, diffed; only the contact line filled: e-mail placeholder + GitHub private reporting as interim channel) |
| 3 | `.github/` issue forms, PR template, `ci.yml`, `release.yml` (+ YAML validation) | **done**; validated with js-yaml + SchemaStore schemas (Ajv), actionlint 1.7.12 (0 errors), release pwsh steps executed in a sandbox (`test-output/repo/run-release-steps.mjs`), fetch-engine options run locally (`-VerifyOnly -RequireSignature`: good signature) |
| 4 | `electron-builder.yml`: koffi `asarUnpack`, `extraResources` vs `src/main/engine/locate.ts` | **done**: whole-package unpack of koffi + `@koromix/koffi-win32-x64`; bridge excludes tests/caches; `extraFiles` ships LICENSE.txt + THIRD_PARTY_NOTICES.md; `win.signExecutable: false` (see below). Validated: schema (Ajv + app-builder-lib scheme.json), FileMatcher simulation, real `electron-builder --win dir` build (then deleted) |
| 5 | `.vscode/extensions.json` | **done** |
| 6 | Accuracy review of `README.md`, `docs/COMPATIBILITY.md` (and `KNOWN_LIMITATIONS.md`, `PACKAGING.md`, `TESTING.md`) | **done** (status tables EN/TR; PDF row per docs/dev/pdf.md; Test status cites `tests/unit/pdf/*`, `tests/unit/main/compat.test.ts`/`savePlan.test.ts` (run here) and `tests/engine/independent.test.ts`/`visual.test.ts` (reported passing in docs/dev/testing-corpus.md, 03:48; not re-run here to avoid racing that area's output folders); findings F1–F5 of testing-corpus.md reflected: DOCX chartex → pictures, PPTX master text styles, tr-TR number formats, XLSM procedure attributes, VBA streams vs container) |
| 7 | Disk check (delete `vendor/engine-dist` below 5 GB free) | 8.5 GB free at start, 7.3 GB after the dir build was deleted (other agents write too): nothing deleted |

### Findings of this session

- **electron-builder signs every `.exe` copied from `extraResources`** when a certificate is configured
  (`createTransformerForExtraFiles` in app-builder-lib 26.15.3): the first dir build queued 44 LibreOffice/Python
  executables for signtool. Without a certificate nothing changed (hashes identical), but with one TDF's
  Authenticode signatures would be replaced and the engine would no longer be byte-identical. Fixed with
  `win.signExecutable: false`; signing is planned outside electron-builder (PACKAGING.md, Signing plan).
- The dir build check (`test-output/repo/inspect-package.mjs`): 6,713 engine files byte-identical to
  `vendor/engine-dist`, `resources/bridge` = 15 `simpaper_bridge` modules only, koffi unpacked and loadable from the
  packaged `app.asar` path (Electron 44.4.5 in node mode, `GetCurrentProcessId` call), fuses as configured,
  LICENSE.txt + THIRD_PARTY_NOTICES.md next to Simpaper.exe. The build used the stale `out/` of 00:27 (layout check
  only; the app was not started). That build still had the names from before the rename (`varak_bridge`,
  `Varak.exe`).
- Engine fonts in dev mode: the PDF service also searches the admin image's `Fonts/` folder
  (`src/main/app/engineDirs.ts`); only the compatibility font check still reads `share/fonts/truetype` alone
  (main-core.md, Known limitations). Packaged builds have the fonts in `share/fonts/truetype` (prepare-engine moves
  them).

### Maintainer TODOs (need the GitHub repository or a person)

The repository https://github.com/enestanerr/Simpaper is public.

- Delete https://github.com/ncreativestudios/Simpaper (Settings → General → Danger Zone → Delete this repository):
  it was created under the wrong account and holds the first push of 2026-09-30. Nothing links to it any more.
- Enable **Discussions** (issue chooser, feature form and CONTRIBUTING link to `/discussions`; Settings → General →
  Features).
- Enable **Private vulnerability reporting**, which GitHub offers now that the repository is public: SECURITY.md, the
  issue chooser and the CoC link to `/security/advisories/new`, and the CoC names it as the reporting channel until
  its e-mail address is published.
- Protect `main`, requiring the `CI` checks `Lint, type check, unit tests, build` and
  `Engine tests (headless LibreOffice)`; both pass on GitHub ([STATUS.md](../STATUS.md), Test results).
- Replace the e-mail placeholder in `CODE_OF_CONDUCT.md` (Enforcement section).
- Check what the installation script cannot see ([PACKAGING.md](../PACKAGING.md#real-installation)): that Windows'
  "How do you want to open this file?" prompt offers Simpaper, and Simpaper's Default apps page in Settings (section 2
  of [TEST_REHBERI.md](../TEST_REHBERI.md)). Icons, double-click, update and uninstall were checked on the
  development PC by `scripts/installer/verify-install.mjs`. A PC with the old Varak test installation keeps it next
  to Simpaper (new application id): remove it through Settings › Apps.

- Before the first public release: mirror the engine source tarballs (PACKAGING.md, ADR 0008 §6), set up SignPath
  (PACKAGING.md, Signing plan), write the CHANGELOG section, run the release workflow on the tag.
- Before a commercial launch ([ADR 0009](../adr/0009-product-name-simpaper.md), Consequences): file the name with
  TÜRKPATENT in Nice classes 9 and 42, have a trademark attorney run a clearance search and register the wanted
  domains. The name check of 2026-09-30 is no legal clearance.

### How to re-run the checks of this area

Scratch scripts in `test-output/repo/` (git-ignored; recreate them from this description in a fresh clone):

| Script | Checks |
|---|---|
| `validate-eb2.mjs` | electron-builder.yml: js-yaml parse, app-builder-lib `scheme.json` (Ajv), brand identity, FileMatcher simulation of extraResources/extraFiles/asarUnpack against the real folders |
| `inspect-package.mjs` | output of `npx electron-builder --win dir --config.directories.output=test-output/repo/eb-out` (needs `out/` and `vendor/engine-dist`; 1.1 GB, delete afterwards) |
| `koffi-asar-check.cjs` | `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe test-output/repo/koffi-asar-check.cjs` loads koffi from the packaged app.asar |
| `validate-github.mjs` | `.github/**/*.yml`: js-yaml + SchemaStore schemas in `schemas/` (github-workflow, github-issue-forms, github-issue-config) + structure checks |
| `tools/actionlint.exe` | `test-output/repo/tools/actionlint.exe -no-color .github/workflows/*.yml` (v1.7.12, checksum-verified download) |
| `run-release-steps.mjs` | executes the pwsh steps of release.yml in a sandbox (tag check, checksums, release notes) |
| `check-links.mjs` | relative links and heading anchors of the Markdown files |

Done in the first pass: `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md` + `scripts/generate-notices.mjs`,
`electron-builder.yml` (first version), `docs/{COMPATIBILITY,KNOWN_LIMITATIONS,TESTING,PACKAGING,DEMO}.md`,
`docs/adr/0001-0008`, `docs/research/*`, `scripts/engine/*`, `scripts/brand/generate-icons.mjs`,
`resources/brand/*`, `build/icon.*`, `vendor/engine-dist`.
