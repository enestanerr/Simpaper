# Status and hand-off

_Last updated: 2026-09-30 (rename to Simpaper, Windows file types and icons, first push to GitHub, real installation
check on this PC, theme and keyboard fixes found on screen, screenshots captured again; before that session 2: review
fixes, GUI runs, screenshots, focus and hang fixes, pre-publication audit)._ This file is the entry
point for the next working session: read it first, then [ROADMAP.md](ROADMAP.md) (checked boxes = proven by
automated tests) and the area notes in [dev/](dev/).

## Where we are

Milestone **M1** (four modules with a real open → edit → save flow) is implemented. Everything that can be proven
without a visible desktop has automated tests. Several GUI runs (real mouse and keyboard on the packaged app) ran in
session 2: the default **child** hosting mode passes; the **owned** mode is kept for development only. The Simpaper
installer was installed on this PC and checked by a script (file types, icons, double-click, update, uninstall; see
below); the current build stays installed for the owner (per user, no administrator rights). The owner had used a
build under the former name Varak before and has removed it. What still needs a person at the screen is listed under
"Not verified yet".

On 2026-09-30 the product was renamed from the working name "Varak" to **Simpaper**
([ADR 0009](adr/0009-product-name-simpaper.md)), and the installer now registers Windows file types with Simpaper's
own icons ([ADR 0010](adr/0010-file-associations.md)). The repository is public at
https://github.com/enestanerr/Simpaper (branch `main`; the local remote `origin` points there). The first push had
gone to a repository created under the wrong account (`ncreativestudios/Simpaper`), which the owner deletes; the
application id changed with the account before anything was installed ([ADR 0009](adr/0009-product-name-simpaper.md)).
The maintainer's open tasks on GitHub are listed under "Maintainer TODOs" in [dev/repo.md](dev/repo.md).

### Implemented (code + tests)

| Area | What exists | Notes |
|---|---|---|
| Engine | Python UNO bridge on LibreOffice's bundled Python, NDJSON JSON-RPC, main-thread execution via AsyncCallback, dispatch interception, state/context/selection/dialog events, process-per-document, conversion instance, profile template (macros off, updaters off, Office-like shortcuts) | [dev/engine.md](dev/engine.md) |
| Main process | Composition root, IPC router with sender/payload validation and a UNO command allow-list, DocumentService (open/new/save/save as/export PDF/print/close), SafeWriter (temp → verify → ReplaceFileW), compatibility analyzer (macros, SmartArt, chartex, pivots, fonts …), save-risk prompt with "save a copy", autosave + crash recovery (also for encrypted documents), hang watchdog with a restart offer in its own message box, settings, logs without document content | [dev/main-core.md](dev/main-core.md) |
| Windows platform | Child (default) and owned (experimental) hosting of the LibreOffice window, DPI mapping, freeze-frame (PrintWindow), Job Object process guard, hang detector, keyboard focus hand-over between Simpaper and LibreOffice (`view:focusShell`), optional Alt/F10 keyboard hook, read-only file-association query (`AssocQueryStringW`, `RegGetValueW`) | [dev/platform.md](dev/platform.md), [ADR 0003](adr/0003-document-surface.md) |
| Windows file types | Installer include `build/installer.nsh`: a ProgID per format with Simpaper's own icons (`resources/fileicons`, `npm run icons`), "Open with" entries, Default apps page, default only where no app owns a type, clean uninstall, registration kept on updates; Options › File types with a button to Windows Settings; one open queue for files from a multi-selection | [ADR 0010](adr/0010-file-associations.md), [PACKAGING.md](PACKAGING.md#file-types-and-icons) |
| Renderer | Title bar with QAT, document tabs, start screen, File backstage, ribbons for Writer (202 commands), Calc (225), Impress (164) and PDF, contextual tabs, KeyTips, adaptive ribbon layout, formula bar, status bars with zoom, prompts, message bars, TR/EN (9 namespaces), light/dark/high contrast | [dev/shell-ui.md](dev/shell-ui.md) |
| PDF | pdf.js 6.3 viewer (thumbnails, zoom, rotate view, Turkish-aware search, text selection), annotation editors, forms, page operations, merge/extract, add text/image as page content (Unicode font), incremental saves, own appearance streams for Turkish FreeText/form values, printing | [dev/pdf.md](dev/pdf.md) |
| Tests & corpus | Generated DOCX/XLSX/PPTX/PDF corpus + license-clean third-party samples, independent OOXML/VBA/PDF readers, visual regression with documented known changes | [dev/testing-corpus.md](dev/testing-corpus.md) |
| Repository | README (EN/TR), CONTRIBUTING, Code of Conduct, SECURITY, CHANGELOG, ADRs 0001–0010, compatibility matrix, known limitations, issue/PR templates, CI and release workflows, electron-builder config, engine fetch/prepare scripts, third-party notices | [dev/repo.md](dev/repo.md) |

