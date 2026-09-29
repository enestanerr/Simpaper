# Pure JavaScript/TypeScript OOXML editor engines (DOCX/XLSX/PPTX) as a replacement for LibreOffice, state as of 2026-09-28

> Research notes of 2026-09-28 on pure JavaScript/TypeScript OOXML editors, prepared before the architecture decision and published
> with details about the research machine removed. Findings age quickly: check the linked sources before relying
> on a version number, a price, a bug status or a release date. Decisions are recorded in [docs/adr](../adr/README.md).

## Summary
**Verdict (2026-09-28): No.** No pure JS/TS engine, alone or combined, reaches LibreOffice-level open → edit → save coverage for DOCX, XLSX and PPTX. The best JS editors fall short in one of three ways:
- They handle DOCX only, and their current engines are only months old.
- They keep the key OOXML features in proprietary "Pro" packages.
- They rebuild the file from their own model on save, so anything they do not model is lost.

Keep LibreOffice as the engine. Use JS libraries around it for verification and compatibility analysis, never in the user's save path.

**Documents**
- **SuperDoc** (AGPL-3.0, commercial license also offered) is the strongest open option.
  - Its v2 engine replaces the old ProseMirror model with an OOXML-backed one and a paginating layout engine. It writes edits back into the package without going through HTML, and needs no server.
  - It supports tracked changes, comments, headers/footers, tables, TOC and footnote operations, and Yjs collaboration.
  - v2 is only weeks old: core v1.46.1 shipped on 2026-08-05.
  - Open bugs include page freezes on large documents and tables of contents (#3900), an undeclared w15 namespace written on export (#4031), and layout errors (#4040).
  - The maintainers say browser PDF export is not in the supported package.
  - Shipping it would make our whole distributed app AGPL.
- **Eigenpal docx-editor**: the core is Apache-2.0, but tracked changes, comments, collaboration and PDF are in the proprietary "EigenPal Pro" packages. The repo was created in 2026-07.
  - Its own matrix of 100 features: 28 fully editable, 32 partly, 39 not editable. The non-editable ones include charts, SmartArt, text boxes, shapes, OMML equations and cell merge/split.
  - It does preserve XML it does not model.
- The rest are not editors:
  - **docx** only creates files; its patcher only swaps placeholders.
  - **mammoth** converts DOCX to HTML and drops styling.
  - **docx-preview** renders HTML without real-time pagination and without fields or TOC.
  - **CKEditor 5** pagination and Word import/export, and **Tiptap** Pages/Conversion, are paid and go through vendor conversion services.
  - **Syncfusion** is commercial and needs an ASP.NET server to convert DOCX↔SFDT.

**Spreadsheets**
- **Univer**: the core is Apache-2.0, and 1.0 shipped on 2026-09-03.
  - It has a good open-source grid and formula engine.
  - XLSX import/export, printing, charts, pivot tables, sparklines, outlines and shapes are all Univer Pro, which is proprietary and needs a conversion backend.
  - New Pro purchases and trials are currently paused.
  - So the open-source part cannot open or save a real .xlsx.
- **FortuneSheet** (MIT, last release v1.0.4 in 2025-11): charts, pivot tables and print are unfinished.
  - XLSX support comes from FortuneExcel, a small third-party plugin (36★) built on ExcelJS 4.4.0.
- **Luckysheet** is archived. **x-spreadsheet** has moved to another project and is stale.
- **jspreadsheet CE** cannot parse XLSX; that is in its Pro version. **Handsontable** is proprietary.
- Formula engines:
  - **HyperFormula** is the only serious headless one: about 400 functions, GPL-3.0-only or commercial, v3.4.0 released 2026-08-10.
  - **formula.js** only implements individual functions.
  - **fast-formula-parser** has not been released since 2020.
- XLSX I/O libraries are not editors either:
  - **ExcelJS**: last release in Oct 2023 and the maintainer is inactive. Reading a file and writing it back drops its charts (#1734).
  - **SheetJS CE** 0.20.3 is only on cdn.sheetjs.com. The npm version, 0.18.5, carries CVE-2023-30533 and CVE-2024-22363.
  - Styling, images, charts and "update data in a file with perfect fidelity" are SheetJS Pro features.

**Presentations**
- **PptxGenJS** only creates files.
- **PPTXjs** (no activity since 2022) and **pptx-preview** are viewers.
- **pptxtojson** parses to JSON at "roughly 80%+" fidelity.
- **PPTist** (AGPL-3.0, or a paid license) is a real editor, but it works on its own JSON model.
  - It self-reports about 85% import and 95% export fidelity.
  - Export goes through pptxgenjs, so the file is rebuilt and anything not modeled is likely lost (inference).
- **pptx-viewer** (Apache-2.0, one maintainer, started 2026-03) and **@office-kit/pptx** (0.x) claim edit and save, but neither is proven.

**Hybrid options (not pure JS)**
- ONLYOFFICE's JS editors reach high fidelity only because a C++ converter (x2t, which can also be built for WASM) maps OOXML to their internal binary format.
  - License is AGPL-3.0 with extra terms, and there was a public fork/license dispute in 2026.
- LibreOffice compiled to WASM (ZetaOffice) and LibreOfficeKit tiled rendering (the JS front-end used by Collabora Online) put a web UI on the same LibreOffice core. They are the fallback if native window embedding proves fragile.

**Where JS pays off in our design**
1. **Round-trip package diff:** JSZip/fflate plus fast-xml-parser/@xmldom (all MIT) compare parts, relationships, content types and namespaces before and after a LibreOffice save. The diff flags dropped content: comment extensions, customXml, vbaProject, embeddings, SmartArt data, cx: charts, slicers, w14/w15 markup.
2. **Pre-open feature scanner:** warns the user when a file contains things LibreOffice cannot edit faithfully.
3. **Independent value checks:** read cached values and formulas back from LibreOffice-saved XLSX with SheetJS CE (vendored) or @office-kit/xlsx. HyperFormula (dev-only because of GPL) or formula.js can serve as a formula oracle.
4. **Test fixture generation:** docx, PptxGenJS, ExcelJS.
5. **Semantic text diffs:** mammoth, pptxtojson.
6. **Open XML SDK validation in CI:** this checks schema validity only; it does not prove Office will open the file.

## Tables
### A. OOXML editing capability by candidate (as of 2026-09-28)

| Candidate | Format | License | Status | Open | Display | Edit | Recalc | Save / round-trip | Can replace LibreOffice? |
|---|---|---|---|---|---|---|---|---|---|
| SuperDoc v2 | DOCX | AGPL-3.0 (+ commercial) | npm 2.18.0; v2 core since ~Aug 2026; ~1.1k★ | Yes (OOXML model) | Paginated DOM; headers/footers, sections, tables; OMML rendering and chart rendering (in progress) added 2026 | Text, tables, tracked changes, comments, TOC and footnote operations, Yjs | Fields: partial (TOC operations; bugs) | Writes back into the original package; no official PDF export; validity bug #4031 | No (DOCX only, young, AGPL) |
| Eigenpal docx-editor | DOCX | Apache-2.0 core; tracked changes, comments, collaboration and PDF are proprietary Pro | 2.23.0; repo created 2026-07 | Yes | Paginated; charts and text boxes shown as placeholders or partially | 28 of 100 features fully editable, 32 partial, 39 not editable | TOC refresh updates page numbers only | Keeps unmodeled XML | No |
| docx (npm) | DOCX | MIT | 9.8.1 | No (patcher only fills placeholders) | No | No | No | Generates new files | No; useful for fixtures |
| mammoth | DOCX | BSD-2-Clause | 1.13.0 | Yes (semantic) | HTML; styling ignored | No | No | No | No; useful for text extraction |
| docx-preview | DOCX | Apache-2.0 | 0.4.1 | Yes | HTML; no real-time pagination; no fields/TOC | No | No | No | No; preview only |
| CKEditor 5 / Tiptap (paid tiers) | DOCX | GPL or commercial; paid Pro | Pagination and Word conversion are paid | Through vendor conversion service | HTML model | Yes (HTML) | No | Through vendor service | No (offline and OSI conflicts) |
| Syncfusion DocumentEditor | DOCX | Commercial (Community License) | – | Through ASP.NET server (DOCX→SFDT) | Yes | Yes | Partial | Through server | No (not OSI) |
| ONLYOFFICE sdkjs + x2t | DOCX/XLSX/PPTX | AGPL-3.0 + §7 terms | Mature | Through C++ x2t (native or WASM) | High | High | Yes | Through x2t | Not pure JS; needs its own licensing decision |
| Univer (open-source part) | XLSX | Apache-2.0 (Pro is proprietary) | 1.0.2; 21k★ | XLSX import is Pro and needs a backend | Canvas grid | Cells, CF, DV, filters, comments, drawings | Yes (formula engine) | XLSX export, charts, pivot and print are Pro; Pro sales paused | No |
| FortuneSheet + FortuneExcel | XLSX | MIT | v1.0.4 (2025-11); plugin 36★ | Through ExcelJS | Canvas | Yes, but no charts, pivot or print | Basic | Through ExcelJS (file regenerated) | No |
| Luckysheet / x-spreadsheet | XLSX | MIT | Archived / migrated and stale | – | – | – | – | – | No |
| jspreadsheet CE | Grid | MIT | 5.0.4 | CE cannot parse XLSX (Pro feature) | Yes | Yes | Basic | Pro | No |
| Handsontable | Grid | Proprietary | 18.1.1 | – | – | – | – | – | Not OSI |
| HyperFormula | Formula engine | GPL-3.0-only or commercial | 3.4.0 (2026-08-10) | No file I/O | No UI | Through API | ~400 functions | – | Engine only; usable as a test oracle |
| formula.js / fast-formula-parser | Functions / parser | MIT | 4.6.1 / 1.0.19 (2020) | – | – | – | Functions only / 280 functions | – | Helpers only |
| ExcelJS | XLSX I/O | MIT | 4.4.0 (2023-10); dormant | Yes | – | Programmatic | No | Regenerates file; drops charts (#1734) | No; tests only |
| SheetJS CE | XLSX I/O | Apache-2.0 | 0.20.3 on CDN only; npm 0.18.5 has CVEs | Yes (data) | – | Programmatic | No | Data level; styles, images, charts and fidelity editing are Pro | No; tests only |
| IronCalc | Formula engine | MIT / Apache-2.0 | 0.8.x, work in progress; WASM build has no XLSX I/O | In Rust | Preview app | – | Yes | In Rust | Watch list |
| @office-kit/xlsx | XLSX I/O | MIT | 0.23.0; first published 2026-07 | Yes | – | Programmatic | No | Passes unknown parts through | Watch list / tests |
| PptxGenJS | PPTX | MIT | 4.0.1 | No | No | No | – | New files only | No; fixtures |
| PPTXjs / pptx-preview | PPTX | MIT / ISC (no public repo) | Stale since 2022 / 1.0.7 | Yes | HTML | No | – | No | Preview only |
| pptxtojson | PPTX | MIT | Active | Yes, to JSON (~80%+ fidelity) | – | – | – | No | Parsing only |
| PPTist | PPTX | AGPL-3.0 (paid alternative) | Active; 9.4k★ | ~85%+ (self-reported) | Yes | Yes (own JSON model) | – | Rebuilt with pptxgenjs (~95%+ claimed) | No |
| pptx-viewer / @office-kit/pptx | PPTX | Apache-2.0 / MIT | New in 2026; few users | Claimed / yes | CSS-based / separate preview package | Claimed / programmatic | – | Claimed / keeps unknown parts | Watch list |

### B. Where JS fits in the LibreOffice-based architecture (tests and analysis only, not the save path)

| Role | Libraries | License note | Caveat |
|---|---|---|---|
| Package diff before/after a LibreOffice round-trip (parts, rels, content types, mc:Ignorable, namespaces) | JSZip or fflate + fast-xml-parser or @xmldom/xmldom | MIT (JSZip is MIT OR GPL-3.0+) | Detects structural loss, not visual differences |
| Pre-open compatibility scanner (SmartArt, cx: charts, VBA, OLE, content controls, slicers, pivot caches, w14/w15) | Same | MIT | The mapping from feature to LibreOffice support must come from our own corpus tests |
| Reading back values and formulas from LibreOffice-saved XLSX | SheetJS CE 0.20.3 (vendored tarball + checksum), @office-kit/xlsx | Apache-2.0 / MIT | Read-only; do not ship npm xlsx 0.18.5 |
| Formula oracle | HyperFormula, formula.js | GPL-3.0-only (keep dev-only) / MIT | Edge-case semantics differ between engines (inference) |
| Test fixture generation | docx, PptxGenJS, ExcelJS or a maintained fork | MIT | Synthetic files; supplement with a real-world corpus kept outside the repo |
| Semantic text and structure diff | mammoth, pptxtojson | BSD-2-Clause / MIT | Lossy by design |
| Schema validation in CI | Open XML SDK through @xarsh/ooxml-validator or a small dotnet tool | MIT | Low-adoption wrapper; a valid file is not guaranteed to open in Office |
| Quick thumbnails | docx-preview, pptx-preview | Apache-2.0 / ISC | Lossy; prefer LibreOffice-rendered thumbnails or docProps/thumbnail |

## Risks
- Fidelity and data-integrity regression: pure-JS editors cannot edit charts, SmartArt, text boxes, shapes or equations (Eigenpal's own matrix: 39 of 100 features not editable). Libraries that regenerate files drop what they do not model (ExcelJS loses charts after read→write, issue #1734; PPTist export is rebuilt with pptxgenjs, which is inference). Both conflict with priorities #1 and #2.
- Copyleft spread: SuperDoc and PPTist are AGPL-3.0, HyperFormula is GPL-3.0-only, ONLYOFFICE is AGPL-3.0 with extra terms. Shipping any of them decides the license of the whole app. Keep them dev-only unless the project deliberately chooses (A)GPL.
- Open-core instability: new Univer Pro purchases and trials are paused. SuperDoc moved PDF export work to an internal repo. Eigenpal keeps tracked changes and comments in proprietary Pro packages. Key features can stay or move behind paywalls.
- Maintenance: ExcelJS has had no release since 2023-10 and its maintainer is inactive. SheetJS on npm is stale and vulnerable. fast-formula-parser (2020), Luckysheet (archived), x-spreadsheet (migrated) and PPTXjs (2022) are abandoned. Most 2026 entrants are single-maintainer or less than six months old.
- Supply chain: SheetJS CE must come from a cdn.sheetjs.com tarball; vendor it with an integrity hash. The npm 'xlsx' 0.18.5 carries CVE-2023-30533 and CVE-2024-22363.
- No public apples-to-apples fidelity data compares LibreOffice with JS engines: neurotic_docx_bench does not score LibreOffice. LibreOffice's own OOXML fidelity is imperfect, so we must measure it with our own corpus harness and should not assume parity with Microsoft Office.
- Test-corpus copyright: docx-corpus files come from Common Crawl and have a takedown process. Do not commit third-party documents to the public GitHub repo; keep large corpora outside the repository or in CI caches.
- Validator wrappers such as @xarsh/ooxml-validator and @ooxml-tools/validate have very little adoption, and schema validity does not guarantee Office will open the file.
- Any hybrid WASM route (ONLYOFFICE x2t-wasm, LibreOffice WASM/ZetaOffice) is not pure JS and brings its own licensing, bundle-size and performance trade-offs that this research did not evaluate in depth.

## Recommendation
Keep unmodified, bundled LibreOffice as the open/edit/save engine for DOCX, XLSX and PPTX. Do not adopt a pure-JS editor as a replacement: none reaches LibreOffice-level breadth today.
- **DOCX:** the best candidates are young and DOCX-only. SuperDoc is AGPL and its v2 engine is weeks old; Eigenpal leaves 39 of 100 features uneditable and keeps review features in a proprietary Pro package.
- **XLSX:** no OSI-licensed JS stack opens and saves XLSX natively with charts, pivot tables and print.
- **PPTX:** no robust open JS editor exists.

Use JS only for the Electron shell/UI and for a verification harness:
1. **Test tool.** Build a Node/TS inspector (fflate or JSZip plus fast-xml-parser, all MIT). It should do two things: diff packages before and after a LibreOffice round-trip, and power a pre-open feature scanner that warns about content LibreOffice cannot edit faithfully.
2. **XLSX read-back.** Read values and formulas back with SheetJS CE 0.20.3, vendored with a checksum, or @office-kit/xlsx. Use HyperFormula or formula.js only as dev-only oracles, so no GPL code ships.
3. **Fixtures.** Generate feature-targeted test files with docx, PptxGenJS and ExcelJS (or a maintained fork). Keep any real-world corpus outside the public repo.
4. **Validation.** Run Open XML SDK validation in CI.
5. **Save path.** Never let ExcelJS, SheetJS, PPTist or similar libraries touch a user's file on save.

Choose the project's OSI license with the dependency licenses in mind: permissive or MPL-2.0 means no AGPL/GPL components in the shipped bundle.

Re-evaluate in 6–12 months:
- SuperDoc v2, but only if an AGPL app is acceptable.
- Eigenpal's Apache-2.0 core.
- Univer, if XLSX I/O ever becomes open source.
- IronCalc and office-kit.

If embedding the LibreOffice window through UNO/createSystemChild proves fragile, the fallback is still LibreOffice-based: LibreOfficeKit tiled rendering as Collabora does, or LibreOffice WASM. It is not a JS editor.

## Facts
- [high] SuperDoc is licensed AGPL-3.0 (npm license field; LICENSE is GNU AGPL v3); README: 'AGPLv3 for open source use. A commercial license is available for proprietary deployments.' Latest npm version 2.18.0; GitHub release v2.18.0 dated Sep 25 (2026). (https://registry.npmjs.org/superdoc/latest)
- [high] SuperDoc v2 reads, renders, edits and writes DOCX through its OOXML parts: a layout engine paginates the state and a browser painter projects the pages into the DOM. Changes are written back into the OOXML package rather than rebuilt from HTML ('the DOM is an output, not the document format'). (https://docs.superdoc.dev/resources/how-superdoc-works/)
- [high] The SuperDoc README says V2 uses an OOXML-backed document model, whereas v1 exposed ProseMirror internals (editor.state/editor.view, removed in v2). The browser editor 'needs no server of its own'. Features: pagination, sections, headers, footers, tables, suggesting, comments, tracked changes, Yjs collaboration, and a Node/Python SDK, CLI and MCP server. (https://raw.githubusercontent.com/superdoc-dev/superdoc/main/README.md)
- [medium] The SuperDoc v2 core line is very recent: core v1.46.1 was published 2026-08-05 and v2.10.0 on 2026-08-28. The repo was created 2024-06-03 and has about 1.06k stars. (https://api.github.com/repos/superdoc/docx-editor/releases?per_page=100&page=1)
- [high] A SuperDoc maintainer closed the client-side PDF export PR on 2026-09-14: 'Browser PDF export isn't available in the supported package yet, and we haven't committed to an implementation or release date.' The work continues in an internal repository. (https://github.com/superdoc/docx-editor/pull/3919)
- [high] Open SuperDoc bug #3900 (opened 2026-08-13, in progress): editing a TOC, a large document or a large table triggers 'current unpainted target reached 1000ms' and the page can freeze. (https://github.com/superdoc/docx-editor/issues/3900)
- [medium] Other open SuperDoc issues include #4031 'v2: contentControls.patch exports undeclared w15 namespace' (produces an invalid package) and #4040 (paragraph with a negative left indent renders flush left). A TOC removal regression, #4033, shows TOC operations exist but are still unstable. (https://github.com/superdoc/docx-editor/issues)
- [medium] SuperDoc added OMML equation rendering (OMML to MathML converters) in March–April 2026, and a chart-renderer module PR (#3606) is still open. Editing of equations and charts is not documented. (https://api.github.com/search/issues?q=repo:superdoc/docx-editor+smartart+OR+equation+OR+OMML+OR+math)
- [high] eigenpal/docx-editor is Apache-2.0 except three packages under the proprietary 'EigenPal Pro License': @docx-editor.dev/pro (tracked changes, comments, collaboration), @docx-editor.dev/editor-api and @docx-editor.dev/docx-to-pdf. (https://github.com/eigenpal/docx-editor)
- [high] Eigenpal's 2.x fidelity matrix tracks 100 features. Editing: 28 full, 32 partial, 1 preserved, 39 not supported. Not editable: charts (shown as a labeled placeholder), SmartArt, text boxes (read-only), drawing shapes, OMML equations, merge/split of cells, floating tables, watermarks. TOC refresh updates page numbers only. Unsupported content keeps its unmodeled markup when other content is edited. (https://www.docx-editor.dev/docs/2.x/word-fidelity)
- [medium] The eigenpal/docx-editor repository was created 2026-07-20 per the GitHub API. It has about 440 stars and released 2.23.0 on 2026-09-28. (https://api.github.com/repos/eigenpal/docx-editor)
- [high] npm 'docx' 9.8.1 (MIT) is a DOCX generator. Its patcher can only replace pre-inserted {{placeholder}} tags in an existing document; it cannot edit arbitrary content. (https://raw.githubusercontent.com/dolanmiu/docx/master/docs/usage/patcher.md)
- [high] mammoth 1.13.0 (BSD-2-Clause) converts DOCX to simple HTML/Markdown. It deliberately ignores font, size and colour styling and table borders, and has no HTML-to-DOCX conversion. (https://raw.githubusercontent.com/mwilliamson/mammoth.js/master/README.md)
- [high] docx-preview 0.4.1 (Apache-2.0) renders DOCX to HTML. 'Realtime page breaking is not implemented'; fields and TOC are unsupported; there is no editing or saving. (https://raw.githubusercontent.com/VolodymyrBaydalka/docxjs/master/README.md)
- [high] CKEditor 5 Pagination is a premium add-on that needs a license key. It previews where page breaks will fall on export and warns that automatic page-break prediction for Export to Word is 'problematic and error-prone'. (https://ckeditor.com/docs/ckeditor5/latest/features/pagination/pagination.html)
- [high] CKEditor 5 Import from Word is a premium feature that 'sends the selected Word file to the CKEditor Cloud Services DOCX to HTML converter service'. (https://ckeditor.com/docs/ckeditor5/latest/features/converters/import-word/import-word.html)
- [high] Tiptap Pages and Tiptap Conversion (DOCX import/export) are Pro packages installed from Tiptap's private npm registry. The conversion service parses documents and returns Tiptap JSON through REST endpoints. (https://tiptap.dev/docs/conversion/getting-started/overview)
- [high] The Syncfusion JavaScript Document Editor natively uses the SFDT format. Opening or saving DOCX needs a server-side helper (ASP.NET Core / MVC) to convert between DOCX and SFDT. (https://help.syncfusion.com/document-processing/word/word-processor/javascript-es6/import)
- [medium] The Syncfusion Community License (proprietary, not OSI) is limited to organizations with under $1M annual revenue, at most 5 developers and 10 employees, and no more than $3M in outside capital. (https://www.syncfusion.com/products/communitylicense)
- [medium] canvas-editor (MIT, about 5.2k stars) has native pagination with headers and footers. DOCX import/export lives in an MIT plugin whose runtime dependencies are docx and jszip, so it uses its own model rather than preserving OOXML (the last part is inference). (https://raw.githubusercontent.com/Hufe921/canvas-editor-plugin/main/packages/docx/package.json)
- [medium] ONLYOFFICE sdkjs is AGPL-3.0 with additional terms in its LICENSE: no trademark or logo rights under §7(e), required notices naming ONLYOFFICE as the original developer, and CC BY-SA 4.0 for non-code elements. Source headers carry SPDX AGPL-3.0-only. (https://raw.githubusercontent.com/ONLYOFFICE/sdkjs/master/LICENSE)
- [medium] ONLYOFFICE's JS editors open OOXML through the C++ x2t converter, which translates DOCX/XLSX/PPTX to and from an internal binary format. A community project runs sdkjs with x2t compiled to WebAssembly fully client-side, under AGPL-3.0 with the ONLYOFFICE notices kept. (https://github.com/ranuts/document)
- [medium] In March 2026 ONLYOFFICE accused the Nextcloud/IONOS 'Euro-Office' fork of violating its AGPLv3 §7 additional conditions. Nextcloud and IONOS dispute this. (https://www.heise.de/en/news/Euro-Office-OnlyOffice-accuses-of-license-violations-11241334.html)
- [high] Univer README: the Apache-2.0 open-source part covers core spreadsheet editing, formulas, number formatting, filter/sort, data validation, conditional formatting, notes, tables, hyperlinks, comments, drawing, and find and replace. Univer Pro covers 'Real-time collaboration, edit history, import/export, printing, charts, pivot tables, sparklines, outlines, shapes, in-cell graphics, data connectors, server-side calculation'. (https://raw.githubusercontent.com/dream-num/univer/dev/README.md)
- [high] Univer XLSX import/export uses the @univerjs-pro/exchange-client and @univerjs-pro/sheets-exchange-client packages, and the docs state 'The APIs below need a conversion backend.' (https://docs.univer.ai/guides/sheets/features/import-export)
- [high] The Univer Pro site states 'new purchases of Univer Pro are temporarily paused, and the 30-day evaluation license is temporarily unavailable'. (https://pro.univer.ai/)
- [medium] Univer v1.0.0 was released 2026-09-03 and v1.0.2 on 2026-09-24. The notes describe XLSX/DOCX/PPTX import and export as part of the Server SDK (Exchange), which can run in Node.js. (https://github.com/dream-num/univer/releases/tag/v1.0.0)
- [medium] Without a valid Univer Pro license, some features are restricted and a watermark is shown. (https://pro.univer.ai/license)
- [high] FortuneSheet is MIT; its latest release, v1.0.4, was published 2025-11-06. The README lists pivot tables, charts and print as unfinished. (https://api.github.com/repos/ruilisi/fortune-sheet/releases/latest)
- [high] FortuneExcel (Corbe30, MIT, 36 stars), the XLSX/CSV import/export plugin for FortuneSheet, depends on exceljs ^4.4.0. (https://raw.githubusercontent.com/Corbe30/FortuneExcel/main/package.json)
- [high] Luckysheet (MIT) is archived: 'Luckysheet is no longer maintained. It is recommended to use the upgraded version of Univer'. (https://github.com/dream-num/Luckysheet)
- [high] x-spreadsheet (MIT) says it 'has been migrated to @wolf-table/table'. Its last push was 2024-08-07, and it handles XLSX through SheetJS. (https://api.github.com/repos/myliang/x-spreadsheet)
- [medium] jspreadsheet CE (MIT, npm 5.0.4) cannot parse .xlsx. XLSX import/export extensions belong to the commercially licensed Pro product. (https://bossanova.uk/jspreadsheet/blog/jspreadsheet-ce-vs-pro)
- [high] Handsontable (npm 18.1.1) is proprietary: free only for non-commercial or evaluation use, a paid license for commercial use, and a clause forbidding use to develop competing software. (https://raw.githubusercontent.com/handsontable/handsontable/develop/LICENSE.txt)
- [high] HyperFormula is GPL-3.0-only on npm, with a proprietary license also available. Version 3.4.0 was released 2026-08-10. It is a headless engine with about 400 functions and no UI or file I/O, and it requires the licenseKey 'gpl-v3' under the GPL. (https://raw.githubusercontent.com/handsontable/hyperformula/master/CHANGELOG.md)
- [high] @formulajs/formulajs 4.6.1 (MIT) is a 'JavaScript implementation of most Microsoft Excel formula functions'. It implements functions only, with no formula parser or dependency graph. (https://github.com/formulajs/formulajs)
- [high] fast-formula-parser (MIT) is an LL(1) parser supporting 280 formulas. Its latest version, 1.0.19, was published 2020-11-26. (https://registry.npmjs.org/fast-formula-parser)
- [high] ExcelJS (MIT): the latest GitHub release is v4.4.0, published 2023-10-19, and the last push was 2025-01-21. A community discussion from 2025-02-05 reports the maintainer inactive. Forks such as @protobi/exceljs and @rmartin93/exceljs-fork have appeared. (https://api.github.com/repos/exceljs/exceljs/releases/latest)
- [high] ExcelJS issue #1734 (open since 2021-06-01): reading a workbook that has charts and writing it back loses the charts, even with no edits. (https://github.com/exceljs/exceljs/issues/1734)
- [high] SheetJS CE is Apache-2.0. The current release is 0.20.3, served from cdn.sheetjs.com ('the authoritative source'); the public npm 'xlsx' package is stuck at 0.18.5. (https://docs.sheetjs.com/docs/getting-started/installation/nodejs)
- [high] SheetJS CE is vulnerable to CVE-2023-30533 (prototype pollution) up to 0.19.2 and CVE-2024-22363 (ReDoS) up to 0.20.1. The fixed versions are published only on cdn.sheetjs.com. (https://cdn.sheetjs.com/advisories/CVE-2024-22363)
- [high] SheetJS Pro, not CE, provides cell/text styling, data validation and conditional formatting, image and shape read/write, chart read/write, PivotTables, and 'Update data in a file with perfect fidelity'. (https://sheetjs.com/pro/)
- [medium] IronCalc (Rust, MIT/Apache-2.0) describes itself as a 'work-in-progress spreadsheet engine'. @ironcalc/wasm 0.8.4 (2026-08-01) is web bindings without the xlsx reader/writer. (https://registry.npmjs.org/@ironcalc/wasm)
- [medium] @office-kit/xlsx (MIT) was first published 2026-07-05; version 0.23.0 came out 2026-09-26. It reads, edits and writes XLSX with byte-identical passthrough of unmodeled parts, has no formula evaluation, and is pre-1.0. (https://registry.npmjs.org/@office-kit/xlsx)
- [medium] PptxGenJS 4.0.1 (MIT) is a library to 'Create JavaScript PowerPoint Presentations'. It has no built-in import or editing of existing PPTX files. (https://registry.npmjs.org/pptxgenjs/latest)
- [high] PPTXjs (MIT) is a jQuery plugin that converts PPTX to HTML for viewing. Its last push was 2022-03-26. (https://api.github.com/repos/meshesha/PPTXjs)
- [medium] pptx-preview 1.0.7 declares license ISC but lists no repository URL in its npm metadata. It is a front-end PPTX preview library. (https://registry.npmjs.org/pptx-preview/latest)
- [high] PPTist is AGPL-3.0 and forbids closed-source commercial use. Alternatives: a paid license (CNY 2,999/year or 5,699 perpetual) or an unmaintained Apache-2.0 version from May 2022. The README self-reports roughly 85%+ PPTX import fidelity and about 95%+ export fidelity. (https://raw.githubusercontent.com/pipipi-pikachu/PPTist/master/README.md)
- [medium] PPTist depends on pptxtojson (^2.2.0) for import and pptxgenjs (^3.12.0) for export, so exported PPTX files are regenerated from its own model. (https://raw.githubusercontent.com/pipipi-pikachu/PPTist/master/package.json)
- [high] pptxtojson (MIT) is read-only, parsing PPTX to JSON. It states 'roughly 80%+ overall fidelity in layout and styling compared with the source file'. (https://github.com/pipipi-pikachu/pptxtojson)
- [medium] pptx-viewer (ChristopherVR, Apache-2.0) was created 2026-03-16, has 109 stars and one maintainer. It claims parse, render, edit and save of PPTX, but rendering is CSS-based and fidelity caveats are acknowledged. (https://github.com/ChristopherVR/pptx-viewer/)
- [medium] @office-kit/pptx (MIT, 0.x) loads, edits and saves PPTX while preserving unknown elements. It has no built-in rendering, and SmartArt authoring is planned for after 1.0. (https://github.com/office-kit/pptx)
- [high] Candidate package-inspection libraries: JSZip 3.10.2 is dual-licensed (MIT OR GPL-3.0-or-later); fflate 0.8.3, fast-xml-parser 5.11.1 and @xmldom/xmldom 0.9.12 are MIT. (https://registry.npmjs.org/jszip/latest)
- [medium] @xarsh/ooxml-validator (MIT, about 5 stars) packages Microsoft's Open XML SDK as a native binary for Windows, macOS and Linux with no .NET install. @ooxml-tools/validate (MIT, 1 star) runs .NET as WASM and describes itself as 'huge, and slow'. (https://github.com/xarsh/ooxml-validator)
- [medium] superdoc/docx-corpus offers 736K+ real .docx files taken from Common Crawl, with a takedown process for copyright holders. (https://github.com/superdoc/docx-corpus)
- [low] In the third-party neurotic_docx_bench, SuperDoc 1.44.1 (v1, legacy corpus) scored a median of 61.25 on visual similarity to Word over 199 documents. LibreOffice is used only as a pinned PDF renderer and is not scored, so the results cannot compare LibreOffice with JS engines. (https://raw.githubusercontent.com/jandira-tech/neurotic_docx_bench/main/RESULTS_DETAILED.md)
- [medium] LibreOffice's import/export crash-testing corpus had grown to over 92,000 documents by July 2016. Every document is imported and then exported to several formats. (http://caolanm.blogspot.com/2016/07/crashtesting-now-92000-documents.html)
- [medium] LibreOfficeKit provides tiled rendering of LibreOffice core documents and is the base that Collabora Online's browser JS front-end uses. It is an alternative way to put a web UI over unmodified LibreOffice core. (https://docs.libreoffice.org/libreofficekit.html)
- [medium] ZetaOffice (allotropia) ships LibreOffice technology compiled to WebAssembly, with ZetaJS (MIT) as its JS wrapper; LibreOffice itself is MPL-2.0. It was announced in beta in November 2024. (https://blog.allotropia.de/2024/11/08/announcing-zetaoffice-a-new-libreoffice-technology-product-for-web-mobile-desktop/)
