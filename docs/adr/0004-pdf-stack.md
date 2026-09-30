# ADR 0004: PDF stack — pdf.js in the renderer, @cantoo/pdf-lib in the main process

- **Status:** Accepted for milestone M1 (v0.1), amended 2026-09-30 (implementation notes); later tools are planned,
  not decided in detail
- **Date:** 2026-09-28
- **Related:** [ARCHITECTURE.md](../ARCHITECTURE.md), [ADR 0005](0005-data-integrity.md),
  research: [pdf](../research/pdf.md), contracts: `src/shared/api/pdf.ts`, `src/main/pdf/types.ts`

## Context

The PDF module must view, search and select text, annotate (highlight, free text in Turkish, ink, image
stamp), fill AcroForms, rotate/delete/reorder/merge/extract pages, save, and create PDFs from the three office
modules — offline and with permissive licenses.

Findings (September 2026):

- **pdf.js 6.3.289** (Apache-2.0) renders at Firefox quality, has editors for FreeText, Highlight, Ink, Stamp,
  Signature (visual) and comments, fills AcroForms with a sandboxed JavaScript engine, and saves changes as an
  **incremental update** (the original bytes are kept, encryption is preserved). `extractPages()` merges,
  splits and reorders pages. It cannot edit existing page content.
- pdf.js saves **FreeText with Turkish letters (ğ ş ı İ Ğ Ş) without an appearance stream** (Helvetica/WinAnsi),
  so the text is invisible in PDFium-based viewers (Chrome, Edge); form values it cannot encode are saved with
  `/NeedAppearances`. The upstream fix is compiled only into Firefox.
- Upstream **pdf-lib** has been unmaintained since 2021; the fork **@cantoo/pdf-lib 2.11.1** (MIT) supports
  encrypted files, incremental updates, SVG and embedded Unicode fonts (with @cantoo/fontkit).
- **MuPDF.js** is AGPL-3.0; linking it would make the whole application AGPL.
- LibreOffice's PDF import converts pages into drawing shapes through a GPL helper (`xpdfimport`, Poppler);
  it is lossy and is not an editor for existing PDFs. LibreOffice's PDF **export** is good (tagged PDF,
  bookmarks, PDF/A, hybrid PDF).
- qpdf (Apache-2.0) is the reference for structure checks, repair, encryption and linearisation;
  PDFium (BSD/Apache, available as WebAssembly) can change existing text objects, but only small same-font
  corrections are safe.

## Decision

For v0.1:

- **Viewing and interaction:** pdf.js (pinned 6.3.289, components build) runs in the sandboxed renderer with
  `isEvalSupported: false`; file bytes are passed over IPC; cmaps, standard fonts, WASM and ICC data are served
  locally. The worker is created with `new Worker(new URL(...), { type: 'module' })`.
- **Annotations and forms:** pdf.js editors, saved with `saveDocument()` as an incremental update.
- **Page operations and writing new content:** `@cantoo/pdf-lib` 2.11.1 with `@cantoo/fontkit` in the main
  process (rotate, delete, reorder, merge, extract, add text/images with embedded Unicode fonts).
- **Creating PDFs from documents:** LibreOffice's `writer_pdf_Export` / `calc_pdf_Export` /
  `impress_pdf_Export` filters on the shared conversion instance.
- **Saving** goes through the safe-save pipeline of [ADR 0005](0005-data-integrity.md) (write to a temporary
  file, re-open to verify, atomic replace).
- **Not in v0.1:** editing existing PDF text, redaction, OCR, password add/remove, repair. Planned later:
  our own Unicode appearance streams for Turkish FreeText and form fields (M2), qpdf for structure checks,
  repair and passwords (M2), PDFium for small in-place text corrections (M4), tesseract.js OCR with local
  Turkish and English data (M4).

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| MuPDF.js | AGPL-3.0 would apply to the whole app; no API for editing existing text either |
| Upstream pdf-lib | Unmaintained since 2021; no encryption support |
| EmbedPDF viewer | Rewrites the whole file on save, fetches fonts from a CDN by default, v3 still pre-release |
| LibreOffice Draw PDF import as the editor | Lossy conversion (one text box per line, substituted fonts, lost forms and annotations); GPL helper |
| qpdf alone | Not a renderer or editor; useful as a helper later |

## Consequences

- Positive: permissive licenses only (Apache-2.0, MIT); incremental saves keep the original bytes and existing
  signatures' byte ranges intact.
- Negative: several libraries mean several save paths; any full rewrite (page operations) invalidates existing
  digital signatures, so Simpaper must detect signatures and warn before rewriting.
- Negative: until our own appearance generator exists, Turkish FreeText created in Simpaper may not display in
  Chrome/Edge (listed in [KNOWN_LIMITATIONS.md](../KNOWN_LIMITATIONS.md)).
- Negative: pdf.js ships monthly releases with occasional breaking changes; it is pinned and wrapped behind an
  adapter, and upgrades require the PDF regression tests.
- Security: PDFs are untrusted input; parsing happens in the sandboxed renderer with a pdf.js version newer
  than the fix for CVE-2024-4367.

## Amendment (2026-09-30): implementation notes

- pdf.js 6.3.289 no longer has the `isEvalSupported` option, so there is nothing to switch off; PDF scripting is not
  loaded at all (no scripting manager, QuickJS not bundled) and XFA is off (`enableXfa: false`). CMaps, standard fonts
  and WASM are served locally; no ICC profiles are shipped (`iccUrl` is unset). Details: [dev/pdf.md](../dev/pdf.md).
- Simpaper's own Unicode appearance streams for Turkish FreeText and form values were implemented in M1
  (`src/main/pdf/appearance.ts`), not in M2, so the Chrome/Edge consequence above no longer applies to files saved
  by Simpaper.
