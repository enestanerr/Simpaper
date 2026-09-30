# PDF module (developer notes)

The PDF module shows and edits PDFs with **pdf.js 6.3.289** (components build) in the sandboxed renderer and
changes files with **@cantoo/pdf-lib 2.11.1** in the main process. Research and sources: [docs/research/pdf.md](../research/pdf.md).

```
renderer (src/renderer/modules/pdf)                      main (src/main/pdf)
  PdfWorkspace ── PdfController ── pdf.js PDFViewer        createPdfService(deps)
     │  thumbnails, find bar, dialogs      │                  read / update / save
     │                                     │ pdf:* IPC         insertText / insertImage
  ribbon (shell actions) ── actions.ts ────┴──────────────►  pages / merge / extract / print
  status bar, store (zustand)                                  appearance fix, verify, safe write
```

## Data flow

- **Open**: `pdf:read` returns the working copy (`registry.get(docId).workingCopyPath`); pdf.js loads the bytes.
- **Annotations and forms** live in pdf.js' `annotationStorage`. `PdfController.flush()` runs
  `pdfDocument.saveDocument()` (an incremental update of the loaded bytes) and sends it with `pdf:update`, which
  stores it in the working copy and marks the document modified. The first edit after loading is synced at once;
  later ones are debounced (700 ms) after input and editor events. Flushes also run on window blur, when the tab is
  deactivated, before every file operation and when the shell shows an "unsaved changes" prompt for the document.
  The storage hash decides whether anything changed; an empty storage after earlier flushes (everything undone)
  writes the loaded bytes back.
- **Modified flag without waiting for the sync**: pdf.js reports the first storage change after loading and after
  every `saveDocument()` (`onSetModified`). While the main process has the document clean (the shell's store mirrors
  its descriptor: after loading, after every save), that change is reported at once with `pdf:markModified`, so a
  Ctrl+W or quit right after an edit never skips the "save changes?" prompt. When the main process reports the
  document saved (`modified` true → false) while the storage holds edits that were not synced yet (typed during the
  save), the document is marked modified again and synced.
- **Flush protocol with the shell and the main process**: the module's `flush` hook (`ModuleDefinition.flush` =
  `flushPdf`, `actions.ts`) runs `controllerFor(docId)?.flush()`. The shell awaits it before `documents:close`
  (tab ×, middle click, Ctrl+W) and when the main process sends a `flushRequest` event (before it saves, extracts,
  closes or quits), after which the shell always answers `documents:flushDone { requestId }`
  (`services/documents.ts`, see shell-ui.md §5).
- **Page operations, merge, add text/image** go to the main process; the returned bytes are loaded again and the
  page (mapped through the ops, `logic/pages.ts`), scroll offset, zoom and view rotation are restored.
- **Save** = flush + `pdf:save`: `safeWrite(target, …, { verify })` where verify re-parses the temp file with
  pdf-lib (encrypted files structurally, without the password) and compares the page count with the working copy.
  On success the descriptor gets `path`, `title`, `format: 'pdf'`, `modified: false` and an `updated` event.
  Overwriting a **signed** original with a file that is not an incremental update of it (e.g. after page
  operations) first asks through `registry.prompt({ kind: 'saveRisk', findings: [digitalSignature] })`; "save a copy"
  writes elsewhere and keeps the document bound to the original.

## pdf.js integration

- `pdfjs/lib.ts` imports `pdfjs-dist` before `pdfjs-dist/web/pdf_viewer.mjs` (the viewer reads
  `globalThis.pdfjsLib` when it loads) and imports `pdf_viewer.css`.
- **Worker**: one module worker per open document (`new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url), { type: 'module' })` wrapped in `PDFWorker`). A shared `GlobalWorkerOptions.workerPort` is not
  used: destroying any loading task destroys the shared `PDFWorker` wrapper, and a concurrently opening document then
  fails with "the worker is being destroyed". Closing a document terminates its worker.
