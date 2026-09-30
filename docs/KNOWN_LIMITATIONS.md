# Known limitations

_Last updated: 2026-09-29._ Simpaper is in early development (milestone v0.1 in progress, see
[STATUS.md](STATUS.md)). This list is honest on purpose: it names what does not work, what has not been verified
and what is lost in certain file formats. Format-by-format details are in [COMPATIBILITY.md](COMPATIBILITY.md).
If you hit a limitation that is not listed here, please [open an issue](https://github.com/ncreativestudios/Simpaper/issues).

## General

- **Not ready for everyday use.** There is no released version yet. The v0.1 milestone
  ([ROADMAP.md](ROADMAP.md#m1--four-modules-with-a-real-open--edit--save-flow-v01)) is being implemented.
- **Not tested in Microsoft Office.** Compatibility is checked with LibreOffice and independent open-source tools
  only. Files saved by Simpaper may look or behave differently in Word, Excel or PowerPoint, and Excel may calculate
  some formulas differently (for example dates before 1 March 1900).
- **Windows only.** Windows 10 and 11, x64. macOS and Linux are not supported: the document surface relies on
  Win32 window hosting ([ADR 0003](adr/0003-document-surface.md)); other platforms are a later exploration (M4).
- **Macros never run.** This is deliberate ([ADR 0005](adr/0005-data-integrity.md)). Documents that depend on VBA
  or LibreOffice Basic macros will not behave as intended; the macros themselves are preserved where the format
  allows.

## Office documents (LibreOffice engine)

- **Aptos and other missing fonts.** LibreOffice has no metric-compatible substitute for **Aptos**, the default
  font of Microsoft 365 since 2023–24. Documents that use it re-flow when Aptos is not installed: line breaks,
  page breaks and slide text fitting can change. Calibri, Cambria, Arial, Times New Roman and Courier New have
  bundled substitutes (Carlito, Caladea, Liberation).
- **Content that is lost or can't be edited** in some formats: Excel slicers, timelines, Power Query and the Data
  Model are lost on save; SmartArt is kept but can't be edited; Office 2016+ charts (waterfall, treemap, sunburst,
  funnel, …) are kept but not drawn in spreadsheets, and in Word documents they are **replaced by their fallback
  pictures** when saving (tested); the PowerPoint Morph transition, ink and 3D models are not supported; inline
  equations in PowerPoint text are lost. Simpaper warns before saving when it detects such content.
- **Changes after saving** (found by the automated round-trip tests, see
  [COMPATIBILITY.md](COMPATIBILITY.md#hard-cases)): PowerPoint slide masters lose their text styles, so spacing
  and bullet sizes that are defined only in the master can change; with Turkish regional settings two Excel number
  formats are rewritten (`0.00%` → `%0.00`, `dd.mm.yyyy` → `dd/mm/yyyy`); Excel macro projects are rebuilt and
  lose macro descriptions and shortcut keys.
- **Passwords.** Password-protected **PPT** files can't be opened, and PPT can't be saved with a password. OOXML
  files are saved with Standard encryption (AES-128), which is weaker than Office's default. Rights-managed
  (IRM/DRM) files can't be opened.
- **Macro-enabled templates and shows** (DOTM, XLTM, POTM, PPSM) can't be saved with their macros in their own
  format; Simpaper proposes DOCM/XLSM/PPTM instead. **XLSB** can be opened but not saved as XLSB.
- **Impress slide pane.** The slide list on the left is LibreOffice's own slide pane (its look and its context menu
  come from LibreOffice, not from Simpaper's ribbon style).
- **LibreOffice's own dialogs** appear for advanced features (for example paragraph, cell or chart dialogs).
  They follow LibreOffice's look and its Turkish terminology, which differs from Microsoft's in places
  (for example "Eğik" instead of "İtalik").
- **Upstream engine crashes.** LibreOffice 26.x can crash or show rendering glitches when it is driven by another
  process on Windows (tdf#172048, tdf#172304). Simpaper runs one engine process per document, orders its own object
  releases before closing a document (this removed a reproducible "release after close" crash, see
  [dev/engine.md](dev/engine.md)) and offers crash recovery, but an engine crash can still lose the changes made
  since the last autosave.
- **A hung engine can't save, and it blocks the Simpaper window.** LibreOffice's window lives inside the Simpaper window,
  and Windows gives both one input queue: while the engine hangs, the Simpaper window does not react to the mouse or
  keyboard (it still redraws and shows a "not responding" bar). About 8 seconds after that bar appears (roughly
  13 seconds after the engine stopped responding), Simpaper offers "Restart engine" / "Wait" in a separate message box,
  which names what a restart loses (the changes after the last autosave; "Wait" is the default); it closes by itself
  if the engine recovers. Simpaper never ends an engine on its own. When the
  window still takes input, closing the document or quitting asks first in the same way and keeps the autosave
  under File → Recover.
- **No grammar checking and no Python macros.** On Windows with Turkish regional settings, LibreOffice's built-in
  Python switches the C runtime locale to a name with a non-ASCII letter (`Turkish_Türkiye.utf8`); the runtime then
  reports an invalid parameter and LibreOffice's crash handler deadlocks, so creating a text document hung forever.
  Simpaper therefore starts the engine without its in-process Python (no LibreOffice file is changed; see
  [dev/engine.md](dev/engine.md)). Consequences: the Lightproof grammar checker (English, Hungarian, Portuguese,
  Russian), Python macros and Python-based wizards are unavailable. Spell checking (Hunspell, Turkish and English)
  works. This is an upstream LibreOffice bug that has not yet been reported to The Document Foundation.
- **Memory.** Each open office document runs its own engine process, so many open documents use a lot of memory.
- **Large files** have no performance budget or cancellable long operations yet (planned for M3).

## PDF

- **Most PDF editing tools have only been tested automatically.** In the running app, highlighting, free-text notes
  and saving were checked on screen (the saved file read back independently); forms, page operations, merge and
  extract are covered by unit tests with generated files (see [COMPATIBILITY.md](COMPATIBILITY.md#test-status)).
- **Existing PDF text can't be edited** in v0.1. You can add annotations, free text, drawings, images and new text,
  fill forms and reorganise pages. Small in-place corrections are planned for M4.
- **Turkish text in other PDF viewers.** pdf.js, the PDF engine, saves free-text annotations and form values that
  contain letters such as ğ, ş, ı or İ without an appearance, so Chrome and Edge would not show them. Simpaper draws
  these appearances itself when it saves. A free-text annotation created by *another* application and edited in
  Simpaper keeps that application's (now outdated) appearance.
- **Digital signatures** are invalidated by operations that rewrite the file (rotating, deleting, moving,
  inserting or duplicating pages, merging). Simpaper asks before it overwrites a signed file that way and offers to
  save a copy. Annotation and form saves are incremental and keep the signed revision intact.
- **Password-protected PDFs** can be viewed, annotated, filled in and saved (the protection stays), but pages
  can't be reorganised, text and images can't be added, and they can't be merged into another file, because the
  PDF library would write them back without protection. Passwords can't be added or removed yet (M2).
- **Merging** keeps the pages and form fields of the added files, but not their bookmarks, page labels or
  accessibility structure.
- **Not yet available:** OCR for scanned PDFs (M4), redaction (M4), repairing damaged files (M2), sticky notes,
  shapes, underline/strike-out annotations and signatures (M2). Forms that exist only as XFA can't be filled, and
  JavaScript in PDFs never runs.
- **Printing** sends page images rendered at 200 dpi to the printer; very large documents print slowly and need
  more memory.

## Windows integration and display

- **High-DPI and mixed-DPI monitors are not verified.** LibreOffice is only System-DPI aware (tdf#145710) while
  Electron is per-monitor aware; the default child hosting also makes Windows reset LibreOffice's DPI mode to the
  host's (see [ADR 0003](adr/0003-document-surface.md)). At 125/150/200 % scaling, or when moving the window between monitors with
  different scaling, the document area may be blurry or mis-sized. Verification is scheduled for M2.
- **Menus over the document ("airspace").** Web content can't be drawn over the native document window. While a
  drop-down, gallery, the File backstage or a dialog overlaps the document, Simpaper shows a still image of the
  document ("freeze-frame") until the popup closes.
- **Keyboard.** Some LibreOffice shortcuts differ from Microsoft Office until Simpaper's Office-style shortcut profile
  is complete; on the Turkish-Q and Turkish-F layouts, AltGr combinations (Ctrl+Alt) can collide with shortcuts.
  KeyTips (Alt or F10, then letters) were checked on screen with the focus in Simpaper's own interface; for use while
  typing in the document they need the experimental option "KeyTips while working in a document" (off by default,
  not yet tried on screen).
- **Only partly seen on screen.** Automated GUI runs (real mouse and keyboard, 100 % scaling) passed the core flows
  in the child hosting mode: placement, Turkish typing, ribbon commands, drop-downs over the document, saving,
  Calc formulas, Impress slides with the slide pane, PDF highlights and notes, LibreOffice dialogs, KeyTips, the loss
  warning and quitting with unsaved changes, window moves and themes, typing into the ribbon's text boxes after
  working in the document, a hung engine restarted from the rescue box, and a background document whose engine
  ended restarting without covering the active one. The **owned (overlay) mode** hung LibreOffice
  on this PC and is not offered in Options (development only). Not yet exercised on screen: printing and scaled
  displays ([docs/testing/GUI_SPIKE.md](testing/GUI_SPIKE.md)).
- **Accessibility** has not yet been audited with NVDA or Narrator (planned for M4).

## Distribution

- **Unsigned installer.** Code signing is not configured yet (planned: SignPath Foundation), so Windows SmartScreen
  warns when the installer or the app is started for the first time. The LibreOffice programs inside keep The
  Document Foundation's own signatures; Simpaper's build never re-signs or changes them.
- **No automatic updates and no file associations** in v0.1 (planned for M3). Simpaper does not register itself as
  the default app for any file type.
- **Download size.** The installer contains the LibreOffice engine (about 0.74 GB unpacked after removing unused
  languages) and the Electron runtime.
- **Name.** "Simpaper" is a working name; a formal trademark search is still required before a public launch
  ([ADR 0007](adr/0007-product-name.md)).
