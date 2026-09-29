# Status and hand-off

_Last updated: 2026-09-29 evening (session 2: review fixes, GUI runs, screenshots, first local commit)._ This file is
the entry point for the next working session: read it first, then [ROADMAP.md](ROADMAP.md) (checked boxes = proven
by automated tests) and the area notes in [dev/](dev/).

## Where we are

Milestone **M1** (four modules with a real open → edit → save flow) is implemented. Everything that can be proven
without a visible desktop has automated tests. Several GUI runs (real mouse and keyboard on the packaged app) ran in
session 2: the default **child** hosting mode passes; the **owned** mode is kept for development only. The owner
installed the 0.1.0 installer on this PC and used it (per user, no administrator rights). What still needs a person
at the screen is listed under "Not verified yet".

The project is a local Git repository (branch `main`, first commit made at the end of session 2, **no remote, nothing
pushed**). Publishing on GitHub is the owner's decision.

### Implemented (code + tests)

| Area | What exists | Notes |
|---|---|---|
| Engine | Python UNO bridge on LibreOffice's bundled Python, NDJSON JSON-RPC, main-thread execution via AsyncCallback, dispatch interception, state/context/selection/dialog events, process-per-document, conversion instance, profile template (macros off, updaters off, Office-like shortcuts) | [dev/engine.md](dev/engine.md) |
| Main process | Composition root, IPC router with sender/payload validation and a UNO command allow-list, DocumentService (open/new/save/save as/export PDF/print/close), SafeWriter (temp → verify → ReplaceFileW), compatibility analyzer (macros, SmartArt, chartex, pivots, fonts …), save-risk prompt with "save a copy", autosave + crash recovery (also for encrypted documents), hang watchdog, settings, logs without document content | [dev/main-core.md](dev/main-core.md) |
| Windows platform | Child (default) and owned (experimental) hosting of the LibreOffice window, DPI mapping, freeze-frame (PrintWindow), Job Object process guard, hang detector, optional Alt/F10 keyboard hook | [dev/platform.md](dev/platform.md), [ADR 0003](adr/0003-document-surface.md) |
| Renderer | Title bar with QAT, document tabs, start screen, File backstage, ribbons for Writer (202 commands), Calc (225), Impress (164) and PDF, contextual tabs, KeyTips, adaptive ribbon layout, formula bar, status bars with zoom, prompts, message bars, TR/EN (9 namespaces), light/dark/high contrast | [dev/shell-ui.md](dev/shell-ui.md) |
| PDF | pdf.js 6.3 viewer (thumbnails, zoom, rotate view, Turkish-aware search, text selection), annotation editors, forms, page operations, merge/extract, add text/image as page content (Unicode font), incremental saves, own appearance streams for Turkish FreeText/form values, printing | [dev/pdf.md](dev/pdf.md) |
| Tests & corpus | Generated DOCX/XLSX/PPTX/PDF corpus + license-clean third-party samples, independent OOXML/VBA/PDF readers, visual regression with documented known changes | [dev/testing-corpus.md](dev/testing-corpus.md) |
| Repository | README (EN/TR), CONTRIBUTING, Code of Conduct, SECURITY, CHANGELOG, ADRs 0001–0008, compatibility matrix, known limitations, issue/PR templates, CI and release workflows, electron-builder config, engine fetch/prepare scripts, third-party notices | [dev/repo.md](dev/repo.md) |

### Test results (run on 2026-09-29 evening after the last fixes, this PC, no windows shown)

| Suite | Command | Result |
|---|---|---|
| Unit (main, renderer, PDF, platform, tools) | `npm test` | 62 files, 744 tests passed |
| Engine integration (real LibreOffice, headless/hidden) | `npm run test:engine` | 14 files, 115 passed, 5 skipped (opt-in long loops), 300 s |
| Bridge (Python) | `vendor/libreoffice/program/python.exe -m unittest discover -s engine/bridge/tests -t engine/bridge` | 109 tests OK |
| Smoke boot (real app, hidden window) | `node scripts/smoke-boot.mjs --kind calc\|writer\|impress` | all three PASSED |
| Type check / lint | `npm run typecheck`, `npx tsc -p tests/unit/{renderer,pdf}/tsconfig.renderer-tests.json --noEmit`, `npm run lint` | clean |

### GUI spike (session 2, 2026-09-29, 100 % scaling)

