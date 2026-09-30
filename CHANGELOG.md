# Changelog

All notable changes to Simpaper are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before version 1.0, minor versions may contain
incompatible changes.

## [Unreleased]

Nothing has been released yet. This section collects the work towards **v0.1.0**, the first installable version
(milestone M1 in [docs/ROADMAP.md](docs/ROADMAP.md)). Items marked *in progress* are not finished; see
[docs/STATUS.md](docs/STATUS.md) for the current state.

### Added

- Research with sources on the engine, file formats, desktop shell, PDF stack, Office user-interface mapping and a
  license-clean test corpus ([docs/research/](docs/research/README.md)).
- Initial architecture ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)) and decision records ADR 0001–0008: unmodified
  LibreOffice 26.8 as the document engine with one process per document, Electron + React + TypeScript shell,
  LibreOffice's editing window hosted in the Simpaper window, pdf.js + @cantoo/pdf-lib for PDF, safe save and loss-risk
  warnings, MPL-2.0, the working name "Simpaper", per-user installer.
- Engine pinned to LibreOffice 26.8.0.3 with scripts that download it, verify its SHA-256 digest and OpenPGP
  signature, extract it without installing anything, build a trimmed copy for packaging (byte-identical files,
  English and Turkish only) and smoke-test it headlessly.
- Main process *(in progress)*: document lifecycle on working copies, safe save (temporary file, verification,
  atomic replace), loss-risk analysis with "save a copy", password prompts, CSV import with preview, autosave
  snapshots and crash recovery, settings, recent files, allow-listed and validated IPC.
- Windows platform layer: hosting of LibreOffice's editing window as a child window of the Simpaper window (an owned
  overlay window remains for development), still image of the document while menus overlap it, process guard that
  ends engine processes with the app, hang detection. Used on screen by the automated GUI spike at 100 % scaling.
- GUI spike (`scripts/gui/gui-spike.mjs`) and screenshot script (`scripts/gui/screenshots.mjs`): drive the packaged
  app with real mouse and keyboard input, check saved files on disk, watch for hangs and capture only Simpaper's window;
  they wait for an idle PC and never type into another window. Real screenshots in Turkish and English are in
  `docs/screenshots/`.
- PDF module *(in progress)*: pdf.js viewer with thumbnails and search that treats İ/ı correctly, highlight, free
  text, ink, images, comments, form filling, page operations, merge and extract, adding text and images, printing,
  verified saving, and Simpaper's own appearance streams for Turkish free text and form values.
- User interface *(in progress)*: Office-style ribbons for the four modules, File backstage, document tabs, status
  bar, KeyTips, Turkish and English, light and dark theme.
- Test tooling: independent readers for OOXML, ODF and PDF, VBA extraction, visual comparison, a generated corpus
  with Turkish content and pinned third-party test files, and headless engine round-trip tests for DOCX, XLSX, PPTX
  and the conversions to the other formats; their findings are recorded in `docs/COMPATIBILITY.md`. Schema
  validation of saved files is still planned.
- Packaging and project files: electron-builder configuration for a per-user NSIS installer and a ZIP, CI and
  release workflows for GitHub Actions, README in English and Turkish, contributing guide, code of conduct, security
  policy, issue forms and pull request template, third-party notices.

### Fixed

- The owned-overlay document view hung the app a few seconds after the first document appeared; child hosting is
  now the default, and the engine owns an overlay frame before it is shown (ADR 0003, amendment).
- Impress showed no slide pane, counted slides from 0 in the status bar, and the Layout button overlapped the
  Slides group label.
- The Writer status bar made LibreOffice lay out the whole document with a progress bar on every update, during
  which Writer ignores keyboard input.
- A lone UTF-16 surrogate in text sent to the engine dropped its connection; it is replaced with U+FFFD.
- LibreOffice dialogs opened from the ribbon (Paragraph, Font …) appeared without the keyboard focus.
- While such a dialog was open, the Quick Access Toolbar and the File tab still worked, so a save or close could run
  inside the dialog; both are now disabled like the ribbon.
- Closing a changed document whose engine hangs or has crashed (or quitting with one open) discarded its unsaved
  changes without asking. Simpaper now asks first, names the time of the last autosave (kept under File → Recover)
  and makes Cancel the default.
- After a click into the document, keys typed into Simpaper's own text boxes (for example the font box), the File view
  and prompts went into the document: Windows kept the keyboard focus in LibreOffice's window. Simpaper now takes it
  for its text boxes and modal views and gives it back afterwards; switching ribbon tabs still leaves the keyboard
  in the document, as in Office.
- While a document's engine hung, the Simpaper window did not react to the mouse or keyboard (Windows shares its input
  queue with LibreOffice's window), so "Restart engine" could not be clicked. About 8 seconds after the "not
  responding" bar appears, Simpaper now offers the restart in a separate message box; a hung engine is ended before its
  view is removed (removing it first could
  block the app); the "not responding" bar disappears once the document responds again or is restarted.
- CSV import: a separator typed under "Other" was shown in the preview but the import used the default separator;
  and choosing other number formats for a legacy-encoded file (Windows-1254/1252) switched its code page, so the
  imported text differed from the preview.
- Third-party notices: code bundled inside dependencies was missing (Apache-2.0 parts of brotli and pdf-lib, the
  licence files of vendored code, MIT texts of packages without a licence file), and the sort order depended on the
  build machine's language, so the release check would have failed on GitHub's runners. The installer no longer
  contains `elevate.exe`, and the app no longer contains pdf.js' unused QuickJS sandbox.
- The 24 defects of the first adversarial review, among them: edits made while a save was verified could be marked
  saved; unsynced PDF annotations and form edits could be lost on close or quit; the engine folder could be changed
  over IPC; explicit save targets were accepted from the renderer; restoring a crashed document could lose the old
  recovery entry; DOCM/PPTM restored from a snapshot lost the macro warning; text import decided the encoding from
  the first 64 KiB only.

### Security

- Document macros and PDF JavaScript are never executed; the engine's update check, update service and crash
  reporter are switched off; documents are opened without updating external links; no telemetry.
- The build never re-signs or modifies the engine's executables, which keep The Document Foundation's signatures.
- The renderer can no longer change the folder engines are started from, choose save targets without a dialog,
  or pass arguments to engine commands beyond an allow-list.

[Unreleased]: https://github.com/ncreativestudios/Simpaper/commits/main
