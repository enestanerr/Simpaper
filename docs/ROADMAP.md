# Roadmap

Milestones are delivered as working, installable versions. A milestone is done only when every
acceptance criterion is demonstrated by an automated test or a documented, repeatable manual check.
Current progress is tracked in [`STATUS.md`](STATUS.md). A checked box below means the criterion is proven by the
automated tests named next to it. Criteria that need a visible desktop stay unchecked until every part of them has
been shown on screen; the GUI runs so far ([testing/GUI_SPIKE.md](testing/GUI_SPIKE.md), Results) covered only parts
of them (for example ribbon Bold, Ctrl+S, one Calc formula, a new slide, PDF highlight and free text, KeyTips
appearing on Alt).

## M0 — Foundations ✅/🔄

- Research of engines, licenses, shell technology, PDF stack, Office UX mapping, test corpus (`docs/research/`).
- Architecture decision and ADRs (`docs/ARCHITECTURE.md`, `docs/adr/`).
- Pinned, signature-verified engine: LibreOffice 26.8.0.3 (x64 MSI, GPG key `C2839ECA…AFEEAEA3`).
- Feasibility prototype of native window hosting (Electron + LibreOffice).
- Repository scaffold: typed contracts, build, lint, unit test runner.

## M1 — Four modules with a real open → edit → save flow (v0.1)

Not full Office compatibility — the first installable version.

**Installation**
- [ ] `npm run dist:win` produces a per-user NSIS installer and a ZIP that include the engine; the app starts
      offline on a clean Windows 10/11 x64 machine without admin rights. _(Both are built; the Simpaper installer was
      installed on the development PC without admin rights by scripts/installer/verify-install.mjs. A clean machine
      is still to be tried.)_
- [x] `build/installer.nsh` writes a ProgID per format with its icon, the "Open with" entries and the Default apps
      registration, takes a type's default only where no other app owns it, keeps everything on an update and
      removes it on uninstall ([ADR 0010](adr/0010-file-associations.md)). _(tests/unit/main,
      scripts/installer/check-associations.mjs against a scratch registry key)_
- [ ] On a real installation: Explorer shows Simpaper's icons, a double-click opens Simpaper, Windows' prompt and
      Settings › Apps › Default apps offer Simpaper, and uninstalling leaves nothing behind. _(Icons, double-click,
      multiple selection, update and uninstall verified on the development PC by
      scripts/installer/verify-install.mjs; Windows' prompt and the Settings page not yet.)_

**Documents (DOCX)**
- [ ] Open a DOCX, type Turkish text, apply bold/italic/underline, font, size, color, alignment, bullets,
      heading style; insert a table and an image; save as DOCX.
- [x] Automated round trip: open → modify → save → close engine → reopen → the modification and the original
      content (headers/footers, tables, images) are present; verified by the engine and by an independent
      OOXML parser. _(tests/engine/roundtrip, documents-writer, independent)_

**Spreadsheets (XLSX)**
- [ ] Enter values and formulas (relative/absolute references, cross-sheet references, SUM, AVERAGE, IF, VLOOKUP,
      DATE/TEXT functions) through the formula bar; results recalculate; save as XLSX.
- [x] Automated round trip verifies values, formulas and cached results; Turkish and English locale behaviour
      of decimal separators and CSV separators is tested. _(tests/engine/calc, documents-office, independent)_

**Presentations (PPTX)**
- [ ] Edit text on a slide, add/duplicate/delete slides, insert an image, save as PPTX; slideshow starts (F5).
- [x] Automated round trip verifies slide count, texts and images. _(tests/engine/roundtrip, documents-office, independent)_

**PDF**
- [ ] View (thumbnails, zoom, rotate view), search, select/copy text.
- [ ] Highlight, free text (Turkish), ink, image stamp; fill an AcroForm; rotate/delete/reorder/merge/extract pages;
      save; reopening shows all changes.
- [x] Create PDFs from the three office modules. _(tests/engine/export, documents-office)_

**Shell**
- [ ] Office-like ribbon (Home/Insert/Layout/View … per module) where every enabled control works; QAT; File
      backstage (new/open/recent/save/save as/export PDF/print/options/about); document tabs; status bar with zoom.
- [ ] Turkish and English UI; light/dark theme; keyboard access to the ribbon.

**Data integrity**
- [x] Safe save (temp + verify + atomic replace) — fault-injection tests prove the original survives failures. _(tests/unit/main)_
- [x] Loss-risk warning with "save a copy" for risky content (macros, SmartArt, chartex, legacy formats …). _(tests/unit/main, tests/engine/documents-office)_
- [x] Autosave + crash recovery: killing the engine process during editing loses at most the autosave interval. _(tests/engine/documents-recovery)_

**Project**
- [ ] README (EN/TR) with real screenshots, compatibility matrix, known limitations, contribution files, CI.
      _(All in place; the screenshots were captured again from the running app after the rename on 2026-09-30;
      open: a green CI run on GitHub, where the workflows run since the first push.)_

## M2 — Editing depth and fidelity (v0.2)

- The M1 ribbons already reach several items below through LibreOffice's own commands and dialogs (find & replace,
  styles gallery, comments, track changes, headers/footers, table of contents, Calc sort/filter/freeze
  panes/conditional formatting/data validation/charts/print areas, Impress layouts and transitions); M2 covers
  their depth and their verification on a real desktop.
- Contextual tabs verified on a real desktop (implemented in M1: table, picture, drawing, chart tabs driven by engine
  context events; KeyTips with Alt/F10).
- Find & replace UI, print preview, styles gallery, comments and track changes, headers/footers, page numbers,
  sections, table of contents.
- Calc: sort/filter, freeze panes, conditional formatting, data validation, charts, print areas.
- Impress: layouts, themes/master slides, speaker notes, transitions, presenter keyboard control.
- PDF: sticky notes, shapes, underline/strike-out, qpdf integration (repair, password add/remove, linearize).
  (Our own Unicode appearance streams for Turkish FreeText/form values were implemented in M1.)
- High-DPI verification at 125/150/200% and mixed-DPI monitors; final choice between owned/child hosting.
- Visual regression suite for documents and slides.

## M3 — Format coverage and robustness (v0.3)

- Verified matrix for DOC/DOCM/DOTX/DOTM/RTF/TXT/ODT, XLS/XLSM/XLSB/XLTX/XLTM/CSV/TSV/ODS,
  PPT/PPTM/PPS/PPSX/PPSM/POTX/POTM/ODP (open, display, edit, save, convert, preserved/lost features).
- Setting and removing document passwords (opening password-protected documents and the CSV import dialog with
  preview are already in M1, see CHANGELOG.md); macro-enabled format policy.
- Large-file performance budget and cancellable long operations.
- Hot-path UNO glue moved into the engine process (in-process Python component) if latency requires it.
- Auto-update, signed releases (SignPath Foundation). (File associations with Simpaper's own file-type icons were
  implemented in M1, see [ADR 0010](adr/0010-file-associations.md).)

## M4 — Advanced features

- Pivot tables, advanced charts, animations.
- PDF: in-place correction of existing text (PDFium, verified), redaction, OCR for scanned documents
  (tesseract.js, Turkish + English), accessibility audit with NVDA/Narrator.
- Linux (X11) and macOS exploration (different document surface).