`node scripts/gui/gui-spike.mjs --view-mode child|owned` drives the packaged app with real mouse and keyboard input
and the DevTools protocol, checks the saved files independently and takes screenshots (Varak's window only). It
refuses to start unless the PC has been idle for 60 s and never sends input when another window is in front.

- **child:** passed — placement, ribbon Bold, Ctrl+S with the DOCX checked on disk, backstage, a Calc formula typed
  in Turkish syntax (`=TOPLA(1,5;2,25)` → 3,75), a new Impress slide, text and form PDFs, window moves, themes.
- **owned:** Varak stopped responding ~3 s after the first document appeared (UI thread blocked in
  `NtUserPeekMessage`, soffice idle). Fixed in code (the engine owns the frame before loading into it); the default
  is now **child** ([ADR 0003](adr/0003-document-surface.md), amendment). Settings v2 moves the old default.
- Found and fixed from the screenshots, then confirmed on screen in the later runs: Impress showed no slide pane
  (sfx2 hides child windows while the layout manager is invisible), the Impress status bar counted slides from 0,
  the Layout gallery overlapped the Slides group label.
- Writer typing: Turkish text typed at 40 ms per key arrives completely, Ctrl+S writes it to the DOCX (checked on
  disk). Keys injected within milliseconds right after a document's first modification are lost inside
  LibreOffice (a harness artefact no keyboard produces; docs/dev/platform.md §10). Separately fixed: `doc.info`
  no longer forces a full Writer layout with a progress bar (Writer ignores keys while a progress runs).
- Owned mode, second run: Varak stayed responsive, but soffice stopped responding after the first click into the
  document → removed from Options (settings.json only).
- Later runs (`scripts/gui/screenshots.mjs`, `test-output/gui/*check.mjs`): PDF highlight (Highlight tool, drag) and
  free-text note saved and read back with pdf-lib; closing the window with unsaved changes asks once per document and
  "Don't save" leaves the files untouched; KeyTips appear on Alt; the loss warning appears for Ctrl+S on a .doc.
  Found and fixed: LibreOffice dialogs opened from the ribbon (Paragraph, Font) came up without the keyboard focus,
  because soffice is not the foreground process — Varak now calls `AllowSetForegroundWindow` for the engine before
  every command; on screen the dialog then has the focus, a real Esc closes it, and the ribbon is disabled meanwhile.
- README screenshots (Turkish and English, light theme, plus dark theme) are in `docs/screenshots/`.

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

### Important findings of session 1

- **Start-up hang on Turkish Windows (fixed).** LibreOffice's in-process Python (loaded for the Lightproof grammar
  checker when a text document is created) switched the C runtime locale to `Turkish_Türkiye.utf8`; the runtime
  raised an invalid-parameter error and LibreOffice's crash handler deadlocked. Varak now starts the engine without
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
  (`ui.documentKeyTips`), background-tab crash restore, the hung-engine close prompt. Plan:
  [testing/GUI_SPIKE.md](testing/GUI_SPIKE.md); manual checklist in Turkish: [TEST_REHBERI.md](TEST_REHBERI.md).
- High-DPI (125/150 %) — both monitors of this PC run at 100 %.
- The installer on a clean Windows machine (it was only installed on this development PC).
- Nothing is claimed as verified in Microsoft Office (not installed here).
- CI workflows have not run on GitHub yet.

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
git log --oneline           # local history (no remote configured)
```

Machine notes: C: had about 4.5 GB free at the end of session 2 (a full working copy with a packaged build needs
about 6 GB; `vendor/downloads` (0.39 GB) can be deleted once the engine is extracted). Editors built on Electron
(VS Code) export `ELECTRON_RUN_AS_NODE=1`; the npm scripts remove it. The owner's installed Varak uses the normal
data folders (`%APPDATA%\Varak`, `%LOCALAPPDATA%\Varak`); automated runs always use `VARAK_DATA_DIR` under
`test-output/` and never touch them.

## Next steps

1. Publish: create the GitHub repository and push the local history (needs the owner's decision and account; check
   the commit author e-mail first, it becomes public).
2. Verify DPI with a scaled monitor; investigate the owned-mode soffice hang only if child mode shows DPI problems.
3. Report the Turkish-locale hang upstream (TDF Bugzilla) with the reproduction from dev/engine.md.
4. Continue with M2 (ROADMAP.md).