### Test results (run on 2026-09-30 after the rename and the file types, this PC, no windows shown)

| Suite | Command | Result |
|---|---|---|
| Unit (main, renderer, PDF, platform, tools) | `npm test` | 68 files, 794 tests passed |
| Engine integration (real LibreOffice, headless/hidden) | `npm run test:engine` | 14 files, 115 passed, 5 skipped (3 opt-in long loops, 2 by design), 294 s |
| Unit tests that need the engine image | `npx vitest run --project unit tests/unit/renderer/commands.test.ts src/main/engine/launch.test.ts` | 2 files, 19 tests passed |
| Bridge (Python) | `vendor/libreoffice/program/python.exe -m unittest discover -s engine/bridge/tests -t engine/bridge` | 109 tests OK |
| Smoke boot (real app, hidden window) | `node scripts/smoke-boot.mjs`; packaged: `release/win-unpacked/Simpaper.exe` with `SIMPAPER_SMOKE=1` | development build (calc) and packaged build (writer, calc, impress) PASSED, including `app:fileTypes` |
| Installer file types | `node scripts/installer/check-associations.mjs` | PASSED: 28 extensions, 27 ProgIDs; exact registry tree after install, update, switch to "all users" and uninstall (scratch key) |
| Real installation (changes the PC; owner's permission) | `node scripts/installer/verify-install.mjs --keep` | PASSED; results below and in [PACKAGING.md](PACKAGING.md#real-installation) |
| Packaged engine | `npm run engine:prepare -- --verify` | PASSED (Turkish PDF and DOCX conversion, bundled fonts embedded) |
| Type check / lint | `npm run typecheck`, `npx tsc -p tests/unit/{renderer,pdf}/tsconfig.renderer-tests.json --noEmit`, `npm run lint` | clean |
| CI on GitHub | `.github/workflows/ci.yml` on every push to `main` | enestanerr/Simpaper, first run (commit 47a3be2): both jobs passed (`Lint, type check, unit tests, build` 132 s; `Engine tests (headless LibreOffice)` 883 s, with the engine downloaded and verified from scratch). Before, on the mistaken ncreativestudios repository: the first run failed in `tests/unit/tools/pdf.test.ts` (the runner keeps the repository on D: and the corpus font on C:; fixed in 1c2a5a7), the second passed |

### Rename and Windows file types (2026-09-30)

- **Rename** ([ADR 0009](adr/0009-product-name-simpaper.md)): 190 files, the bridge package (`simpaper_bridge`), the
  environment variables (`SIMPAPER_*`), the data folders, the executable and installer names, the application id
  `io.github.enestanerr.simpaper` and the repository links. Kept on purpose: the CSS prefixes `vr-`/`vpdf`,
  the historical ADR 0007 and research notes, and the recognition of `/VarakAP` PDF appearances and `.~varak-`
  save leftovers written by the old builds. A read-only name check found no software or registered trademark called
  Simpaper; it is no legal clearance.
- **File types** ([ADR 0010](adr/0010-file-associations.md)): see the table above. Four original file-type icons
  (document, spreadsheet, presentation, PDF). On this PC the installer could set the default of 23 of the 24 office
  and PDF types; `.xlsx` (an earlier "Open with › Always" choice for Varak) and `.pdf` (Edge) need the user's choice.
- **Review:** an adversarial review of the change (four reviewers, each finding re-checked by a skeptic) found, and
  this session fixed: a switch from an "only for me" to an "all users" installation left the per-user registration
  behind (it would start the deleted program); the finish-page box label was too long for its one-line box; an
  all-users install could overwrite another app's machine-wide default; two UI texts (plain-text types, the English
  "n of m" wording). The main-process and platform code had no findings. A documentation cross-check corrected 21
  statements.
