# PDF engine stack for the PDF module (Electron, offline, Windows-first): pdf.js, pdf-lib forks, qpdf, PDFium/EmbedPDF, MuPDF, LibreOffice Draw import, OCR

> Research notes of 2026-09-28 on the PDF engine stack, prepared before the architecture decision and published
> with details about the research machine removed. Findings age quickly: check the linked sources before relying
> on a version number, a price, a bug status or a release date. Decisions are recorded in [docs/adr](../adr/README.md).

## Summary
**Verdict.** The research supports a web-based PDF stack, but it needs several layers, not one library. pdf.js should be the main engine for viewing, annotations, forms and page organisation, because it saves changes incrementally. It cannot edit existing page content, and it saves FreeText and form appearances incorrectly for Turkish text. Three pieces fill those gaps:
- **qpdf** for file structure and integrity.
- **PDFium compiled to WebAssembly (WASM)**, used headless for low-level edits to existing objects.
- **@cantoo/pdf-lib**, a maintained fork of pdf-lib, for writing new content with embedded Unicode fonts.

LibreOffice should be used to create PDFs and for Hybrid-PDF round trips, never as the default PDF editor. MuPDF (AGPL) and upstream pdf-lib (abandoned since 2021) should be rejected.

**pdf.js (pdfjs-dist 6.3.289, 2026-08-29, Apache-2.0, ESM-only, monthly releases; 6.0 had breaking API changes)**
- **Editors:** FreeText, Highlight (text or free-hand), Ink, Stamp/image, Signature (visual only, saved as a Stamp), Comment/Popup. Comments attach to annotations. There is no standalone sticky note, underline/strike-out, shape or redaction editor.
- **Saving:** `saveDocument()` appends an incremental update to the original bytes. Objects in encrypted files are encrypted with the file's own key. Existing FreeText/Highlight/Ink/Stamp annotations can be edited.
- **Page operations:** `extractPages()` is the engine behind Firefox 150 page management (2026-04-21) and Firefox 151 merge (2026-05-19). It merges, splits and reorders pages and can insert images as pages. It merges AcroForm fields, outlines, the structure tree and page labels. The output is a full rewrite; encryption survives only when all pages come from one file. It cannot set page rotation.
- **Forms:** AcroForm filling with a sandboxed JavaScript engine (QuickJS). XFA forms are partly supported. Passwords are handled via `onPassword`. The signature metadata API is public, but signature verification only works in Firefox.
- **Turkish-specific defects (confirmed in the source code):**
  - FreeText appearances use Helvetica with WinAnsi encoding. Text containing ğ/ş/ı/İ/Ğ/Ş is saved with no appearance stream (/AP), so it does not show in PDFium-based viewers (Chrome, Edge).
  - Form values that the field's font cannot encode are saved with `/NeedAppearances` instead of an appearance.
  - The upstream fix (PR #21858, merged 2026-09-09) is compiled only into Firefox builds.
- **Generic build limits:** in the generic build the comment, signature and split/merge UI is switched off by default. The components build does not include the signature dialog, comment sidebar or page organiser, so the ribbon needs its own versions (the Apache-2.0 code can be ported).
- **Printing:** the viewer prints by rasterising pages at 150 DPI.
- **Electron:** use the modern build in a sandboxed renderer. Set `workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), {type:'module'})`. Serve cmaps, standard_fonts, wasm and iccs from a privileged custom scheme, and pass file bytes over IPC.
- **Node tests:** use `pdfjs-dist/legacy/build/pdf.mjs` with `@napi-rs/canvas`: `doc.canvasFactory.create()`, then `canvas.toBuffer('image/png')`. Needs Node 22.13 or later; Electron 44 ships Node 24.21.

**pdf-lib**
- Upstream 1.17.1 (2021-11-06) is dead: no encryption support, full rewrite on every save.
- **@cantoo/pdf-lib 2.11.1** (2026-09-15, MIT) opens encrypted files with a password, can encrypt with AES-256, supports incremental updates, SVG and PDF/A structure, and uses @cantoo/fontkit.
- Its standard fonts are WinAnsi-only, so Turkish text needs an embedded TTF font. Font subsetting fails for some fonts.
- The fork moves fast, so versions must be pinned.

**qpdf 12.4.2** (2026-09-27, Apache-2.0)
- Does: remove or add passwords (AES-256), rebuild a damaged cross-reference table, linearize, `--pages`/`--split-pages`, `--rotate`, `--overlay`, `--flatten-annotations`, `--check`, JSON output.
- The Windows runtime is about 9.3 MB. It does not render pages or edit content.
- `--generate-appearances` turns non-WinAnsi characters into '?', so it is unusable for Turkish.

**PDFium**
- `FPDFText_SetText` replaces the text of an existing text object. `FPDFPage_GenerateContent` followed by `FPDF_SaveAsCopy(FPDF_INCREMENTAL)` saves the change.
- `@embedpdf/pdfium` 2.15.1 (MIT, PDFium under BSD/Apache, 4.65 MB WASM) exports all of these, plus access to embedded font data, image replacement, rotation, moving/importing pages and flattening.
- No library offers a safe high-level "edit text": subset fonts lack the new glyphs and widths. One third-party project reports silent text corruption across 1,533 files unless each edit is read back and verified.
- The EmbedPDF viewer (v2 MIT; v3 Apache, pre-release) has more annotation types and true redaction. It has no text editing, rewrites the whole file on save, and fetches fallback fonts from a CDN by default.

**MuPDF.js 1.28.1** is AGPL-3.0-or-later (a commercial licence is also sold). It has strong redaction and page operations but no API for editing existing text. Linking it would force AGPL on the whole app.

**LibreOffice Draw PDF import**
- Poppler runs in a separate GPL program (`xpdfimport`).
- It rebuilds lines with "very simple heuristics", giving one text box per line.
- Embedded fonts are only used to guess the family name; the text is shown in an installed substitute font, falling back to Arial. Clipping and fills are sometimes wrong.
- Saving re-exports a new PDF, which loses interactivity and document structure.
- Hybrid PDF (`IsAddStream`) is the only lossless editing route, and it only works for PDFs we exported ourselves.

**OCR**
- tesseract.js 7.0.0 (Apache-2.0) with Tesseract language data (Apache-2.0). The compact Turkish model is 2.14 MB compressed.
- The `pdf` + `pdfTextOnly` output is an invisible text layer. `qpdf --overlay` puts it on top of the untouched original page.
- By default tesseract.js downloads from the jsDelivr CDN, so local paths must be configured.
- OCRmyPDF 17.13 (MPL-2.0) produces better results but needs Python plus native Tesseract; defer it.

**Hard parts**
1. Editing existing text: expect only small corrections within a line, in the same font, with no reflow. Anything larger is an overlay or a lossy conversion.
2. Appearance streams for Turkish text.
3. OCR accuracy and alignment with the page.
4. Keeping signed files valid: every save path that rewrites the whole file breaks existing signatures.

**Size**
- The PDF stack itself is about 40 MB at runtime and roughly 0.25 GB of development dependencies.

## Tables
### Engine matrix (open / display / annotate / forms / page ops / edit existing / save)

| Engine | Version (date) | License | Display | Annotate | Forms | Page ops | Edit existing content | Save mode | Runtime size |
|---|---|---|---|---|---|---|---|---|---|
| pdf.js (pdfjs-dist) | 6.3.289 (2026-08-29) | Apache-2.0 (l10n MPL-2.0) | Yes, Firefox-grade | FreeText, Highlight, Ink, Stamp/image, Signature (visual), Comments on annotations | AcroForm fill + QuickJS sandbox; XFA partial | `extractPages`: merge, split, reorder, insert image pages (no rotate) | No | Incremental (keeps encryption); `extractPages` = full rewrite | ~5-6 MB |
| @embedpdf/pdfium (PDFium WASM, low-level) | 2.15.1 (2026-09-16) | MIT + PDFium BSD-3/Apache-2.0 | Yes (Chrome engine; needs fallback fonts) | FPDFAnnot_* | FORM_* | Import/move/delete/rotate | Text objects via `FPDFText_SetText` (must be verified); image replace/move; object delete | `FPDF_SaveAsCopy` incremental or full | 4.65 MB wasm |
| EmbedPDF viewer | 2.15.1 (v3 pre-release) | MIT (v2) / Apache-2.0 (v3) | Yes | Broad: markup, shapes, sticky notes, stamps, true redaction | Yes | Import, merge, delete | No | Full rewrite (custom save; not verified) | + up to ~157 MB OFL fonts if bundled |
| qpdf | 12.4.2 (2026-09-27) | Apache-2.0 | No | Flatten only | `--generate-appearances` (WinAnsi only) | `--pages`, `--split-pages`, `--rotate`, `--overlay` | No | Full rewrite; encrypt, decrypt, linearize, repair | ~9.3 MB bin |
| pdf-lib (upstream) | 1.17.1 (2021-11-06) | MIT | No (parse only) | Low-level | Fill/flatten (Helvetica default) | Copy, insert, remove | No | Full rewrite; no encryption | n/a (reject) |
| @cantoo/pdf-lib | 2.11.1 (2026-09-15) | MIT | No (parse; decrypts with password) | Low-level | Fill/flatten; custom-font appearances | Copy, insert, remove, rotate | Read-only (`extractContents`) | Full or incremental; AES-256 encrypt | JS only (26 MB unpacked package) |
| MuPDF.js | 1.28.1 (2026-09-06) | AGPL-3.0+ / commercial | Yes | Yes | Widgets | Graft, insert, delete, rearrange | Redaction only | Incremental/full; encryption | 10.4 MB wasm (reject: license) |
| LibreOffice Draw import | LO 26.8 | MPL-2.0 (+GPL Poppler/xpdfimport) | Converts pages to shapes | Annotations flattened or lost | Lost | n/a | Yes, as per-line text boxes (lossy, fonts substituted) | New PDF via export | Part of LibreOffice |
| tesseract.js | 7.0.0 (2025-12-15) | Apache-2.0 (tessdata Apache-2.0) | n/a | n/a | n/a | n/a | OCR to text/hOCR/TSV/text-only PDF | n/a | ~8-12 MB core + ~2 MB per language |

### Requirement mapping

| Requirement | Primary implementation | Aux / fallback | Difficulty | Expected fidelity |
|---|---|---|---|---|
| View, thumbnails, zoom, view-rotate | pdf.js PDFViewer; thumbnails via `page.render` at small scale | PDFium WASM as second renderer in regression tests | Low | High |
| Persistent page rotation | qpdf `--rotate` | pdf-lib `setRotation` / `FPDFPage_SetRotation` | Low | Lossless (/Rotate) |
| Select, copy, search | pdf.js TextLayer + PDFFindController | OCR for scans; custom Turkish I/ı normalizer | Low-Med | Depends on the PDF's ToUnicode data |
| Highlight, ink, comment, stamp, visual signature | pdf.js editors, saved via `saveDocument` (incremental) | Sticky notes, underline/strike, shapes later via PDFium/pdf-lib (pdf.js renders them) | Med | High, except FreeText with Turkish characters (no /AP) until our appearance fix is in place |
| Add NEW text and images | Page content via @cantoo/pdf-lib (`drawText`/`drawImage`, embedded subset OFL font), incremental commit | pdf.js FreeText/Stamp plus our appearance fixer | Med | High; Turkish safe |
| Edit EXISTING text | Tier 1: PDFium in-place edit, only after glyph/width coverage check + read-back + render diff. Tier 2: remove object + overlay in a metric-compatible font | Tier 3: LibreOffice Draw conversion (explicit, lossy). Tier 4: Hybrid PDF -> LibreOffice module | HIGH (hardest) | Tier 1: same-line corrections, no reflow. Tier 2: visible font change possible. Tier 3: layout approximations |
| Edit EXISTING images | PDFium image objects (replace/move/resize/delete) | n/a | Med-High | Good for page-level XObjects; images nested in forms or with masks are limited |
| Insert, delete, reorder, split, merge pages | pdf.js `extractPages` | qpdf `--pages`/`--split-pages`; qpdf `--check` after every write | Low-Med | Content lossless; forms/bookmarks mostly kept; signatures invalidated |
| Fill and save forms | pdf.js AcroForm + JavaScript sandbox, `saveDocument` | @cantoo/pdf-lib `updateFieldAppearances(unicodeFont)`; flatten via pdf-lib/qpdf | Med | High for AcroForm; XFA partial |
| Encrypt, decrypt, repair, linearize | qpdf | @cantoo/pdf-lib `encrypt()` | Low | High |
| Print | pdf.js print service (raster; raise to 300 DPI) | PDFium high-DPI rendering | Med | Raster output; large jobs are slow |
| Create PDFs from other modules | LibreOffice `writer/calc/impress_pdf_Export` via UNO (tagged, bookmarks, optional PDF/A, Hybrid) | Images to PDF via `extractPages` image pages or pdf-lib | Low | High |
| OCR (later) | tesseract.js 7 + local tur/eng; `pdf` + `pdfTextOnly` layer + `qpdf --overlay` | OCRmyPDF (external, optional) | Med-High | Good on clean 300-DPI prints; weak on photos and low-resolution scans |

## Risks
- Editing existing text is fundamentally limited. Subset fonts lack the new glyphs and widths, text objects are per run or per line, and nothing reflows. A third-party report shows silent corruption at scale unless each edit is verified. Mitigation: glyph and width coverage check with fontkit, read-back of FPDFTextObj_GetText, render diff, fallback to overlay, and never overwrite the original.
- Turkish characters (ğ ş ı İ Ğ Ş) in pdf.js FreeText are saved without an appearance stream, and form values are saved with /NeedAppearances. The result is invisible or wrong in Chrome/Edge (PDFium) and breaks PDF/A. The upstream fix is Firefox-only, and qpdf --generate-appearances outputs '?'. We must ship our own appearance generator.
- pdf.js API churn: monthly releases, and 6.0 had breaking changes. Porting full-viewer internals (signature dialog, comment manager, page organizer) that are not in the components build adds maintenance work. Mitigation: pin versions, wrap pdf.js behind an adapter, add upgrade regression tests.
- Using several engines (pdf.js, PDFium, @cantoo/pdf-lib, qpdf) increases the number of save paths. Every full-rewrite path (extractPages, qpdf, non-incremental pdf-lib) drops earlier revisions and invalidates digital signatures. Detect signatures via getSignatures(), prefer incremental saves, and warn users.
- @cantoo/pdf-lib is a fast-moving fork with a small community, and EmbedPDF is single-vendor with a v3 rewrite in progress. Both carry regression and API-churn risk. Pin exact versions and keep golden-file tests.
- Offline and privacy: tesseract.js and EmbedPDF fetch from jsDelivr by default. Configure local workerPath/corePath/langPath and font sources, and block network access from renderers (CSP, session webRequest).
- The LibreOffice Draw route is lossy: per-line text boxes, font substitution with Arial fallback, flattened or lost annotations and forms, and loss of tags, bookmarks and signatures. Redistributing LibreOffice also redistributes the GPL Poppler-based xpdfimport, so source-offer obligations apply.
- License contamination: adding mupdf.js (AGPL-3.0) in-process would force AGPL on the combined app. Enforce a dependency-license allowlist in CI.
- Printing quality: the pdf.js viewer rasterizes at 150 DPI by default. Higher DPI costs memory and time; a vector-quality print path would need PDFium or OS-level printing.
- OCR accuracy for Turkish (ı/i, İ/I, ğ) varies with scan quality. WASM is slower than native. Text-layer misalignment can come from DPI, /Rotate or CropBox offsets. A Turkish evaluation corpus is needed.
- pdf.js ignores PDF permission flags by default (enablePermissions=false), and qpdf --decrypt removes restrictions. A product and legal policy decision is needed.
- Security: PDFs are untrusted input. Stay on current pdf.js (CVE-2024-4367 class bugs), run parsing in sandboxed renderers, a utility process or WASM, and keep native parsers (qpdf, xpdfimport) updated.
- Memory limits: pdf.js with `data` loads the whole file; PDFium and tesseract WASM are limited to 4 GB of 32-bit address space. Very large or scanned PDFs need range transport and page-at-a-time processing.
- Incremental saves grow files over time. An 'optimize/compact' rewrite (qpdf) is needed, with signature caveats.

## Recommendation
Adopt a layered, permissively licensed stack.

1. **pdf.js 6.3.x (pinned), using the components build** (PDFViewer, EventBus, FindController, LinkService, ScriptingManager) in a sandboxed renderer, driven by our own ribbon.
   - Use it for view, thumbnails, zoom, view-rotate, select, copy, search, highlight, ink, stamp/image, visual signature, comments and AcroForm filling.
   - Save with `saveDocument()` (incremental).
   - Use `extractPages()` for insert, delete, reorder, split and merge.
   - Enable the editor features explicitly, and port the Apache-2.0 signature dialog, comment sidebar and page organiser as needed.
2. **qpdf 12.4.x CLI**, bundling only the bin folder (~9.3 MB), called with `execFile` from main or a utility process.
   - Use it for `--check` after every write, repair on open failure, adding or removing a password (AES-256), `--linearize`, persistent `--rotate`, `--overlay` (OCR text layer) and batch page operations.
3. **@cantoo/pdf-lib 2.11.x + @cantoo/fontkit (pinned)**, in a utility process.
   - Write "Add text/image" as page content, using embedded subset OFL fonts (Liberation, Carlito, Noto/DejaVu, possibly reused from LibreOffice's bundled fonts).
   - Generate the missing FreeText and form-field appearances with a Unicode font as an incremental commit. This fixes the Turkish ğ/ş/ı/İ defect.
4. **@embedpdf/pdfium 2.15.x, low-level API only** (not the EmbedPDF viewer), in a worker or utility process.
   - Handle existing-object edits: Tier-1 in-place text edits, image replace/move/delete, object removal and flattening. Save with `FPDF_INCREMENTAL` where possible.
   - Use it as a second renderer in visual regression tests.
5. **LibreOffice** for creating PDFs from Writer, Calc and Impress (`*_pdf_Export` with UseTaggedPDF, ExportBookmarks, optional PDF/A, and IsAddStream for Hybrid).
   - Open Hybrid PDFs through `*_pdf_addstream_import` for lossless editing.
   - Offer `draw_pdf_import` only as an explicit "Convert to editable drawing (lossy)" command, with the original always kept.
6. **OCR phase:** tesseract.js 7 with local tur+eng best_int data.
   - Render pages at 300 DPI (pdf.js or PDFium), recognise with `pdf:true`, `pdfTextOnly:true` and `user_defined_dpi` set, then `qpdf --overlay` the text layer onto the untouched original pages.
   - Keep OCRmyPDF as an optional external integration for later.
7. **Reject:** MuPDF (AGPL), upstream pdf-lib (unmaintained) and the full EmbedPDF viewer for now (reassess when v3 is stable, if shapes or redaction become priorities).

**Save pipeline (for data integrity):** produce bytes, run `qpdf --check`, re-open with pdf.js, write a temp file in the same folder, atomic rename, keep a backup. Warn before any full rewrite of a signed file.

**Spikes, with acceptance criteria:**
- **(a)** A Turkish FreeText note and a form field filled in pdf.js, then fixed by pdf-lib, render identically in pdf.js and PDFium.
- **(b)** `extractPages` merging two form PDFs keeps fields and bookmarks, and `qpdf --check` is clean.
- **(c)** A PDFium in-place edit of a number or date in a Word-exported PDF succeeds when glyphs are present and correctly falls back to overlay when they are missing.
- **(d)** The OCR text layer lines up on rotated and cropped scans.
- **(e)** Power loss during save never corrupts the original.

Expect Acrobat-like paragraph editing of arbitrary PDFs to be out of reach. Present it as "correct text in place (limited)" plus "replace region".

## Facts
- [high] pdfjs-dist latest is 6.3.289, published 2026-08-29; license Apache-2.0; package main is build/pdf.mjs (ESM-only); engines node >=22.13.0 || >=24; optionalDependency @napi-rs/canvas ^1.0.0. (https://unpkg.com/pdfjs-dist@6.3.289/package.json ; https://registry.npmjs.org/pdfjs-dist)
- [high] pdf.js releases are monthly: v5.7.284 (2026-04-27), v6.0.227 (2026-05-30), v6.1.200 (2026-06-27), v6.2.108 (2026-07-28), v6.3.289 (2026-08-29). v6.0 had breaking API changes: getDocument() now requires a parameter object, PDFDocumentProxy.destroy was removed, and minimum browser versions were raised. (https://api.github.com/repos/mozilla/pdf.js/releases ; https://github.com/mozilla/pdf.js/releases/tag/v6.0.227)
- [high] In v6.3.289, AnnotationEditorType = FREETEXT, HIGHLIGHT, STAMP, INK, POPUP, SIGNATURE, COMMENT. There are no underline/strike-out, shape, redaction or standalone sticky-note editors. (https://github.com/mozilla/pdf.js/blob/v6.3.289/src/shared/util.js)
- [high] saveDocument() sends the annotation changes to the worker, which calls incrementalUpdate({originalData: stream.bytes, ...}). Edits are appended as an incremental update that reuses the same cross-reference type, keeps /Encrypt, and encrypts new objects with the document's key. (https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/worker.js ; https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/writer.js)
- [high] Saved annotation types: FreeText -> FreeText; Highlight -> Highlight (free-hand highlight -> Ink); Ink -> Ink; Stamp -> Stamp with an image XObject (+SMask); Signature -> Stamp annotation (visual only, not a cryptographic signature). Comments are written as /Contents plus /Popup on the annotation. (https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/annotation.js)
- [high] pdf.js builds new FreeText appearances with Helvetica/WinAnsiEncoding. If any line cannot be encoded, createNewAppearanceStream returns null and the annotation is saved without /AP. Turkish Ğ ğ İ ı Ş ş are not in WinAnsi (cp1252), so they trigger this. Reported as invisible in PDFium-based viewers. (https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/annotation.js ; https://github.com/mozilla/pdf.js/issues/20117)
- [high] For form text fields whose DA font cannot encode the value, pdf.js generates no appearance on save and sets /NeedAppearances instead (the code comment calls it 'the /NeedAppearances trick'). (https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/annotation.js)
- [high] PR #21858 (merged 2026-09-09, after 6.3.289) adds a printToPDF callback to saveDocument for FreeText appearances. The callback is compiled only into MOZCENTRAL/TESTING builds, not the generic pdfjs-dist build. (https://github.com/mozilla/pdf.js/pull/21858 ; https://github.com/mozilla/pdf.js/blob/master/src/display/api.js)
- [high] PDFDocumentProxy.extractPages(pageInfos) is available in the generic build and not gated. It builds a new PDF from pages of the current document, other PDFs (Uint8Array, prompts for a password) and ImageBitmap synthetic pages, with include/exclude ranges, pageIndices and insertAfter. It includes pending annotation edits. Pure XFA documents are not supported. (https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/api.js ; https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/worker.js)
- [medium] The pdf.js PDFEditor (about 3.1k lines) merges AcroForm fields, outlines/destinations, page labels, structure trees and embedded files. It copies each page's existing /Rotate but has no API to change it. It keeps encryption and the Info dictionary only when the output comes from a single source file. (https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/editor/pdf_editor.js)
- [high] Firefox 150 (2026-04-21) added reorder/copy/paste/delete/export of pages in its built-in PDF editor; Firefox 151 (2026-05-19) added merging multiple PDFs. (https://www.firefox.com/en-US/firefox/150.0/releasenotes/ ; https://www.firefox.com/en-US/firefox/151.0/releasenotes/)
- [high] In the generic viewer's AppOptions: enableComment is true only in unbuilt dev builds; enableSignatureEditor, enableSplitMerge and enableMerge are true only in dev/TESTING builds. So they are off by default outside Firefox and must be set explicitly. enablePermissions defaults to false (permission flags are ignored). printResolution defaults to 150 DPI. (https://github.com/mozilla/pdf.js/blob/v6.3.289/web/app_options.js ; https://github.com/mozilla/pdf.js/blob/v6.3.289/web/pdf_print_service.js)
- [medium] The components build (pdfjs-dist/web/pdf_viewer.mjs) exports PDFViewer, PDFFindController, PDFLinkService, PDFScriptingManager and others. PDFViewer has an annotationEditorMode setter and accepts commentManager/signatureManager, but those managers belong to the full viewer app and are not exported. (https://github.com/mozilla/pdf.js/blob/v6.3.289/web/pdf_viewer.js ; https://github.com/mozilla/pdf.js/blob/v6.3.289/web/pdf_viewer.component.js)
- [medium] pdf.js editors can deserialize existing FreeText/Highlight/Ink/Stamp annotations (annotationElementId), so annotations made by other apps can be modified or deleted. (https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/editor/freetext.js)
- [high] The loading task has an onPassword callback; getDocument takes password, enableXfa (default false in the API), cMapUrl, standardFontDataUrl, wasmUrl, iccUrl and a PDFDataRangeTransport range option. (https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/api.js)
- [high] pdf.js exposes getSignatures()/getSignatureData(id) (PKCS#7 plus signed byte ranges). Actual verification is wired only in Firefox (NSS); enableSignatureVerification is off in shipping generic builds. (https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/api.js ; https://github.com/mozilla/pdf.js/blob/v6.3.289/web/app_options.js)
- [high] pdfjs-dist/webpack.mjs sets GlobalWorkerOptions.workerPort = new Worker(new URL('./build/pdf.worker.mjs', import.meta.url), {type:'module'}). This is the pattern to copy in Electron with Vite/webpack. (https://unpkg.com/pdfjs-dist@6.3.289/webpack.mjs)
- [high] Official Node example: import getDocument from pdfjs-dist/legacy/build/pdf.mjs, render with pdfDocument.canvasFactory.create(w,h) (Node canvas via @napi-rs/canvas), then canvas.toBuffer('image/png'). (https://github.com/mozilla/pdf.js/blob/v6.3.289/examples/node/pdf2png/pdf2png.mjs)
- [high] @napi-rs/canvas 1.0.9 (2026-09-09) is MIT with a prebuilt win32-x64-msvc binary (~38 MB unpacked; test/dev only). It is an N-API module (ABI-stable across Node/Electron). (https://registry.npmjs.org/@napi-rs/canvas ; https://registry.npmjs.org/@napi-rs/canvas-win32-x64-msvc/1.0.9)
- [high] The pdfjs-dist package is 34.8 MB unpacked. The runtime subset is about 5-6 MB (pdf.min.mjs 0.46 MB, pdf.worker.min.mjs 1.27 MB, pdf_viewer.mjs 0.32 MB, cmaps 1.17 MB, standard_fonts 0.8 MB, wasm 1.55 MB). Bundled WASM licenses are permissive: PDFium JBIG2 BSD-3, OpenJPEG BSD-2, qcms MIT, ICC profiles CC0. The release zip with the full viewer is 6.34 MB. (https://unpkg.com/pdfjs-dist@6.3.289/?meta ; https://github.com/mozilla/pdf.js/releases/tag/v6.3.289)
- [high] The pdf.js viewer ships a Turkish localization (l10n/tr/viewer.ftl, e.g. 'İmza ekle', 'Yorum ekle'). The l10n files carry MPL-2.0 headers. (https://github.com/mozilla/pdf.js/blob/v6.3.289/l10n/tr/viewer.ftl)
- [low] pdf.js find makes searches case-insensitive with a RegExp 'i' flag plus NFD normalization. There is no Turkish-specific case folding, so ı/I and İ/i matching likely needs a custom normalizer (not tested). (https://github.com/mozilla/pdf.js/blob/v6.3.289/web/pdf_find_controller.js)
- [high] CVE-2024-4367 (arbitrary JavaScript execution while opening a malicious PDF, affecting Electron apps) was fixed in pdf.js 4.2.67. (https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq)
- [high] Upstream pdf-lib: latest 1.17.1 released 2021-11-06; last commit 2021-11-12; MIT. README: encrypted documents are not supported; standard fonts are WinAnsi-only (218 Latin characters); subsetting does not work for all fonts; form appearances default to Helvetica, so a custom font is needed for non-Latin text. (https://api.github.com/repos/Hopding/pdf-lib/releases ; https://github.com/Hopding/pdf-lib/blob/master/README.md)
- [high] @cantoo/pdf-lib 2.11.1 (2026-09-15, MIT) can: load encrypted PDFs with a password (decrypt); encrypt() with AES-256 R6 by default (AES-128/RC4 optional); do incremental updates (forIncrementalUpdate/commit); draw full SVG; extractContents; convertToPDFA; use @cantoo/fontkit (2.0.12). Its README says upstream-based signing placeholders lack incremental update, which invalidates earlier signatures. (https://github.com/cantoo-scribe/pdf-lib/blob/master/README.md ; https://registry.npmjs.org/@cantoo/pdf-lib)
- [high] @cantoo/pdf-lib is fast-moving: 2.8.4 (2026-08-16), 2.9.0-2.9.2, 2.11.0 (2026-09-11), 2.11.1 (2026-09-15). The repo has about 352 stars. (https://registry.npmjs.org/@cantoo/pdf-lib ; https://api.github.com/repos/cantoo-scribe/pdf-lib)
- [high] @pdfme/pdf-lib 6.2.1 (2026-09-26, MIT) is another maintained fork focused on bug fixes (fontkit v2 subsetting fix, rounded rectangles, cantoo drawSvg). (https://unpkg.com/@pdfme/pdf-lib@6.2.1/README.md)
- [high] qpdf 12.4.2 was released 2026-09-27 under Apache-2.0. The Windows msvc64 zip is 28.18 MB. The runtime bin folder is about 9.3 MB (qpdf30.dll 7.45 MB, qpdf.exe, MSVC runtime DLLs); zlib/jpeg/openssl are linked in via vcpkg. (https://github.com/qpdf/qpdf/releases/tag/v12.4.2 ; https://github.com/qpdf/qpdf/blob/main/README-windows.md)
- [high] qpdf CLI supports --decrypt, --encrypt (256-bit AES), --linearize, --pages, --split-pages, --rotate, --overlay/--underlay, --flatten-annotations, --generate-appearances, --check, --json, --password and xref reconstruction. It is not a renderer and does not understand content-stream semantics. (https://qpdf.readthedocs.io/en/stable/cli.html ; https://qpdf.readthedocs.io/en/stable/overview.html)
- [high] qpdf --generate-appearances turns text-field characters outside US-ASCII/WinAnsi/MacRoman into '?' and ignores multi-line/rich-text formatting, so it is unusable for Turkish fields. (https://qpdf.readthedocs.io/en/stable/cli.html)
- [medium] With qpdf --pages, document-level data (outlines, tags) comes from the primary input, bookmarks pointing to dropped pages break, and form-field handling is limited. (https://qpdf.readthedocs.io/en/stable/cli.html)
- [high] PDFium: FPDFText_SetText 'Set the text for a text object. If it had text, it will be replaced.' FPDFPage_GenerateContent must be called before saving or changes are lost. FPDF_SaveAsCopy flags are FPDF_INCREMENTAL, FPDF_NO_INCREMENTAL and FPDF_REMOVE_SECURITY. FPDF_MovePages and FPDF_ImportPagesByIndex exist. (https://github.com/chromium/pdfium/blob/main/public/fpdf_edit.h ; https://github.com/chromium/pdfium/blob/main/public/fpdf_save.h ; https://github.com/chromium/pdfium/blob/main/public/fpdf_ppo.h)
- [high] @embedpdf/pdfium 2.15.1 (2026-09-16, MIT wrapper; PDFium BSD-3 + Apache-2.0) ships a 4.65 MB wasm. It exports FPDFText_SetText, FPDFText_SetCharcodes, FPDFTextObj_GetFont, FPDFFont_GetFontData, FPDFText_LoadFont, FPDFPage_GenerateContent, FPDF_SaveAsCopy(doc,writer,flags), FPDFImageObj_SetBitmap, FPDFPage_RemoveObject, FPDFPage_SetRotation, FPDF_MovePages, FPDF_ImportPages, FPDFPage_Flatten and EPDF_SetEncryption. (https://unpkg.com/@embedpdf/pdfium@2.15.1/dist/vendor/functions.d.ts)
- [high] The EmbedPDF viewer on npm (2.15.1) is MIT (v2 branch). The main branch (v3, Apache-2.0 SDK; CloudPDF server under FCL) is 'not yet recommended for production'. The README lists annotations (highlight, sticky notes, free text, ink), true redaction, search, selection, zoom and rotation. (https://github.com/embedpdf/embed-pdf-viewer/blob/v2/LICENSE ; https://github.com/embedpdf/embed-pdf-viewer/blob/main/README.md ; https://github.com/embedpdf/embed-pdf-viewer/blob/main/LICENSING.md)
- [medium] The EmbedPDF v2 engine has methods for form fields, flattenPage, extractPages/importPages/merge/deletePage, setDocumentEncryption/removeEncryption, redactTextInRects/applyRedaction and saveAsCopy (custom PDFiumExt_SaveAsCopy). It has no method to edit existing page text. The v3 'page-edit' plugin covers page rotate/move/delete only. (https://github.com/embedpdf/embed-pdf-viewer/blob/v2/packages/engines/src/lib/pdfium/engine.ts ; https://github.com/embedpdf/embed-pdf-viewer/blob/main/packages/plugin/page-edit/package.json)
- [high] By default, EmbedPDF's browser font fallback loads @embedpdf/fonts-* from jsDelivr. Those font packages are OFL-1.1 and total about 157 MB unpacked (jp 31.8, kr 32.1, sc 42.0, tc 39.7, latin 11.5 MB). (https://github.com/embedpdf/embed-pdf-viewer/blob/v2/packages/engines/src/lib/pdfium/cdn-fonts.ts ; https://registry.npmjs.org/@embedpdf/fonts-sc/latest)
- [high] @hyzyla/pdfium 2.1.13 (2026-05-12, MIT, 4 MB wasm) is a mainly render/text-oriented wrapper for browser and Node. (https://unpkg.com/@hyzyla/pdfium@2.1.13/README.md)
- [medium] Third-party field report (MegaPDF #116): in-place FPDFText_SetText edits on 1,533 documents reported success but produced spread-out text (new glyphs had no widths), dropped characters (the encoding could not encode them) or wrong glyphs. Proposed fix: read the text back and fall back to a substituted font. (https://github.com/SlyWombat/MegaPDF/issues/116)
- [high] mupdf (MuPDF.js) 1.28.1 (2026-09-06) is AGPL-3.0-or-later with a 10.4 MB wasm. Its API covers annotations, applyRedactions (image/line-art/text options), graftPage/insertPage/deletePage/rearrangePages, save options (incremental, encrypt=aes-256), bake and a journalling undo. No method for editing existing text is documented. (https://unpkg.com/mupdf@1.28.1/package.json ; https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFDocument.html ; https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFPage.html)
- [high] Artifex states that AGPL use requires disclosing the full application source under the AGPL; a commercial licence removes this obligation. (https://artifex.com/licensing)
- [high] LibreOffice PDF import: Poppler parses the PDF inside a separate GPL 'xpdfimport' binary. It uses 'very simple heuristics for reassembling characters back into lines'. Clipping is wrong in cases where the PDF uses non-zero winding (LibreOffice uses even-odd). It depends on ToUnicode maps, and complex fills produce hundreds of objects. Inserting a PDF (as opposed to opening it) gives a non-editable rendered image. (https://github.com/LibreOffice/core/blob/master/sdext/source/pdfimport/README.md)
- [high] LibreOffice pdfimport reads an embedded font file only to identify family/weight/italic. Text is rendered with an installed font of that name, falling back to Arial. (https://github.com/LibreOffice/core/blob/master/sdext/source/pdfimport/wrapper/wrapper.cxx)
- [high] LibreOffice import filters are draw_pdf_import, impress_pdf_import and writer_pdf_import; Hybrid-PDF imports are writer_pdf_addstream_import and impress_pdf_addstream_import (HybridPDFImport). PDF export FilterData keys include IsAddStream (hybrid), SelectPdfVersion, PDFUACompliance, UseTaggedPDF, ExportNotes, ExportFormFields, EncryptFile, DocumentOpenPassword, ExportBookmarks and SignPDF. (https://github.com/LibreOffice/core/blob/master/sdext/source/pdfimport/config/pdf_import_filter.xcu ; https://github.com/LibreOffice/core/blob/master/filter/source/pdf/pdfexport.cxx)
- [high] Recent LibreOffice PDF-import changes: tiling patterns (24.8), clipping of stroke paths (25.2), import of encrypted hybrid PDFs (25.8). Release notes for 26.2/26.8 list no text-reconstruction improvements. (https://wiki.documentfoundation.org/ReleaseNotes/25.8 ; https://wiki.documentfoundation.org/ReleaseNotes/25.2 ; https://wiki.documentfoundation.org/ReleaseNotes/24.8)
- [medium] LibreOffice builds bundle OFL fonts (Carlito, Caladea, Liberation, DejaVu, Noto Sans). Liberation aims at layout compatibility with Times New Roman/Arial/Courier New; Carlito is metric-compatible with Calibri. Whether they are present in the Windows install is inferred. (https://github.com/LibreOffice/core/tree/master/external/more_fonts ; https://github.com/liberationfonts/liberation-fonts ; https://github.com/googlefonts/carlito)
- [high] tesseract.js 7.0.0 (2025-12-15, Apache-2.0) depends on tesseract.js-core ^7.0.0 (which adds relaxed-SIMD builds). LSTM-only wasm files are about 2.86 MB each (.wasm.js about 3.9 MB). tesseract.js-core 7.0.0 is 45 MB unpacked. (https://registry.npmjs.org/tesseract.js ; https://unpkg.com/tesseract.js-core@7.0.0/?meta)
- [high] tesseract.js output formats include text, blocks, hocr, tsv and pdf (via TessPDFRenderer, with a pdfTextOnly option); only text is on by default. (https://github.com/naptha/tesseract.js/blob/master/src/worker-script/utils/dump.js ; https://github.com/naptha/tesseract.js/blob/master/src/worker-script/constants/defaultOutput.js)
- [high] Tesseract's PDF renderer writes invisible text ('3 Tr') using GlyphLessFont, falls back to a compiled-in pdf_ttf if pdf.ttf is missing, and leaves out the page image when textonly is set. (https://github.com/tesseract-ocr/tesseract/blob/main/src/api/pdfrenderer.cpp)
- [high] tesseract.js by default downloads language data from jsDelivr (@tesseract.js-data/{lang}/4.0.0_best_int); offline use requires local workerPath/corePath/langPath. tur 4.0.0_best_int is 2.14 MB gz; the legacy+LSTM version is 8.06 MB gz. (https://github.com/naptha/tesseract.js/blob/master/src/worker-script/index.js ; https://data.jsdelivr.com/v1/packages/npm/@tesseract.js-data/tur@1.0.0?structure=flat ; https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md)
- [high] The tessdata, tessdata_best and tessdata_fast repos are Apache-2.0. tur.traineddata is 18.75 MB (tessdata), 7.46 MB (best) and 4.55 MB (fast). Best is most accurate but slower; fast is fastest but least accurate; only tessdata supports the legacy engine. (https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE ; https://tesseract-ocr.github.io/tessdoc/Data-Files.html)
- [high] Tesseract works best at 300 DPI or more; skew significantly degrades line segmentation; binarization, noise removal and borders affect accuracy. (https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html)
- [high] OCRmyPDF 17.13.0 (2026-09-28, MPL-2.0) requires Python 3.11+ and depends on pikepdf, pypdfium2 and others. Ghostscript has been optional since 17.0 (pypdfium2 rasterizer, internal PDF/A). On Windows it still needs native Tesseract, with Ghostscript recommended. (https://pypi.org/project/ocrmypdf/ ; https://ocrmypdf.readthedocs.io/en/latest/installation.html)
- [high] The latest Electron is 44.4.5 (2026-09-23), bundling Node 24.21.0 and Chrome 152. (https://releases.electronjs.org/releases.json)
- [high] Electron custom schemes should be registered with registerSchemesAsPrivileged (standard, secure, supportFetchAPI, ...); non-standard schemes cannot resolve relative URLs. protocol.handle serves responses. (https://www.electronjs.org/docs/latest/api/protocol)
- [medium] Optional native route with no C++ compiler: prebuilt PDFium binaries (bblanchon/pdfium-binaries, latest tag chromium/8066) could be called through koffi 3.3.2 (MIT FFI). (https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium/8066 ; https://registry.npmjs.org/koffi)
