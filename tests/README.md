# Tests

How Varak is tested, the ground rules and what is (not) verified are described in
[docs/TESTING.md](../docs/TESTING.md). This file explains the layout of `tests/`, the test corpus and the
verification tools. Developer notes with measurements and findings: [docs/dev/testing-corpus.md](../docs/dev/testing-corpus.md).

## Layout

| Path | What it contains | Runs with |
|---|---|---|
| `unit/` | Fast tests without LibreOffice (`unit/tools` tests the verification tools themselves; other folders belong to the app modules) | `npm test` (Vitest project `unit`) |
| `engine/` | Tests with a real, headless LibreOffice: `lifecycle.test.ts` (engine bridge), `independent.test.ts` (round trips checked by independent readers), `visual.test.ts` (rendered pages compared pixel by pixel) | `npm run test:engine` (Vitest project `engine`) |
| `tools/` | Independent verification tools shared by the tests (below) | imported by tests |
| `corpus/generated/` | Deterministic fixtures written by the generator (git-ignored, regenerated on demand) | — |
| `corpus/third_party/` | Unmodified, licence-clean files from other projects, pinned by URL and SHA-256 | — |

Scratch output (engine profiles, converted files, renders) goes to `test-output/` (git-ignored). Diff images of
failing visual comparisons are kept in `test-output/visual/`.

## Running

```powershell
npm test                                                        # all unit tests
npx vitest run --project unit tests/unit/tools                  # only the tool tests (~3 s)
npm run test:engine                                             # all engine tests (need the engine)
npx vitest run --project engine tests/engine/independent.test.ts tests/engine/visual.test.ts
node scripts/corpus/third-party.mjs                             # verify the vendored corpus offline
```

Engine tests need LibreOffice: `vendor/libreoffice` (`npm run engine:fetch`) or `VARAK_ENGINE_DIR` pointing to a
LibreOffice installation or its `program` folder. Without an engine they are skipped, not failed. They never open
windows. The corpus suites (`independent`, `visual`) run LibreOffice with `--headless --invisible`, each runner
with its own profile under `test-output/corpus/soffice/`, and kill the whole process tree of everything they
start; every engine suite ends with a test that no process it started is left.

### Which test uses what

| Test | Corpus files / subject |
|---|---|
| `unit/tools/generator.test.ts` | Generator: two runs give identical bytes and parts; expectation helpers (Excel serial dates, tr-TR/en-US number formatting, CSV quoting) |
| `unit/tools/ooxml.test.ts` | OOXML readers on `docx-basic`, `pptx-basic`, `xlsx-basic` against the manifest facts; synthetic edge cases (deleted text, text boxes, `mc:AlternateContent`) |
| `unit/tools/odf.test.ts`, `opc.test.ts`, `visual.test.ts`, `soffice.test.ts` | ODF readers, package patching, pixel comparison and the runner's command line/profile, on synthetic data (no LibreOffice) |
| `unit/tools/pdf.test.ts` | `pdf-text`, `pdf-form`, `pdf-encrypted`, `pdf-scanned`; the Acrobat form `pdfbox-acroform`; a pdf-lib fill-and-save round trip |
| `unit/tools/cfb-vba-text.test.ts` | POI `SimpleMacro.docm/.xlsm/.pptm` (VBA projects), `SampleDoc.doc`, the encrypted DOCX/XLSX, `SmartArt.pptx`; the [MS-OVBA] decompression example |
| `unit/tools/third-party.test.ts` | Provenance of `corpus/third_party` (hashes, pinned URLs and licences, generated docs in sync) |
| `engine/independent.test.ts` | Round trips of `docx-basic`, `xlsx-basic` (en-US and tr-TR profiles) and `pptx-basic`; all derived formats; every POI sample |
| `engine/visual.test.ts` | `docx-basic`/`docx-changed`, `pptx-basic`/`pptx-changed`, `xlsx-basic` |

## The corpus

### Generated files (`corpus/generated/`, CC0-1.0)

Written by `npm run corpus:generate` (`scripts/corpus/generate.mjs`); tests call `ensureGeneratedCorpus()`, which
generates the files when they are missing or were written by an older generator version. The generator is
deterministic (fixed timestamps, seeded randomness; `tests/unit/tools/generator.test.ts` proves byte-reproducible
output) except for the encrypted PDF (random salts) and the LibreOffice-derived files. Every file is listed in
`manifest.json` with its size, SHA-256, features and **facts**: the expected content, computed in JavaScript from
the same source data, never read from LibreOffice output.