- **Build:** `electron-builder.yml` now sets `publish: null`: the first builds had shipped a
  `resources/app-update.yml` pointing at the git remote of the time.

### Real installation, theme and keyboard fixes (2026-09-30)

- **Real installation** (`scripts/installer/verify-install.mjs`, the owner's permission, idle PC): after a silent
  per-user install 23 of the 24 office and PDF types opened with Simpaper (`.pdf` stays with Edge, the owner's
  choice); Windows showed Simpaper's icons (identical to the ICO files); a double-click on a .docx and a multiple
  selection of three files opened them; for `.pptx`, which a Store app registered too, Windows asked once which app
  to use; plain text and CSV kept their apps; the uninstall left nothing and restored every type. A newer build
  installed over it kept all 194 file-type values (update path). Details: [PACKAGING.md](PACKAGING.md#real-installation).
- **Found on screen and fixed:** the accent-derived theme tokens never resolved (declared on `:root`, where no
  module accent exists), so selected tabs, large ribbon icons, chips, menu check marks and dialog icons had no accent
  colour, and dialogs and menus in `<body>` had no accent at all; Options drew some checkboxes above their labels;
  menus opened with the mouse never got the keyboard focus (arrows and Esc did nothing), Tab did not close them, and
  with a document open the keys went to the document; after a menu or prompt over the document the keyboard stayed in
  Simpaper, because the focus request reached LibreOffice while its window was still frozen (hidden). Each fix has a
  unit test that fails without it; `themecheck.mjs`, `menucheck.mjs` and the extended `focuscheck.mjs` confirm them
  on screen (runs 17–22 in [testing/GUI_SPIKE.md](testing/GUI_SPIKE.md)).
- **Screenshots** in `docs/screenshots/` captured again after the theme fix (run 20), all 13 reviewed.

### GUI spike (session 2, 2026-09-29, 100 % scaling)

`node scripts/gui/gui-spike.mjs --view-mode child|owned` drives the packaged app with real mouse and keyboard input
and the DevTools protocol, checks the saved files independently and takes screenshots (Simpaper's window only). It
refuses to start unless the PC has been idle for 60 s and never sends input when another window is in front.

- **child:** passed — placement, ribbon Bold, Ctrl+S with the DOCX checked on disk, backstage, a Calc formula typed
  in Turkish syntax (`=TOPLA(1,5;2,25)` → 3,75), a new Impress slide, text and form PDFs, window moves, themes.
- **owned:** Simpaper stopped responding ~3 s after the first document appeared (UI thread blocked in
  `NtUserPeekMessage`, soffice idle). Fixed in code (the engine owns the frame before loading into it); the default
  is now **child** ([ADR 0003](adr/0003-document-surface.md), amendment). Settings v2 moves the old default.
- Found and fixed from the screenshots, then confirmed on screen in the later runs: Impress showed no slide pane
  (sfx2 hides child windows while the layout manager is invisible), the Impress status bar counted slides from 0,
  the Layout gallery overlapped the Slides group label.
- Writer typing: Turkish text typed at 40 ms per key arrives completely, Ctrl+S writes it to the DOCX (checked on
  disk). Keys injected within milliseconds right after a document's first modification are lost inside
  LibreOffice (a harness artefact no keyboard produces; docs/dev/platform.md §10). Separately fixed: `doc.info`
  no longer forces a full Writer layout with a progress bar (Writer ignores keys while a progress runs).
- Owned mode, second run: Simpaper stayed responsive, but soffice stopped responding after the first click into the
  document → removed from Options (settings.json only).
- Later runs (`scripts/gui/screenshots.mjs`, `scripts/gui/checks/`): PDF highlight (Highlight tool, drag) and
  free-text note saved and read back with pdf-lib; closing the window with unsaved changes asks once per document and
  "Don't save" leaves the files untouched; KeyTips appear on Alt; the loss warning appears for Ctrl+S on a .doc.
  Found and fixed: LibreOffice dialogs opened from the ribbon (Paragraph, Font) came up without the keyboard focus,
  because soffice is not the foreground process — Simpaper now calls `AllowSetForegroundWindow` for the engine before
  every command; on screen the dialog then has the focus, a real Esc closes it, and the ribbon is disabled meanwhile.
- README screenshots (Turkish and English, light theme, plus dark theme) are in `docs/screenshots/`.
- End of session 2 (`scripts/gui/checks/`, runs 10–13 in [testing/GUI_SPIKE.md](testing/GUI_SPIKE.md)): a background
  document whose engine was killed restarts hidden behind the active one. Found and fixed: (1) after a click into
  the document, keys for the ribbon's text boxes, the File view and prompts went into the document (the keyboard
  focus stayed in LibreOffice's window) → `view:focusShell`; (2) while an engine hangs, the Simpaper window gets no
  mouse or keyboard input (shared input queue), so the bar's "Restart engine" could not be clicked → rescue
  message box without a parent window after 8 s, and a hung engine is killed before its view is detached. Both
  confirmed on screen after the fix.

### Review fixes (session 2)

An adversarial review found 24 defects (its notes are kept outside the repository, under the ignored vendor/ folder);
all are fixed with regression tests that fail without the fix: engine 5, main process 16, renderer 7 (details in
the progress sections of [dev/engine.md](dev/engine.md), [dev/main-core.md](dev/main-core.md) and
[dev/shell-ui.md](dev/shell-ui.md)). Also fixed: a lone UTF-16 surrogate in a request no longer drops the engine's
URP connection (replaced with U+FFFD).

Found afterwards by a fact check of the usage instructions against the code, each fixed with a test that fails
without the fix: closing (or quitting with) a changed document whose engine hangs or crashed discarded the changes
without asking — now the `closeStuck` prompt names the last autosave, Cancel is the default; the Quick Access
Toolbar and the File tab stayed usable while a LibreOffice dialog was open; the CSV "Other" separator was ignored by
the import, and choosing another number format switched a legacy file's code page away from the preview's.

### Pre-publication audit (2026-09-30)

Before the first push, five read-only auditors checked the repository, each finding re-checked by a second agent:

- **Secrets and personal data** (all tracked files, the whole history, every image and document's metadata): none.
  Removed from the history: the local Obsidian settings in `docs/.obsidian/` (now ignored). Commit author e-mail:
  the GitHub noreply address.
- **Links:** all operational links pointed to the repository of the time (since the rename:
  https://github.com/enestanerr/Simpaper); the About page and the external-URL allow-list follow
  `src/shared/brand.ts`.
- **Licences:** the notices now include the Apache-2.0 parts of brotli and pdf-lib, the licence files of vendored
  code and MIT texts for packages without one; the installer no longer ships `elevate.exe`, the app no longer ships
  pdf.js' unused QuickJS sandbox; `delins.docx` is labelled with its Wikipedia excerpt (CC BY-SA 3.0).
- **CI:** predicted to pass on `windows-latest` (the unit suite passed with TZ=UTC and en-US defaults on a fresh
  clone). Fixed: the release workflow's notices check depended on the machine's collation; the unit tests no longer
  load Electron (it would download its binary); the engine job now also runs the unit tests that need the engine
  image and the Python bridge tests.
- **Docs:** 15 statements corrected (test counts, "never tried on screen", plans for features v0.1 already has,
  wait times, labels).

One unexplained failure was seen once in seven full unit runs (`tests/unit/pdf/appearance.test.ts`, "pdf:update
stores the fixed bytes in the working copy"); it did not come back alone or in four parallel stress runs. If CI
shows it, look for a transient file lock on the working copy.

### Important findings of session 1

- **Start-up hang on Turkish Windows (fixed).** LibreOffice's in-process Python (loaded for the Lightproof grammar
  checker when a text document is created) switched the C runtime locale to `Turkish_Türkiye.utf8`; the runtime
  raised an invalid-parameter error and LibreOffice's crash handler deadlocked. Simpaper now starts the engine without
  the in-process Python loader. Upstream bug, not yet reported to TDF. Details and evidence: [dev/engine.md](dev/engine.md).
- **Release-after-close crash (fixed in the bridge)** with a release barrier before closing documents.
- **Chromium ≥ 139 hides GDI child windows** of Electron windows (`WS_EX_NOREDIRECTIONBITMAP`) → owned-overlay
  hosting was the default until the GUI spike; child hosting works with a layered container plus
  `--disable-features=RemoveRedirectionBitmap` and is the default since session 2.
- **Round-trip fidelity changes** found by the visual/independent tests: DOCX bullets become Symbol U+F0B7, PPTX
  master text styles are dropped, XLSM VBA projects are rebuilt (descriptions/shortcut keys lost). Documented in
  [COMPATIBILITY.md](COMPATIBILITY.md) and [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Not verified yet (needs the owner's permission to use the desktop)

- Not covered by any GUI run yet: printing, the PDF page tools and forms, in-document KeyTips
  (`ui.documentKeyTips`), the `closeStuck` prompt on screen (reachable only while the window still takes input).
  Plan: [testing/GUI_SPIKE.md](testing/GUI_SPIKE.md); manual checklist in Turkish: [TEST_REHBERI.md](TEST_REHBERI.md).
- High-DPI (125/150 %) — both monitors of this PC run at 100 %.
- The installer beyond the scripted check on this PC: Simpaper's page under Settings › Apps › Default apps, the
  finish-page box, the "all users" mode, Windows 10, and a clean machine without other office apps; checklist in
  Turkish: section 2 of [TEST_REHBERI.md](TEST_REHBERI.md).
- Nothing is claimed as verified in Microsoft Office (not installed here).
- The release workflow (`.github/workflows/release.yml`) has not run on GitHub yet (it starts on a `v*` tag and
  builds a draft release).

## How to resume

```powershell
npm ci                      # dependencies
npm run engine:fetch        # only if vendor/libreoffice is missing (download + SHA-256 + GPG + extract)
npm run engine:prepare      # only for packaging (vendor/engine-dist)
npm test                    # unit tests
npm run test:engine         # engine integration tests (headless, no windows)
node scripts/smoke-boot.mjs # real app with a hidden window
npm run dev                 # starts the app (opens windows!)
npm run dist:win            # installer + ZIP in release/
node scripts/installer/check-associations.mjs   # installer file types against a scratch registry key
node scripts/installer/verify-install.mjs --keep # REAL install/uninstall on this PC (owner's permission, idle PC)
npm run icons               # re-render app, module and file-type icons (resources/, build/)
git log --oneline           # history; remote origin = https://github.com/enestanerr/Simpaper (public)
```

Machine notes: C: had about 2.1 GB free after the last build (a full working copy with a packaged build needs
about 6 GB; `vendor/downloads` (0.39 GB) can be deleted once the engine is extracted). Editors built on Electron
(VS Code) export `ELECTRON_RUN_AS_NODE=1`; the npm scripts remove it. Simpaper 0.1.0 is installed for the owner
(per user). The owner removed the Varak test installation; its data folders remain (`%APPDATA%\Varak`,
`%LOCALAPPDATA%\Varak` and about 346 MB in `%LOCALAPPDATA%\varak-updater`, which that installer left) and can be
deleted by the owner; Simpaper neither reads nor changes them. Automated runs always use `SIMPAPER_DATA_DIR` under
`test-output/` and never touch any installation's data (`verify-install.mjs` backs up and restores the owner's
settings and recent files).

## Next steps

1. The Maintainer TODOs in [dev/repo.md](dev/repo.md) (Code of Conduct contact, private vulnerability reporting,
   Discussions, branch protection requiring the two CI jobs, which pass on GitHub).
2. The manual checklist [TEST_REHBERI.md](TEST_REHBERI.md) by the owner (section 2 covers what the installation
   script cannot see, such as Simpaper's page in Windows Settings); record the result here.
3. Verify DPI with a scaled monitor; investigate the owned-mode soffice hang only if child mode shows DPI problems.
4. Report the Turkish-locale hang upstream (TDF Bugzilla) with the reproduction from dev/engine.md.
5. Before a commercial launch: the trademark steps of [ADR 0009](adr/0009-product-name-simpaper.md). Continue with
   M2 (ROADMAP.md).
