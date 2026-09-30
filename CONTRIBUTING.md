# Contributing to Simpaper

Thank you for helping to build a free, Office-familiar office suite. Contributions of every size are welcome: bug
reports, translations, test files with clean licenses, documentation and code. You can write issues and pull
requests in English or Turkish (*İngilizce veya Türkçe yazabilirsiniz*); code, comments and commit messages are in
English.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems are **not** reported in
public issues; see [SECURITY.md](SECURITY.md).

By contributing you agree that your contribution is licensed under the [Mozilla Public License 2.0](LICENSE), like the
rest of the project ([ADR 0006](docs/adr/0006-license.md)). There is no contributor license agreement.

## Contents

1. [Ways to contribute](#ways-to-contribute)
2. [Development setup](#development-setup)
3. [How the code is organised](#how-the-code-is-organised)
4. [Testing rules](#testing-rules)
5. [Adding a ribbon command](#adding-a-ribbon-command)
6. [Translations](#translations)
7. [Code style](#code-style)
8. [Commits and pull requests](#commits-and-pull-requests)

## Ways to contribute

- **Report a bug** with the [bug report form](https://github.com/ncreativestudios/Simpaper/issues/new/choose). Never
  attach confidential documents; create a small file that shows the problem instead.
- **Suggest a feature** with the feature request form, or start a
  [discussion](https://github.com/ncreativestudios/Simpaper/discussions) when the idea is not concrete yet. Check the
  [roadmap](docs/ROADMAP.md) first.
- **Improve translations**: every user-facing text exists in Turkish and English (see [Translations](#translations)).
- **Add test files**: small documents that exercise a feature, generated or under a permissive license (see
  [docs/TESTING.md](docs/TESTING.md#adding-corpus-files)).
- **Write code or documentation**: for anything larger than a small fix, please open an issue first so that the
  approach can be agreed on before you invest time.

## Development setup

### Prerequisites

- Windows 10 or 11, x64. (Other platforms can build and run the unit tests, but the application itself is
  Windows-only.)
- [Node.js](https://nodejs.org/) 22.13 or newer (CI uses Node 22).
- [Git for Windows](https://gitforwindows.org/); its `gpg` verifies the engine download.
- About 6 GB of free disk space: the engine download (0.36 GB) is extracted to about 1.6 GB, `node_modules` takes
  0.9 GB and a packaged build in `release/` about 1.9 GB. Without packaging, about 3.5 GB is enough.
- Recommended: [Visual Studio Code](https://code.visualstudio.com/) with the extensions listed in
  `.vscode/extensions.json` (ESLint, EditorConfig).

### First build

```powershell
git clone https://github.com/ncreativestudios/Simpaper.git
cd Simpaper
npm ci                  # exact dependency versions from package-lock.json
npm run engine:fetch    # downloads LibreOffice 26.8.0.3, verifies SHA-256 and signature, extracts it to vendor/
npm test                # unit tests (no windows)
npm run test:engine     # headless LibreOffice tests (no windows)
npm run dev             # starts the app with hot reload: this opens windows
```

Useful commands:

| Command | What it does |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | strict TypeScript for the main/preload and renderer projects |
| `npm test` / `npm run test:watch` | unit tests (Vitest project `unit`) |
| `npm run test:engine` | engine tests: real LibreOffice, headless, one instance at a time |
| `npm run build` | production build with electron-vite into `out/` |
| `npm run engine:prepare -- --verify` | builds the trimmed engine for packaging and smoke-tests it |
| `npm run corpus:generate` | writes the generated test documents to `tests/corpus/generated/` |
| `npm run notices` | regenerates `THIRD_PARTY_NOTICES.md` (after dependency or engine changes) |
| `npm run dist:dir` / `npm run dist:win` | unpacked app / installer and ZIP in `release/` ([docs/PACKAGING.md](docs/PACKAGING.md)) |

`npm run engine:fetch` writes only inside the repository (`vendor/`, git-ignored) and installs nothing on your
system. To test with another LibreOffice `program` folder, for example the prepared engine in
`vendor/engine-dist/program` (which has the bundled fonts where LibreOffice looks for them), set
`SIMPAPER_ENGINE_DIR` to that folder.

### VS Code and `ELECTRON_RUN_AS_NODE`

VS Code and other editors built on Electron export `ELECTRON_RUN_AS_NODE=1` to their integrated terminals. With
that variable set, Electron behaves like plain Node.js: `require('electron')` returns a file path instead of the
API, and the app fails at start-up (for example "Cannot read properties of undefined (reading 'whenReady')").

`npm run dev`, `npm start` and `npm run build` remove the variable for you (`scripts/run-electron-vite.mjs`). When
you start Electron or a tool yourself, remove it first:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue   # PowerShell
```

```bash
unset ELECTRON_RUN_AS_NODE                                          # Git Bash
```

## How the code is organised

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first; the decisions and their reasons are in
[docs/adr/](docs/adr/README.md), the current state in [docs/STATUS.md](docs/STATUS.md), and each area has developer
notes in [docs/dev/](docs/dev/).

| Path | Content |
|---|---|
| `src/shared/` | Contracts shared by all processes: formats, IPC channels and payloads (`api/`), engine protocol, allowed `.uno:` commands, brand |
| `src/main/` | Electron main process: `app/` (start-up, window, security), `ipc/` (router and validators), `documents/` (open/save/close), `files/` (safe save, working copies), `compat/` (loss-risk analysis), `recovery/`, `settings/`, `engine/` (engine processes and RPC), `pdf/` (PDF file operations), `platform/` (Win32 window hosting, process guard) |
| `src/preload/` | The only bridge between the sandboxed renderer and the main process |
| `src/renderer/` | React UI: `shell/` (title bar, backstage, tabs, status bar), `ribbon/` (ribbon framework), `modules/` (writer, calc, impress, pdf), `i18n/`, `theme/` |
| `engine/bridge/` | `simpaper_bridge`, a Python package that runs on LibreOffice's bundled Python and talks UNO to the engine; NDJSON JSON-RPC over stdio |
| `engine/profile/` | Template of the engine's user profile (macros disabled, updates off, shortcuts) |
| `scripts/` | Engine fetch/prepare/verify, corpus generator, notices, icons, smoke boot (`smoke-boot.mjs`), GUI runs and on-screen checks (`gui/`, `gui/checks/`; they open windows, see [Testing rules](#testing-rules)) |
| `tests/` | `unit/`, `engine/` (headless LibreOffice), `tools/` (independent OOXML/ODF/PDF readers), `corpus/` |

Contracts live in `src/shared/*.ts`, `src/shared/api/*.ts`, `src/main/*/types.ts`, `src/renderer/ribbon/types.ts`
and `src/renderer/modules/types.ts`. Change them additively where possible, and update every user in the same pull
request.

Principles that every change keeps:

- The engine is LibreOffice **unmodified**: no patches, no rebuilt binaries; configuration goes into
  `engine/profile/` and load arguments.
- The user's file is written only by the safe-save pipeline (temporary file → verification → atomic replace), and
  content that a format would lose is announced before saving ([ADR 0005](docs/adr/0005-data-integrity.md)).
- Macros and PDF JavaScript never run. No telemetry, no network access at run time, no document content in logs.
- The renderer stays sandboxed; new IPC channels are allow-listed and validated in `src/main/ipc/`.

## Testing rules

These rules are strict, because a compatibility claim that was never tested hurts users.

1. **Never report an untested result as passing.** Pull requests and status notes say exactly which commands were
   run and what they printed. "Should work" is not a test result; a skipped test is not a passing test.
2. **Microsoft Office is not used for testing.** Do not claim that a file "works in Word/Excel/PowerPoint" unless a
   documented manual check with the Office version and date exists; such checks stay out of automated results.
3. **Tests never open windows or send keyboard/mouse input** unless the owner of the machine explicitly agreed and
   nobody else is using the desktop. Unit and engine tests are headless; GUI checks follow
   [docs/testing/GUI_SPIKE.md](docs/testing/GUI_SPIKE.md) and need that permission. The same applies to
   `npm run dev`, `npm start` and taking screenshots on a shared machine.
4. **Sample documents must be license-clean**: generated by our scripts, created by you for the purpose, or taken
   unmodified from a source whose license allows redistribution, with the provenance pinned. Never add documents from
   your work, customers or other people, not even "anonymised" ones ([docs/TESTING.md](docs/TESTING.md#adding-corpus-files)).
5. **Clean up**: every process a test starts is stopped with its whole process tree (`soffice.exe` starts
   `soffice.bin`; LibreOffice's `python.exe` starts a second Python). Test output goes to `test-output/`
   (git-ignored), engine instances use their own profile folder there.
6. **Engine tests get generous timeouts**: LibreOffice start-up and conversions are slow on busy machines.
7. Verify results **independently**: a document saved by the engine is checked by the engine *and* by the readers in
   `tests/tools/` that do not use LibreOffice.

Where tests go:

- pure logic and services with fakes → `tests/unit/<area>/*.test.ts`; tests that import renderer modules are
  `*.test.tsx`;
- anything that needs LibreOffice → `tests/engine/*.test.ts` (skips itself when no engine is available);
- new checks of saved files → extend the independent readers in `tests/tools/`.

## Adding a ribbon command

Ribbon controls that act on an office document dispatch LibreOffice `.uno:` commands. The main process executes
only commands on the allow-list in `src/shared/commands.ts`, so a new command needs these steps:

1. **Check that the command exists in the pinned engine.** It must be defined in the engine's UI command registry:

   ```powershell
   Select-String -Path vendor\libreoffice\share\registry\*.xcd -SimpleMatch 'oor:name=".uno:InsertPagebreak"' |
     Select-Object -ExpandProperty Filename -Unique
   ```

   `main.xcd` holds `GenericCommands` (all modules) and `DrawImpressCommands`, `writer.xcd` holds `WriterCommands`,
   `calc.xcd` holds `CalcCommands`. To see whether LibreOffice itself uses the command in a module, look at the
   module's menus and toolbars in `vendor/libreoffice/share/config/soffice.cfg/modules/<swriter|scalc|simpress>/`.
   A command that exists can still be disabled in a module; check its state in a headless document (engine test).
2. **Add it to the allow-list** of the module in `src/shared/commands.ts` (`WRITER`, `CALC`, `IMPRESS`, or `COMMON`
   when all three use it; status-bar fields that are only observed go to `STATUS`). Commands that open or save files,
   quit, run macros or show LibreOffice's options, about or help dialogs are never added: those flows belong to the
   shell.
3. **Add the control** to the module's ribbon (`src/renderer/modules/<module>/ribbon.ts`; shared builders are in
   `src/renderer/modules/common/controls.ts`): a label key, a tooltip key, an icon from `@tabler/icons-react`, a
   KeyTip that is unique within its tab, and a `state` binding for toggles. Every enabled control must perform a real
   action; do not add placeholders.
4. **Add the texts in Turkish and English** (see [Translations](#translations)), using the terms that Office users
   know.
5. **Add a test**: the ribbon tests must still pass (every control wired to a real action, translated labels and
   tips, unique KeyTips), and a command that changes content gets an engine test that dispatches it in a headless
   document and checks the result.
6. **Try it** in the running app (`npm run dev`) on your own desktop, in both languages, with the mouse and with
   KeyTips, and mention in the pull request what you tried.

## Translations

- All user-facing text is in `src/renderer/i18n/locales/tr/*.json` and `src/renderer/i18n/locales/en/*.json`, one
  file per namespace (`common`, `shell`, `writer`, `calc`, `impress`, `formats`, `pdf`, `compat`, `errors`). Keys are
  written as `<namespace>.<path>`, for example `common.cmd.bold`.
- Every key exists in **both** languages; tests check this. Never hard-code user-facing text in components or in
  main-process messages (the main process sends `errors.*` / `compat.*` keys).
- Use Microsoft Office's established Turkish terms where they exist (Giriş, Ekle, Düzen, Gözden Geçir, Görünüm …),
  "siz" form, sentence case. Turkish text must use `tr` locale rules for upper/lower case (`İ`/`i`, `I`/`ı`); use
  the helpers in `src/renderer/i18n/turkish.ts` instead of `toUpperCase()`.
- LibreOffice's own dialogs are translated by LibreOffice and are not part of Simpaper's files.

## Code style

- **TypeScript** in strict mode; no `any` without a comment that explains why; small modules with explicit types at
  module boundaries. Run `npm run lint` and `npm run typecheck` before you push.
- **Formatting** follows `.editorconfig`: UTF-8, LF line endings (CRLF for `.ps1`, `.bat`, `.cmd`), 2 spaces
  (4 for Python), final newline. Match the style of the surrounding code.
- **React**: function components and hooks, state in the existing stores (zustand), no direct IPC from components
  (use `src/renderer/services/`).
- **Accessibility**: every control has an accessible name, works with the keyboard and shows focus; dialogs trap
  focus and close with Esc.
- **Python** (`engine/bridge`): runs on LibreOffice's bundled Python 3.13 with the standard library and UNO
  (`uno`, `unohelper`) only, no pip packages; work on UNO objects is marshalled to LibreOffice's main thread
  (`office.py`).
- **Comments** explain *why* something is done, especially workarounds for engine or platform behaviour (with the
  bug number when there is one).
- **Logging**: never log document content, passwords or clipboard data; file paths only where they help to debug.
- **Dependencies**: only licenses allowed by [ADR 0006](docs/adr/0006-license.md) (MIT, ISC, BSD, Apache-2.0,
  MPL-2.0 …; no GPL/AGPL in shipped code). Pin exact versions, explain why the dependency is needed, and run
  `npm run notices`.

## Commits and pull requests

- One logical change per pull request; keep it reviewable. Include the tests and the documentation that belong to
  the change.
- Commit messages: a short subject in the imperative (at most 72 characters), optionally prefixed with the area,
  for example `pdf: keep the view rotation after merging`; a body that explains *why* when it is not obvious.
  Reference issues with `Fixes #123`.
- The [pull request template](.github/PULL_REQUEST_TEMPLATE.md) contains the checklist; in short:
  - [ ] `npm run lint`, `npm run typecheck`, `npm test` pass (and `npm run test:engine` for engine-related changes),
        with the summary lines pasted into the description;
  - [ ] changes in `engine/bridge`: the Python tests pass
        (`vendor/libreoffice/program/python.exe -m unittest discover -s engine/bridge/tests -t engine/bridge`);
  - [ ] tests for new behaviour; a failing test first for bug fixes;
  - [ ] every new user-facing text in Turkish **and** English;
  - [ ] no claims beyond what was tested; screenshots of the real app for UI changes;
  - [ ] documentation updated (`docs/COMPATIBILITY.md`, `docs/KNOWN_LIMITATIONS.md`, `CHANGELOG.md` under
        "Unreleased") when behaviour changes.
- CI runs lint, type checks, unit tests, the production build and the headless engine tests on Windows
  (`.github/workflows/ci.yml`). A pull request is merged when CI is green and a maintainer approved it.