- **CMaps, standard fonts, WASM** come from a custom `BinaryDataFactory` (`pdfjs/resources.ts`): each file is a lazy
  `import.meta.glob(…, { query: '?url&inline' })` chunk holding a `data:` URL that is decoded without fetch/XHR, so it
  works from `file://` (packaged app) and the dev server, offline. `useWorkerFetch: false`. QuickJS (PDF scripting)
  is not bundled; PDF JavaScript never runs (no `PDFScriptingManager`), matching "macros are never executed".
  `iccUrl` is unset (CMYK ICC profiles fall back to pdf.js' built-in conversion).
- `isEvalSupported` no longer exists in pdf.js 6.3.289 (no occurrence in `build/pdf.mjs` or the worker), so there
  is nothing to disable.
- **Localisation of pdf.js' own UI** (editor labels, "Start typing…", resize handles): `pdfjs/l10n.ts` implements
  pdf.js' L10n interface on top of i18next; strings are in `pdf.json` under `pdfjs.<id>.<attribute>`.
- Annotation icons are looked up by pdf.js under `imageResourcesPath`; Vite hashes their names, so
  `annotationlayerrendered` rewrites the `<img src>`.
- The components build does not refit preset zooms on resize; a ResizeObserver re-applies `page-width`/`page-fit`/
  `auto`. Ctrl+wheel and touchpad pinch call `updateScale` (otherwise Chromium would zoom the whole window).

### Search (Turkish)

pdf.js matches with a RegExp `i` flag (plus `u` when the page has diacritics). That pairs I/i only: "ılık" never
finds "ILIK", and "istanbul" misses "ıstanbul". `pdfjs/find.ts` subclasses `PDFFindController` and overrides its
public `match(query, pageContent, pageIndex)`: both sides are folded İ/I/ı/i → i before pdf.js builds its RegExp.
The fold is length-preserving, so pdf.js' offset mapping and text-layer highlighting are unchanged. Case-sensitive
searches are not folded. Tested against the real (legacy) viewer build, including an end-to-end count.

### Editors

Available in the components build and exposed in the ribbon: highlight (text and free-hand), free text, ink,
stamp/image (pdf.js opens the file chooser), plus colour/size/thickness via `switchannotationeditorparams`, undo/redo/
delete via `editingaction`, "highlight selection". **Comments**: pdf.js' comment UI needs its comment manager, which
the components build does not export (its comment button is not rendered without it); the ribbon's *Comment* opens
our dialog and sets `editor.comment` on the selected annotation, which pdf.js saves as `/Contents` + `/Popup`.
Not exposed: signature (needs pdf.js' signature manager), standalone sticky notes, underline/strike-out, shapes
(no editors in pdf.js 6.3). pdf.js' alt-text button is hidden (its dialog is not in the components build).

### Links

External link annotations (`http(s)`, `mailto`, …) never navigate the app window: a capture-phase click handler
shows the address with a *Copy link* button. (`app:openExternal` only opens allow-listed project URLs.)

## Main-process service (`src/main/pdf`)

| File | Purpose |
|---|---|
| `index.ts` | `createPdfService(deps)`; per-document mutex around every read-modify-write of the working copy |
| `page-ops.ts` | rotate (relative, `setRotation`), delete, move, insert blank (neighbour's size/rotation), duplicate (`copyPages`), merge, extract; full rewrite |
| `structure.ts` | pruning of unreachable objects; complete page removal (content, resources, annotations; widgets detached from their fields); AcroForm registration of copied fields (clashing names become `name_2`) |
| `content.ts`, `layout.ts` | add text/image as page content, incremental update; existing content wrapped in `q … Q` first |
| `fonts.ts` | Unicode font choice by glyph coverage: `deps.fontFiles()` candidates, then pdfjs-dist's Liberation Sans |
| `appearance.ts` | Turkish appearance fix (below) |
| `verify.ts` | save verification |
| `print.ts` | hidden, script-less BrowserWindow + `webContents.print` (only the system dialog is shown) |

- **Deleted pages really disappear**: pdf-lib writes every parsed object, so page operations rewrite the file and
  prune everything unreachable from the trailer; a deleted page is also stripped of its content in case an outline
  or structure element still points at it. (A test checks that the text of a deleted page is in no stream.)
- **Encrypted PDFs**: pdf-lib would write them back decrypted, silently removing the protection, so page
  operations, merge (of encrypted sources) and add text/image are refused with `pdf.errors.encrypted`. Viewing,
  annotating, form filling and save work (pdf.js' incremental save keeps the encryption).
- **Add text**: `(x, y)` is the top-left corner of the text block in PDF space as the page is displayed (its
  `/Rotate` applied); lines run right/down in that orientation, so text is upright on rotated pages. Images use the
  same anchor. The font is embedded as a subset (full embedding if subsetting fails).
- **Fonts**: in the development image the engine fonts are in `vendor/libreoffice/Fonts/` (admin MSI layout:
  `DejaVuSans.ttf`, `LiberationSans-Regular.ttf`, `NotoSans-Regular.ttf` …); an installed LibreOffice has them in
  `share/fonts/truetype/`. All of them, and pdfjs-dist's `standard_fonts/LiberationSans-Regular.ttf`, cover
  ğüşıöçİĞÜŞÖÇ.

### Turkish appearance fix

pdf.js 6.3 saves a FreeText whose text Helvetica/WinAnsi cannot encode **without `/AP`** (invisible in Chrome/Edge),
and form values it cannot encode without appearance plus `/NeedAppearances true`. On every `pdf:update` the service
(cheap byte scan first) loads the bytes `forIncrementalUpdate` and:

- draws FreeText appearances with an embedded Unicode font, mirroring pdf.js' own layout
  (`FreeTextAnnotation.createNewAppearanceStream`: line factor 1.35, rotation matrices, shrink to fit). A hash of the
  inputs in the stream (`/SimpaperAP`) lets later edits made by pdf.js (which keeps the old `/AP`) be detected and redrawn;
- regenerates text/choice field appearances with pdf-lib and the Unicode font (field `/DA` kept) and clears
  `/NeedAppearances` when no widget lacks an appearance.

Encrypted documents are skipped; any failure keeps pdf.js' bytes (logged). Verified with real `saveDocument()` output.

### Printing

The renderer renders every page at 200 dpi with the print intent and the annotation storage (as pdf.js' print
service does) and sends PNGs with `pdf:print` (`pages`). The main process writes them to a private temp folder,
loads a script-less HTML page into a hidden, sandboxed window (CSP, navigation and pop-ups blocked), calls
`webContents.print({ silent: false })` and deletes the folder. Cancelling in the dialog is not an error. Memory:
roughly one PNG per page is held until the dialog closes; very large documents print slowly.

## Keyboard and accessibility

- Ctrl+F find bar (Enter / Shift+Enter, F3 / Shift+F3, Esc), Ctrl+plus/minus/0 zoom, Esc cancels placement.
- Thumbnails are a multi-select listbox: arrows/Home/End move, Shift extends, Ctrl+Space toggles, Enter opens,
  Ctrl+A selects all, Delete deletes (with confirmation), **Alt+↑/↓ moves the selected pages** (keyboard alternative
  to drag and drop).
- *Add text/image* can be placed with Enter (top-left margin of the current page) as well as with the mouse.
- *Previous/Next field* move the focus through form fields in reading order, across not-yet-rendered pages.
- Dialogs use the shell's `Dialog` (focus trap, Esc, labelled); notices use `role=alert`/`status`.

## Ribbon integration

Controls are `shell` actions implemented in `actions.ts` (`ModuleDefinition.actions`, which also overrides
`file.save`, `file.saveAs`, `file.print`, `edit.undo`, `edit.redo`, `edit.find`, `view.zoomIn/Out` for PDFs).
Toggle states (active tool, thumbnails, field highlight, scroll/spread mode) are published to the shell's command
store under `pdf:*` keys (`state/commandBridge.ts`) and bound with ordinary `state` bindings. Zoom, page number,
text size and thickness are custom controls (the shell's combo view is disabled for non-office documents).

## Known limitations

- Existing page text cannot be edited (pdf.js cannot; see the research for the PDFium route).
- Signatures (visual), sticky notes, shapes, underline/strike-out, redaction, OCR: not in M1.
- Password-protected PDFs: no page operations / page content (see above); no password add/remove.
- Merged documents keep their pages and form fields; outlines, page labels and the structure tree of appended files
  are not merged. Duplicated pages deep-copy their resources (larger files).
- XFA-only forms are not rendered as forms (`enableXfa: false`); PDF JavaScript does not run.
- "Add text" is oriented by the page's saved `/Rotate`; a temporary view rotation does not change it.
- A FreeText created by another application with Turkish text and edited in Simpaper keeps that application's
  (stale) appearance; only appearances without `/AP` or generated by Simpaper are redrawn.
- The appearance fix parses the document with pdf-lib on each sync when it contains FreeText annotations or
  `/NeedAppearances`; very large documents with such content sync more slowly.
- Print renders the whole document into PNGs first (200 dpi); memory grows with the page count.

## Tests

`npx vitest run --project unit tests/unit/pdf` — service operations with a fake registry and a real temp-folder
SafeWriter, verified with the pdf.js legacy build (text extraction, rotations, order, fields, rendering to pixels via
@napi-rs/canvas); the appearance fix on real pdf.js `saveDocument()` output; renderer logic (search folding,
viewport↔PDF against pdf.js' PageViewport, page-op planning, zoom, fields); the find controller subclass and the
pdf.js localisation service on the real viewer build (jsdom); the bundled resource loader through Vite's transform;
ribbon wiring, keytips and i18n completeness (tr/en); the controller's edit sync (`controller-sync.test.tsx`:
`pdf:markModified` on the first edit while clean, after saves, during a save; pdf.js replaced by stand-ins). Nothing
in the tests opens windows or prints.

Tests that import renderer modules are `.test.tsx`: `tsconfig.node.json` is a composite project that cannot include
`src/renderer`, so they are type-checked separately with
`npx tsc -p tests/unit/pdf/tsconfig.renderer-tests.json`.

Bundling (worker URL, `import.meta.glob` resources, CSS) was validated with a throw-away Vite build of the module;
in the running app the viewer (text and form PDFs), highlighting, free-text notes and saving were exercised on
screen (GUI runs 2 and 7); forms, page operations, merge, extract and printing only by the unit tests.

## Progress

Review fixes (2026-09-29, review notes kept outside the repository, #10, renderer part): `pdf:markModified` on the
first edit while the main process has the document clean (and again when a save leaves unsynced edits), the module
`flush` hook, the pre-close flush and the `flushRequest` → `documents:flushDone` answer. Tests:
`tests/unit/pdf/controller-sync.test.tsx`, `tests/unit/renderer/lifecycle.test.tsx` › "pending PDF edits". The main
process side (`pdf:markModified` / `documents:flushDone` handlers, `requestFlush` before save/extract/close/quit) is
main-core's.
