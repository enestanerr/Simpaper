# Screenshots

Real screenshots of the running application, captured as described in [docs/DEMO.md](../DEMO.md) with
`node scripts/gui/screenshots.mjs` (packaged app, window 1600 × 1000 at 100 % scaling, light theme unless noted,
sample documents from `tests/corpus/generated/` copied to `C:\Users\Public\Documents`). Only Simpaper's own window is
captured, and every image was reviewed before it was added. No image in this repository is a mock-up or retouched.

The images were captured before the product was renamed from its working name "Varak" to Simpaper
([ADR 0009](../adr/0009-product-name-simpaper.md)). They still show "Varak" in the title bar, in the text of some
sample documents ("Varak Test Belgesi") and in the recent-file paths of the backstage shots, and will be replaced by
a new run of `node scripts/gui/screenshots.mjs --lang both`.

| File | Content | Language | Captured on | Build | Windows |
|---|---|---|---|---|---|
| `writer-home-tr.png` | DOCX with Turkish text, table, image, comment and tracked change; Home tab | Turkish | 2026-09-29 | 0.1.0 (before the first commit) | 11 Pro 26200 |
| `writer-home-en.png` | The same document with the English interface | English | 2026-09-29 | 0.1.0 | 11 Pro 26200 |
| `calc-formulas-tr.png` | XLSX, second sheet, `DÜŞEYARA` formula in the formula bar | Turkish | 2026-09-29 | 0.1.0 | 11 Pro 26200 |
| `calc-formulas-en.png` | The same cell as `VLOOKUP`, English number formats | English | 2026-09-29 | 0.1.0 | 11 Pro 26200 |
| `impress-slides-tr.png` | PPTX with the slide pane, second slide selected | Turkish | 2026-09-29 | 0.1.0 | 11 Pro 26200 |
| `impress-slides-en.png` | The same presentation with the English interface | English | 2026-09-29 | 0.1.0 | 11 Pro 26200 |
| `pdf-annotate-tr.png` | PDF with a highlight, a free-text note and page thumbnails; Annotate tab | Turkish | 2026-09-29 | 0.1.0 | 11 Pro 26200 |
| `pdf-annotate-en.png` | The same annotations with the English interface | English | 2026-09-29 | 0.1.0 | 11 Pro 26200 |
| `backstage-open-tr.png` | File backstage, Open page with the recent sample files | Turkish | 2026-09-29 | 0.1.0 | 11 Pro 26200 |
| `backstage-open-en.png` | The same page with the English interface | English | 2026-09-29 | 0.1.0 | 11 Pro 26200 |
| `loss-warning-tr.png` | "Some content may not be preserved" warning with "Save a copy" (Ctrl+S on a .doc) | Turkish | 2026-09-29 | 0.1.0 | 11 Pro 26200 |
| `loss-warning-en.png` | The same warning with the English interface | English | 2026-09-29 | 0.1.0 | 11 Pro 26200 |
| `theme-dark-en.png` | The documents module in the dark theme | English | 2026-09-29 | 0.1.0 | 11 Pro 26200 |