| Id (file) | What it exercises |
|---|---|
| `docx-basic` (`docx-basic.docx`) | Two A4 pages with 2.5 cm margins; heading styles 1–3; Turkish text (dotted/dotless i, pangrams); bold/italic/underline runs; a table with a header row; a 320×200 PNG with alt text; header and footer with PAGE/NUMPAGES fields; a comment; a tracked insertion; a hyperlink; a bulleted list; document language tr-TR |
| `docx-changed` | `docx-basic` with one word changed (proves visual comparisons see a one-word change) |
| `pptx-basic` (`pptx-basic.pptx`) | Three 16:9 slides from one master with three layouts: title slide, two-level bullets, picture and table; speaker notes on every slide; Turkish text |
| `pptx-changed` | `pptx-basic` with one word of the last bullet changed |
| `xlsx-basic` (`xlsx-basic.xlsx`) | Sheets Veriler/Hesaplar/Biçimler: typed data; number formats (decimal, thousands, percent, scientific, date, time, Turkish lira and US dollar currency, text, fraction); 21 formulas (SUM, AVERAGE, IF, VLOOKUP, INDEX/MATCH, DATE, TEXT, COUNTIF, ROUND, IFERROR, MOD, AND, UPPER, CONCATENATE, a defined name, cross-sheet and absolute references) written **without cached results** except one deliberately stale cached value; merged cells, borders, list data validation, conditional formatting, frozen panes |
| `pdf-text` | Three pages of Turkish text in an embedded Unicode font (DejaVu Sans from the engine image), document metadata |
| `pdf-form` | AcroForm with two text fields, a check box and a drop-down, Turkish values |
| `pdf-encrypted` | AES-256 encrypted PDF (user password `varak123`) |
| `pdf-scanned` | Image-only page (JPEG) without a text layer |
| `large-xlsx`, `large-docx`, `large-pptx` | Only with `--large`: 100,000 rows, 300 pages, 200 slides (performance; never committed) |
| `*-odt`, `*-doc`, `*-rtf`, `*-txt`, `*-dotx`, `*-ods`, `*-xls`, `*-csv-tr`, `*-csv-en`, `*-tsv-en`, `*-xltx`, `*-odp`, `*-ppt`, `*-potx`, `*-ppsx` (`derived/`) | Derived by headless LibreOffice from the three OOXML files (ODF, legacy binary, RTF, UTF-8 text, templates, slide show, CSV/TSV in a Turkish and an English profile); written only when an engine is available, checked by `engine/independent.test.ts` |

Regenerate by hand with `npm run corpus:generate` (options: `--no-derived`, `--derived`, `--large`,
`--out <dir>`, `--engine <programDir>`). Bump `GENERATOR_VERSION` in `scripts/corpus/lib/constants.mjs` whenever
generated content changes, so cached corpora are rebuilt.

The generated files are self-authored and dedicated to the public domain (CC0-1.0). The PDFs embed a subset of
the Unicode font found by `scripts/corpus/lib/fonts.mjs` (DejaVu Sans from the engine image first; system fonts
only as a fallback); generated files are never committed.

### Third-party files (`corpus/third_party/<source>/`)

Unmodified copies of permissively licensed files from Apache POI and Apache PDFBox (both Apache-2.0), each source
folder with the upstream `LICENSE`/`NOTICE` files and an `ATTRIBUTION.md` listing every file with its pinned
source URL (repository commit), licence, the application that produced it and what it exercises. The list lives
in `scripts/corpus/third-party.mjs`:

- `node scripts/corpus/third-party.mjs` — verifies offline: SHA-256 of every sample and licence file, no
  unpinned file in the folders, `manifest.json` and `ATTRIBUTION.md` in sync (also run by
  `unit/tools/third-party.test.ts`);
- `--fetch` downloads missing files from the pinned URLs and checks their hashes;
- `--docs` rewrites `manifest.json` and the `ATTRIBUTION.md` files.

Rules for adding files (licence, provenance, no personal data, prefer generating): [docs/TESTING.md](../docs/TESTING.md#adding-corpus-files)
and [corpus/README.md](corpus/README.md).

## Verification tools (`tools/`)

None of these readers uses LibreOffice, so a round trip is never checked only by the engine that produced it.

| Module | Purpose |
|---|---|
| `paths.ts` | Well-known folders (corpus, `test-output/corpus`, `test-output/visual`) |
| `corpus.ts` | `ensureGeneratedCorpus()`: generated corpus + typed facts from the manifest (cross-process lock for parallel workers) |
| `soffice.ts` | Typed facade over the headless runner `scripts/corpus/lib/soffice.mjs`: conversions, round trips, PDF export with lossless images and embedded fonts, per-runner profile, timeouts, process-tree cleanup, leftover detection |
| `xml.ts` | Namespace-aware XML tree (fast-xml-parser), single-pass entity decoding |
| `opc.ts` | OPC packages: parts, content types, relationships; `patchPackage` builds modified copies (used for the expected state of documented engine changes) |
| `ooxml.ts` | DOCX (paragraphs, effective run formatting, tables, headers/footers, fields, comments, revisions, hyperlinks, pictures, sections), PPTX (slides, placeholders, bullet levels, notes, pictures, tables) and XLSX via exceljs (values, formulas, cached results, number formats, merges, panes, validations, conditional formats, defined names) |
| `odf.ts` | ODT/ODS/ODP text, cells with typed values and formulas, slides and notes |
| `pdf.ts` | pdf.js (legacy build): text per page, page sizes, metadata, form widgets with their kind; rendering to PNG through @napi-rs/canvas |
| `visual.ts` | pixelmatch comparison with page ratio, densest 32×32 window and bounds of differences; diff images for failures |
| `cfb.ts` | Read-only compound-file ([MS-CFB]) reader |
| `vba.ts` | VBA projects ([MS-OVBA]): decompression, project name, modules with type and source, PROJECT-stream declarations |
| `text.ts` | BOM-aware text decoding, minimal RTF text extraction, container sniffing, encrypted-OOXML detection |
