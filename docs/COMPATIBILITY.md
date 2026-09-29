# Compatibility matrix

**Engine:** LibreOffice 26.8.0.3 (unmodified) for documents, spreadsheets and presentations; pdf.js 6.3.289 and
@cantoo/pdf-lib 2.11.1 for PDF. **Last reviewed:** 2026-09-29.

> **Read this first**
>
> - The *Open / Display / Edit / Save / Convert / Preserved / May be lost* columns describe what the engine is
>   **expected** to do, based on its filter configuration, its source code, its bug tracker and its help pages
>   (see [research/formats.md](research/formats.md)), plus Varak's own policy on top (for example which format
>   "Save" proposes). They are **not test results** unless a statement is marked *(tested)*.
> - The **Test status** column is the only place that reports verification by Varak's own tests; details are in
>   [Test status](#test-status). For office formats, "engine round trip tested" means that an automated test opens
>   a file in headless LibreOffice 26.8.0.3, saves it and checks the result with independent readers that do not
>   use LibreOffice. These tests run the engine directly, **not** Varak's application and save pipeline. For PDF the
>   column names unit tests of the PDF module, which also run without the application window.
> - Statements marked *(tested)* are checked by those tests; unmarked statements are expectations.
> - **Nothing in this document was verified in Microsoft Office.** Microsoft Office is not used in the project's
>   tests. A file that passes our tests may still look or behave differently in Word, Excel or PowerPoint, and
>   Excel may calculate some formulas differently. Please report such cases.

The format registry that drives open/save dialogs, filter selection and loss warnings is
`src/shared/formats.ts`.

## Legend

| Term | Meaning |
|---|---|
| Open | The file can be loaded. Password-protected files ask for the password. |
| Display | The content is shown in the editing view; layout can differ from Microsoft Office (fonts, line and page breaks). |
| Edit | The content can be changed with Varak's ribbon and LibreOffice's own dialogs. |
| Save in same format | "Save" writes the same format again. If not, Varak proposes another format and warns. |
| Convert to | Formats offered by "Save As" for this kind of document. PDF export uses LibreOffice's PDF filters. |
| Preserved | Content that is expected to survive open → save in the same format. |
| May be lost | Content that is expected to be lost, changed or kept but not editable. Varak warns before saving when it detects such content ([ADR 0005](adr/0005-data-integrity.md)). |

Convert-to lists (Save As):

- **Documents:** DOCX, DOCM, DOTX, DOC, RTF, TXT, ODT, PDF
- **Spreadsheets:** XLSX, XLSM, XLTX, XLS, CSV, TSV, ODS, PDF
- **Presentations:** PPTX, PPTM, PPSX, POTX, PPT, PPS, ODP, PDF

## Primary formats (milestone v0.1)

| Format | Open | Display | Edit | Save in same format | Convert to | Preserved | May be lost | Test status |
|---|---|---|---|---|---|---|---|---|
| **DOCX** | Yes: Word 2007–365 (ECMA-376 and ISO Transitional); Strict is imported as Transitional; encrypted files (Standard and Agile, AES-128/192/256) with password | Yes; pagination can differ from Word when fonts differ | Yes | Yes; the flavour of the original (ECMA or ISO Transitional) is kept | Documents list | Text, styles, lists, tables, images, headers/footers, footnotes/endnotes, fields, comments with replies, tracked changes, content controls, embedded fonts, equations (OMML ↔ LibreOffice Math), classic charts *(tested)*; SmartArt is kept with its original data | **Office 2016+ charts (chartex) are replaced by their fallback pictures** *(tested)*; a bullet without a bullet font is rewritten to the Symbol font *(tested)*; Strict dialect (saved as Transitional); SmartArt can't be edited; some ActiveX controls; password is saved with Standard encryption (AES-128), weaker than Office's default; rights-managed (IRM) files can't be opened | **Engine round trip tested:** Turkish text, bullets, headings, bold/italic/underline, table, header/footer with page fields, comment, tracked insertion, hyperlink, picture, page size and margins; classic charts and tracked changes of third-party files (Apache POI samples); visual comparison of the pages |
| **XLSX** | Yes: Excel 2007–365 (ECMA and ISO Transitional); Strict imported as Transitional; encrypted files with password | Yes; Office 2016+ charts (chartex) are **not drawn** | Yes; formulas are recalculated by LibreOffice | Yes; flavour kept | Spreadsheets list | Values, formulas and cached results, number formats, styles, conditional formatting, data validation, tables, charts, pivot tables, sparklines, external links, notes; threaded comments (shown as notes, no reply UI); chartex definitions (kept, not drawn) | **Slicers, timelines, Power Query and the Data Model are lost**; Pareto charts export incompletely; some functions can give different results than Excel; password saved with Standard encryption; with a Turkish engine locale two number formats are rewritten: `0.00%` → `%0.00` and `dd.mm.yyyy` → `dd/mm/yyyy` *(tested; how Excel shows them is not verified)* | **Engine round trip tested** with English and Turkish locale settings: values, formulas and cached results, constants, dates, number formats, merged cells, frozen panes, data validation, conditional formatting, defined name; visual comparison of the sheets exported to PDF |
| **PPTX** | Yes: PowerPoint 2007–365; encrypted files with password | Yes; Morph transitions, ink and 3D models are not shown as in PowerPoint | Yes | Yes | Presentations list | Slides, layouts and masters, text, images, tables, charts, notes, comments, transitions and animations (with gaps), audio/video (playback depends on codecs), embedded fonts, whole-object equations | **Morph** transition; **ink**; **3D models** (a fallback picture is kept); **inline equations inside text**; SmartArt can't be edited; some animation details; **the slide master's text styles are not written back** *(tested)*: spacing and bullet sizes defined only in the master can change | **Engine round trip tested:** slide count, titles, Turkish texts, bullet levels, speaker notes, picture, table; texts of a SmartArt slide and notes of third-party decks (Apache POI samples); visual comparison of the slides |
| **PDF** | Yes (PDF module, pdf.js 6.3); encrypted files with password | Yes (pdf.js), with thumbnails; search treats İ, I, ı and i as the same letter unless it is case-sensitive | Annotations (highlight, free text, ink, image), comments on annotations, AcroForm filling, page operations (rotate, delete, move, insert blank page, duplicate), merge, extract, adding text and images as page content. **Existing page text can't be edited.** XFA-only forms can't be filled; PDF JavaScript never runs | Yes: annotations, forms and added text/images are saved as an incremental update; page operations and merges rewrite the file and remove deleted pages completely. The saved file is verified before it replaces the original | — (PDFs are created *from* the office modules through Export as PDF) | Page content, existing annotations, bookmarks, form fields, encryption (incremental saves keep it). Varak draws the appearance of Turkish free text and form values itself, because pdf.js alone saves them without one (invisible in Chrome/Edge) | Digital signatures become invalid when the file is rewritten (Varak asks first and offers "save a copy"); page operations, merging encrypted files and adding text/images are refused for encrypted PDFs; outlines, page labels and structure tree of merged-in files; a free-text annotation made by another application keeps its old appearance after editing | **Unit-tested with generated PDFs** (not in the running app): `tests/unit/pdf/pdf-service.test.ts` (page operations, merge, extract, add text/images, save verification, signed and encrypted files), `appearance.test.ts` and `pdfjs-save.test.ts` (Turkish appearances), `viewer-components.test.tsx` (Turkish search) |

## Directly supported by the engine

The engine opens these formats and saves them back in the same format.

| Format | Open | Display | Edit | Save in same format | Convert to | Preserved | May be lost | Test status |
|---|---|---|---|---|---|---|---|---|
| **DOCM** | Yes | Yes | Yes | Yes (macro-enabled filter) | Documents list | As DOCX, plus the VBA project: every stream of `vbaProject.bin` unchanged, only the compound file around them is rewritten *(tested)* | Macros are **never executed**; saving as DOCX drops them (Varak warns) | **Engine round trip tested** (Apache POI sample): VBA project name, modules, declarations, code and every stream |
| **DOTX** | Yes, as the template itself or as a new document based on it | Yes | Yes | Yes | Documents list | As DOCX | No password protection for templates | Saving *as* DOTX tested (template content type, text); opening not yet tested |
| **DOC** | Yes: Word 97–2003 (older Word versions import only); XOR/RC4/CryptoAPI passwords | Yes | Yes | Yes (Word 97–2003) | Documents list | Text, formatting, tables, images, headers/footers, comments, tracked changes | Features newer than Word 2003 (content controls, modern charts, …); password saved with RC4 | Converting tested both ways: a DOCX saved as DOC reopens with its text and table; the text of a third-party DOC (Apache POI sample) survives conversion to DOCX |
| **RTF** | Yes | Yes | Yes | Yes | Documents list | Text, formatting, tables, images | Features RTF can't represent (for example some fields, comments and layout details) | Saving *as* RTF tested (the text is present); opening not yet tested |
| **TXT** | Yes; UTF-8 by default, other encodings (for example Windows-1254) selectable | Yes | Yes | Yes (UTF-8 with BOM and CRLF line ends by default) | Documents list | The text | **All formatting**, images and tables (plain text only) | Saving *as* TXT tested (UTF-8 with BOM, the text is present); opening not yet tested |
| **ODT** | Yes (LibreOffice's native format) | Yes | Yes | Yes (ODF 1.4 Extended) | Documents list | Everything LibreOffice supports | Nothing expected; Microsoft Word may not support every ODF feature | Saving *as* ODT tested (text, headings, table, header/footer, comment, picture); ODT round trip not yet tested |
| **XLSM** | Yes | Yes | Yes | Yes (macro-enabled filter) | Spreadsheets list | As XLSX, plus the VBA modules: project name, module names, types and order, declarations and the code of every module *(tested)* | Macros are **never executed**; the VBA project is **rebuilt** from its modules, not copied: new project ID, no compiled code caches, and **macro descriptions and shortcut keys (procedure attributes) are lost** *(tested)*; VBA signatures are lost | **Engine round trip tested** (Apache POI sample); whether Excel runs the rebuilt project is not verified |
| **XLTX** | Yes, as the template itself or as a new document based on it | Yes | Yes | Yes | Spreadsheets list | As XLSX | As XLSX | Saving *as* XLTX tested (template content type, formula results); opening not yet tested |
| **XLS** | Yes: Excel 97–2003 (Excel 4/5/95 import only); XOR/RC4/CryptoAPI passwords | Yes | Yes | Yes (Excel 97–2003) | Spreadsheets list | Values, formulas, formatting, charts, notes | Features newer than Excel 2003 (more rows/columns, newer functions and charts); password saved with RC4 | Converting tested both ways: an XLSX saved as XLS reopens with its formula results; the text of a third-party XLS (Apache POI sample) survives conversion to XLSX |
| **CSV** | Yes, with explicit options: separator, text delimiter, encoding and locale (Turkish: `;` and decimal comma) | Yes | Yes | Yes, **one sheet per file** | Spreadsheets list | Cell values of the current sheet | **All formatting, formulas, other sheets, charts**; formulas in imported CSV are not evaluated (protects against CSV formula injection) | Saving *as* CSV tested (Turkish: `;`, decimal comma, UTF-8 with BOM; English: `,`); the import options (separator guess, Turkish encodings, prompt) are unit-tested without the engine |
| **TSV** | Yes (tab-separated) | Yes | Yes | Yes, one sheet per file | Spreadsheets list | Cell values | As CSV | Saving *as* TSV tested (English locale) |
| **ODS** | Yes (LibreOffice's native format) | Yes | Yes | Yes (ODF 1.4 Extended) | Spreadsheets list | Everything LibreOffice supports | Nothing expected; Excel may not support every ODF feature | Saving *as* ODS tested (data, formulas, recalculated values); ODS round trip not yet tested |
| **PPTM** | Yes | Yes | Yes | Yes (macro-enabled filter) | Presentations list | As PPTX, plus the VBA project: every stream unchanged, only the compound file rewritten *(tested)* | Macros are **never executed**; saving as PPTX drops them | **Engine round trip tested** (Apache POI sample): VBA project name, modules, declarations, code and every stream |
| **PPSX** | Yes, opened **for editing** (not as a running slide show) | Yes | Yes | Yes (keeps the show type) | Presentations list | As PPTX | As PPTX | Saving *as* PPSX tested (slideshow content type, slide titles); opening not yet tested |
| **POTX** | Yes, as the template itself or as a new document based on it | Yes | Yes | Yes | Presentations list | As PPTX | As PPTX | Saving *as* POTX tested (template content type, slide titles); opening not yet tested |
| **PPT** | Yes: PowerPoint 97–2003 (older versions import only); **not if password-protected** | Yes | Yes | Yes (PowerPoint 97–2003) | Presentations list | Slides, text, images, tables, notes, animations | Features newer than PowerPoint 2003; **password-protected PPT can neither be opened nor saved with a password** | Converting tested both ways: a PPTX saved as PPT reopens with its slide texts and notes; the text of a third-party PPT (Apache POI sample) survives conversion to PPTX |
| **PPS** | Yes, opened for editing (not as a running slide show) | Yes | Yes | Yes (keeps the show type) | Presentations list | As PPT | As PPT | not yet tested |
| **ODP** | Yes (LibreOffice's native format) | Yes | Yes | Yes (ODF 1.4 Extended) | Presentations list | Everything LibreOffice supports | Nothing expected; PowerPoint may not support every ODF feature | Saving *as* ODP tested (slide texts, notes, pictures); ODP round trip not yet tested |

## Opened via conversion / import-only

The engine can open these formats, but it **cannot write them back** with all their content. Varak opens them
and proposes a different format on "Save", with a warning; the original file is never overwritten silently.

| Format | Open | Display | Edit | Save in same format | Convert to | Preserved | May be lost | Test status |
|---|---|---|---|---|---|---|---|---|
| **DOTM** | Yes | Yes | Yes | **No** → Varak proposes **DOCM** (macros kept, template flag lost) | Documents list | As DOCX; VBA when saved as DOCM | Saving as DOTX **drops the macros** (no macro-enabled template filter in the engine) | not yet tested |
| **XLTM** | Yes | Yes | Yes | **No** → Varak proposes **XLSM** | Spreadsheets list | As XLSX; VBA (rebuilt) when saved as XLSM | Saving as XLTX **drops the macros** | not yet tested |
| **XLSB** | Yes (Excel binary workbook) | Yes | Yes | **No** (the engine has no XLSB export) → Varak proposes **XLSX** | Spreadsheets list | Values, formulas and formatting that the XLSB import understands | Anything the import does not understand; the XLSB file itself is not rewritten | not yet tested |
| **PPSM** | Yes, opened for editing | Yes | Yes | **No** → Varak proposes **PPTM** | Presentations list | As PPTX; VBA when saved as PPTM | Saving as PPSX **drops the macros** | not yet tested |
| **POTM** | Yes | Yes | Yes | **No** → Varak proposes **PPTM** | Presentations list | As PPTX; VBA when saved as PPTM | Saving as POTX **drops the macros** | not yet tested |

LibreOffice can also *import* PDFs as drawings (a lossy conversion through the GPL helper `xpdfimport`). Varak does
not use this path for editing PDFs; if it is ever offered, it will be labelled as a conversion and the original
file will be kept ([ADR 0004](adr/0004-pdf-stack.md)).

## Hard cases

| Topic | What to expect |
|---|---|
| **Macros: preserved vs executed** | Macros are **never executed** in Varak (engine profile: macro execution disabled). DOCM and PPTM keep the VBA project when saved in the same format: every stream inside `vbaProject.bin` is unchanged, but the compound file that holds them is rewritten, so the part is not byte-identical *(tested)*. XLSM macros are rebuilt from the imported modules: the code of every module is kept, but the project gets a new ID, loses its compiled code caches and the procedure attributes (macro descriptions and shortcut keys) *(tested)*, and VBA signatures are lost. DOTM, XLTM, POTM and PPSM can't be saved with macros in their own format. Saving any macro-enabled file as a macro-free format drops the macros, and Varak warns first. |
| **Embedded objects (OLE)** | Embedded Word, Excel, PowerPoint and MathType objects are converted to LibreOffice objects on load and back to Microsoft formats on save; Visio and PDF objects become drawings; other objects are kept as OLE objects with a preview image. Round-tripped objects can differ from the originals. |
| **SmartArt** | Kept: the original SmartArt data is saved back and its fallback drawing is displayed. It **can't be edited or created**; layout bugs are tracked upstream (tdf#106547, tdf#37932). |
| **Equations** | DOCX: Office Math (OMML) is converted to LibreOffice Math and back. PPTX: equations that are whole objects round-trip; **equations inline in slide text are lost** (tdf#129061). |
| **Advanced charts (chartex)** | Waterfall, treemap, sunburst, funnel, box & whisker, histogram/Pareto and region map charts: in **XLSX** they are expected to be **kept but not drawn** (a placeholder is shown) and can't be edited; Pareto export is incomplete (tdf#165742). In **DOCX** they are **replaced by their fallback pictures** on save *(tested)*: the chart data is lost. Classic charts survive *(tested in DOCX)*. |
| **Pivot tables and slicers** | Pivot tables and their caches are imported and exported. **Slicers and timelines are not supported and are lost** on save (tdf#119807). |
| **External links** | Links to other workbooks are kept on save. The engine opens documents with link updates switched off (`UpdateDocMode` = no update), so opening a file does not fetch linked content, and linked cells keep the values stored in the file. Refreshing linked data is a separate command that you start yourself; the linked files or sources must then be reachable. |
| **Power Query and the Data Model** | **Lost on save** (tdf#158857). Varak warns when it detects them. |
| **Animations and Morph** | Transitions and animations are supported with gaps (tdf#139897); the **Morph** transition is not supported (tdf#116736). |
| **Missing fonts, Aptos** | The engine ships metric-compatible substitutes: Carlito (Calibri), Caladea (Cambria), Liberation Sans/Serif/Mono (Arial, Times New Roman, Courier New). There is **no substitute for Aptos**, the Microsoft 365 default font since 2023–24; documents that use it re-flow when Aptos is not installed, so line and page breaks can move. |
| **Passwords** | OOXML: opens Standard and Agile encryption; **saves with Standard encryption (AES-128/SHA-1)**, which is weaker than Office's default. DOC/XLS: open XOR, RC4 and RC4 CryptoAPI; save with RC4. **PPT: password-protected files can't be opened, and PPT can't be saved with a password** (tdf#33538, tdf#63016, tdf#73971). Rights-managed (IRM/DRM) files can't be opened (tdf#116197). |
| **Strict OOXML** | Imported and mapped to Transitional; always saved as Transitional (tdf#149658). |
| **Threaded comments (Excel)** | Kept on save with LibreOffice 26.8, shown as ordinary notes without a reply UI (tdf#172194). |
| **CSV and regional settings** | CSV options are always passed explicitly. Turkish defaults use `;` as separator and `,` as decimal separator; English defaults use `,`. Formulas in imported CSV are not evaluated. Scientific-notation detection can change codes such as `1E5`. |
| **Legacy binary formats** | DOC/XLS/PPT are fully editable, but features newer than Office 2003 are lost when saving back to them; Varak recommends the OOXML equivalent. |
| **Changes on a round trip** | *(tested)* DOCX: a bullet `•` that has no bullet font is written as U+F0B7 in the Symbol font, so the bullet glyph and line height change slightly. PPTX: the slide master's text styles (`p:txStyles`) are not written back and the layouts get LibreOffice's default outline list styles instead; in the test deck the second-level item moved down by about 11 pt and its bullet shrank to 75 %. XLSX with a Turkish engine locale: `0.00%` becomes `%0.00` and `dd.mm.yyyy` becomes `dd/mm/yyyy`. Also seen, not asserted: Calc writes `TRUE()`/`FALSE()` instead of the constants, and Writer keeps non-ASCII characters of hyperlink addresses unescaped. |

## Test status

What Varak's own automated tests cover today (all headless, in the repository, passing on 2026-09-29):

- **Office formats, engine round trips** (`tests/engine/independent.test.ts`, `tests/engine/visual.test.ts`; reported
  passing in [dev/testing-corpus.md](dev/testing-corpus.md#test-runs): 48 passed + 1 skipped and 15 passed +
  2 skipped). Generated DOCX, XLSX and PPTX files with Turkish content and license-clean third-party samples
  (Apache POI) are opened and saved by headless LibreOffice 26.8.0.3; the results are read back by independent
  OOXML/ODF/VBA readers and compared page by page after PDF export. The same suites check the conversions to ODT,
  ODS, ODP, CSV, TSV, TXT, RTF, DOC, XLS, PPT and the template formats. They exercise the engine directly: opening
  and saving through Varak's application (bridge, safe save, prompts) is not covered by them yet.
- **PDF:** the PDF service and the viewer logic, with PDFs generated by the tests and read back with pdf.js:
  page operations, merge, extract, adding Turkish text and images, save verification, signed and encrypted files
  (`tests/unit/pdf/pdf-service.test.ts`); appearances for Turkish free text and form values on real pdf.js
  `saveDocument()` output (`tests/unit/pdf/appearance.test.ts`, `tests/unit/pdf/pdfjs-save.test.ts`); Turkish
  search on pdf.js' viewer build (`tests/unit/pdf/viewer-components.test.tsx`). The viewer inside the running app
  has not been tried.
- **Loss warnings:** the detection of content that a target format would lose (macros, SmartArt, chartex, slicers,
  timelines, Power Query, the Data Model, Morph, inline equations, Strict OOXML, passwords, IRM …) on synthetic
  packages (`tests/unit/main/compat.test.ts`), and the save-risk decision per target format
  (`tests/unit/main/savePlan.test.ts`).
- **Not yet tested:** opening and saving DOTM, XLTM, XLSB, PPSM, POTM and PPS through the engine; opening
  password-protected files with their password (the tests only check what the engine does without it: an XLSX fails
  quickly, a DOCX is imported as meaningless text, which is why Varak detects encryption itself and asks for the
  password before loading); round trips of the ODF formats; everything inside the running application. The findings of the round-trip
  tests are explained in [dev/testing-corpus.md](dev/testing-corpus.md#findings).

Manual spot checks in Microsoft Office, if a maintainer ever does them, will be labelled as manual with the Office
version and date and kept out of automated results.
