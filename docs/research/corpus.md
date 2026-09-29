# A legally redistributable test corpus and offline verification tooling for a Windows-first open-source office suite (DOCX/XLSX/PPTX/PDF)

> Research notes of 2026-09-28 on a redistributable test corpus and offline verification tools, prepared before the architecture decision and published
> with details about the research machine removed. Findings age quickly: check the linked sources before relying
> on a version number, a price, a bug status or a release date. Decisions are recorded in [docs/adr](../adr/README.md).

## Summary
**Bottom line.** We can build a clean, redistributable corpus of about 6.3 MB (87 files) from permissively licensed files. Most of them were saved by real Microsoft Office (checked via docProps/app.xml or the file format). A deterministic, self-generated CC0 set should cover Turkish text, formula oracles and large files. Everything can be verified offline with open-source readers, the Open XML SDK validator, and a LibreOffice → PDF → raster pixel-diff pipeline. Offline testing cannot show how Microsoft Office itself opens, lays out or recalculates our output. The docs must state that openly.

**1. Sources**
- **Best real-Office sources:**
  - Open XML SDK test files (MIT): Word/Excel/PowerPoint 2007–2016, including Strict, SmartArt, charts, 32 content controls, tracked deletions, SVG and an Agile-encrypted PPTX.
  - python-docx, python-pptx and openpyxl test files (MIT): Word/Excel/PowerPoint on Windows and Mac. The canonical python-pptx repo is now `scanny/python-pptx`; `python-openxml/python-pptx` returns 404.
- **Apache POI test-data and Apache Tika (Apache-2.0):**
  - POI moved from SVN to Git in July 2025; the SVN trunk still resolves.
  - Most files are Office-generated. POI's `poi-integration-exceptions.csv` documents the passwords.
  - Caveat: some files came from bug reports or were crawled from the web (domain-named files). Use an allowlist and ship POI's LICENSE and NOTICE.
- **PDFs:**
  - OCRmyPDF resources are licensed per file in REUSE.toml: `c03-29.pdf` (scanned page, public domain), `skew.pdf` (CC-BY-SA-3.0/GFDL), `acroform.pdf` (CC-BY-SA-4.0).
  - veraPDF corpus: CC BY 4.0.
  - PDF Association pdf20examples: CC BY-SA 4.0.
  - PDFBox AcroForm sample: Apache-2.0.
  - IRS W-9: US government work; AcroForm plus XFA.
- **Reference only, do not vendor:**
  - LibreOffice core qa: MPL repo, but TDF Bugzilla attachments are "considered" CC BY-SA 4.0 unless otherwise specified, and older ones are unknown.
  - pdf.js corpus: no per-file license; `.link` files point to external PDFs.
  - govdocs1: "to the best of our knowledge freely redistributed", contains malware; only 164 DOCX and 39 XLSX.
  - OPF format-corpus: CC0, but little modern OOXML.
- **No Turkish-language sample** was found in any inspected corpus, so we must generate them.
- **Encryption coverage** (verified by parsing EncryptionInfo):
  - Agile: passwords `pass` and `this is a test`.
  - Standard v3.2: `VelvetSweatshop` and `pwd123`.
  - Standard v4.2: `tika`.
  - Binary formats: RC4, CryptoAPI and XOR.

**2. Deterministic generation**
- **Libraries and their limits:**
  - python-docx 1.2.0 now supports comments; tracked changes need raw XML.
  - python-pptx 1.0.2 does charts but no SmartArt.
  - openpyxl 3.1.5 cannot create pivot tables. XlsxWriter 3.2.9 already fixes zip timestamps.
  - reportlab 5.0.1 supports AcroForm and an `invariant` flag.
  - pdf-lib has had no release since 2021; the maintained fork is @cantoo/pdf-lib.
  - Pillow creates image-only PDFs, but set its dates explicitly.
  - msoffcrypto-tool encrypts OOXML (experimental).
  - LibreOffice UNO covers what the libraries cannot author (pivot tables, PDF/A); generate those files once and commit them.
- **Measured during the research:**
  - openpyxl write-only produced 100k × 5 rows in 3.4 s (3.47 MB).
  - Two runs differed only in zip timestamps and `dcterms:modified`. After normalizing both, the files were byte-identical.
  - Hash the uncompressed parts, not the zip bytes.
- **Turkish text in PDFs:** the standard-14 fonts use WinAnsi, which lacks ğ, ş, ı and İ, so every PDF must embed a Unicode TTF.

**3. Verification**
- **Layers:**
  1. OPC/zip integrity
  2. OOXML-Validator (MIT, Open XML SDK)
  3. Independent read-back with openpyxl, python-docx, python-pptx, pypdf and ExcelJS. These readers are not editing or recalculation engines.
  4. Part-preservation diff (vbaProject.bin, customXml, diagrams)
  5. PDF text check with pdf.js or pypdfium2
  6. Pixel diff with pixelmatch or odiff
- **LibreOffice recalculation pitfall:**
  - LibreOffice trusts cached formula results when app.xml starts with "Microsoft" or "LibreOffice". openpyxl writes "Microsoft Excel Compatible / Openpyxl…", and XlsxWriter writes "Microsoft Excel" with a cached 0.
  - The default OOXMLRecalcMode is "never", and `fullCalcOnLoad` is not read.
  - So always call `calculateAll()`, or set recalculation to "always" in the test profile.
- **LibreOffice PDF export defaults:** JPEG quality 90 and non-embedded standard-14 fonts. Set `UseLosslessCompression` and `EmbedStandardFonts` for render tests.
- **Fonts and renderers:**
  - Fonts drive layout, and LibreOffice has no substitute for Aptos.
  - Pin renderer versions.
  - Start pixelmatch at threshold 0.1, with anti-aliasing excluded and windowed counts.

**4. Cannot be verified without Microsoft Office**
- Repair prompts on open
- Word and PowerPoint layout
- Excel recalculation of formulas we saved, and locale-sensitive functions
- VBA behaviour
- SmartArt and chart appearance
- Whether Office accepts our signatures and encryption

Word every compatibility statement as "tested with LibreOffice X and open-source validators; not tested in Microsoft Office".

**Disk space:** this workstream needs less than 0.5 GB (6.3 MB vendored corpus plus roughly 0.3–0.5 GB of tools). Keep external corpora and large generated files outside the repository.

## Tables
### A. Pinned base URLs (URL = base + path; spaces as %20; all checked 2026-09-28)
| Key | Base | License of files |
|---|---|---|
| POI | https://raw.githubusercontent.com/apache/poi/581a4cba5973743e35482163c8848ced8b7ae4f0/test-data/ | Apache-2.0 (ship POI LICENSE + NOTICE) |
| OXSDK | https://raw.githubusercontent.com/dotnet/Open-XML-SDK/431ab05cf160248cc3885a4a766026d4f8243792/test/DocumentFormat.OpenXml.Tests.Assets/assets/TestFiles/ | MIT (.NET Foundation and Contributors) |
| PYDOCX | https://raw.githubusercontent.com/python-openxml/python-docx/e45454602b53e8e572b179ccf1c91093ec9f4ed7/ | MIT |
| PYPPTX | https://raw.githubusercontent.com/scanny/python-pptx/278b47b1dedd5b46ee84c286e77cdfb0bf4594be/features/steps/test_files/ | MIT |
| OPXL | https://foss.heptapod.net/openpyxl/openpyxl/-/raw/52c77fdee169dceefc11aceef956aa0367e9759a/openpyxl/ | MIT |
| TIKA | https://raw.githubusercontent.com/apache/tika/162f93999418ee9f3c2cade9befaf843c27d449d/tika-parsers/tika-parsers-standard/tika-parsers-standard-modules/tika-parser-microsoft-module/src/test/resources/test-documents/ | Apache-2.0 |
| OCR | https://raw.githubusercontent.com/ocrmypdf/OCRmyPDF/1a1cfb595b9a504a4689b23193a76bae7c3a156d/tests/resources/ | per file (REUSE.toml) |
| VERA | https://raw.githubusercontent.com/veraPDF/veraPDF-corpus/bb75f4f0073d9350dfd058c0162a367e6fadf25e/ | CC-BY-4.0 |
| PDF20 | https://raw.githubusercontent.com/pdf-association/pdf20examples/c20f2c17bfcc4baab7cfe62e70fae64caf14d5fa/ | CC-BY-SA-4.0 |
| PDFJS | https://raw.githubusercontent.com/mozilla/pdf.js/25d979c9b1c739d418d6f10f0f2b702f89338e70/test/pdfs/ | Apache-2.0 repo; per-file provenance undocumented |
| PDFBOX | https://raw.githubusercontent.com/apache/pdfbox/b29f6d6f995f0aa0602e9c3b55031f295920d354/pdfbox/src/test/resources/org/apache/pdfbox/pdmodel/interactive/form/ | Apache-2.0 |
| IRS | https://www.irs.gov/pub/irs-pdf/ (not pinnable; pin by sha256) | US federal government work |

### B. Curated vendorable files (87 files, 6.34 MB). "Made by" comes from docProps/app.xml or, for binary files, the format header.
| # | Key:path | Bytes | Made by | Tests | Password / note |
|---|---|---|---|---|---|
| 1 | POI:document/sample.docx | 14,860 | Word 2007 | basic text, header/footer | - |
| 2 | POI:document/headerFooter.docx | 28,423 | Mac Word 2008 | headers/footers | - |
| 3 | POI:document/HeaderFooterUnicode.docx | 15,079 | Word 2007 | non-ASCII (É è é) in header/footer | - |
| 4 | POI:document/delins.docx | 17,720 | Word 2007 | tracked changes: 32 w:ins, 4 w:del | - |
| 5 | POI:document/testComment.docx | 65,298 | Word 2016+ | comments + image | - |
| 6 | POI:document/VariousPictures.docx | 103,677 | Word 2007 | many image types | - |
| 7 | POI:document/TestTableColumns.docx | 12,672 | Word 2016+ | table grid/widths | - |
| 8 | POI:document/footnotes.docx | 12,823 | Word 2007 | footnotes | - |
| 9 | POI:document/chartex.docx | 133,304 | Word 2016+ | chart / chartEx (by name) | - |
| 10 | POI:document/SimpleMacro.docm | 15,517 | Word 2007 | VBA part preservation | - |
| 11 | POI:document/bug53475-password-is-pass.docx | 29,696 | encrypted | Agile AES-256/SHA-1 | pass |
| 12 | POI:xmldsign/hello-world-signed.docx | 13,244 | Word 2007 | XML-DSig parts | edit must drop/flag signature |
| 13 | OXSDK:Complex01.docx | 847,839 | Word 2013 | comments, charts, SmartArt, footnotes, hdr/ftr, 32 content controls, 8 tracked deletions, OLE, Greek | - |
| 14 | OXSDK:Strict01.docx | 831,961 | Word 2013 | same content, ISO Strict | - |
| 15 | OXSDK:svg.docx | 74,104 | Word 2016+ | SVG image | - |
| 16 | OXSDK:Data-Bound-Content-Controls.docx | 16,070 | Word 2007 | content controls (7 w:sdt) | - |
| 17 | PYDOCX:features/steps/test_files/comments-rich-para.docx | 20,023 | Word 2016+ | rich comments | - |
| 18 | PYDOCX:features/steps/test_files/doc-odd-even-hdrs.docx | 17,711 | Word 2016+ | odd/even headers | - |
| 19 | PYDOCX:tests/test_files/having-images.docx | 132,875 | Mac Word 2011 | inline images, header | - |
| 20 | TIKA:testWORD_protected_passtika.docx | 14,336 | encrypted | Standard v4.2 | tika |
| 21 | POI:spreadsheet/SampleSS.xlsx | 9,112 | Excel 2007 | basic cells | - |
| 22 | POI:spreadsheet/comments.xlsx | 10,046 | Excel 2007 | comments | - |
| 23 | POI:spreadsheet/WithTwoCharts.xlsx | 12,810 | Excel 2007 | charts | - |
| 24 | POI:spreadsheet/ExcelPivotTableSample.xlsx | 19,460 | Excel 2016+ | pivot table + table | - |
| 25 | POI:spreadsheet/SimpleMacro.xlsm | 13,796 | Excel 2010 | VBA | - |
| 26 | POI:spreadsheet/FormulaEvalTestData_Copy.xlsx | 65,011 | Excel 2013 | 1,295 formulas, 1,268 cached results (recalc oracle) | - |
| 27 | POI:spreadsheet/ConditionalFormattingSamples.xlsx | 654,688 | Excel 2016+ | conditional formatting, accented text | - |
| 28 | POI:spreadsheet/DataValidations-49244.xlsx | 10,705 | Excel 2007 | data validation | - |
| 29 | POI:spreadsheet/ExcelTables.xlsx | 9,457 | Excel 2007 | structured tables | - |
| 30 | POI:spreadsheet/SampleSS.strict.xlsx | 10,006 | Excel 2013 | ISO Strict | - |
| 31 | POI:spreadsheet/headerFooterTest.xlsx | 27,484 | Mac Excel 2011 | print header/footer | - |
| 32 | POI:spreadsheet/protected_passtika.xlsx | 12,800 | encrypted | Standard v4.2 | tika |
| 33 | POI:poifs/protect.xlsx | 12,968 | encrypted | Standard v3.2, default password | VelvetSweatshop |
| 34 | POI:poifs/protected_sha512.xlsx | 14,336 | encrypted | Agile AES-256/SHA-512 | this is a test |
| 35 | POI:spreadsheet/sample.xlsb | 10,843 | Excel 2016+ | XLSB binary | - |
| 36 | OXSDK:Complex01.xlsx | 116,672 | Excel 2013 | comments, charts, SmartArt, images, table | - |
| 37 | OXSDK:Revision_NameCommentChange.xlsx | 8,276 | Excel 2007 | shared-workbook revision log | - |
| 38 | OPXL:reader/tests/data/pivot.xlsx | 14,504 | Mac Excel 2011 | pivot cache/table | - |
| 39 | OPXL:tests/data/reader/vba-test.xlsm | 52,938 | Excel 2010 | VBA + image | - |
| 40 | OPXL:reader/tests/data/contains_chartsheets.xlsx | 14,649 | Excel 2010 | chartsheet | - |
| 41 | POI:slideshow/SampleShow.pptx | 39,083 | PowerPoint 2016+ | slides + notes | - |
| 42 | POI:slideshow/SmartArt.pptx | 41,382 | PowerPoint 2016+ | SmartArt (diagram parts) | - |
| 43 | POI:slideshow/bar-chart.pptx | 44,410 | Mac PowerPoint 15.x | chart | - |
| 44 | POI:slideshow/45545_Comment.pptx | 308,394 | PowerPoint v12 | comments, notes, media | - |
| 45 | POI:slideshow/bug58144-headers-footers-2007.pptx | 42,035 | PowerPoint 2016+ | header/footer placeholders | - |
| 46 | POI:slideshow/table_test.pptx | 28,935 | PowerPoint 2016+ | table | - |
| 47 | POI:slideshow/with_japanese.pptx | 48,011 | PowerPoint 2007 | Japanese text | - |
| 48 | POI:slideshow/SimpleMacro.pptm | 41,578 | PowerPoint 2007 | VBA | - |
| 49 | POI:slideshow/layouts.pptx | 62,901 | PowerPoint 2010 | layouts/masters | - |
| 50 | OXSDK:Of16-01.pptx | 58,675 | PowerPoint 2016+ | chart, embedded object | - |
| 51 | OXSDK:animation.pptx | 100,209 | PowerPoint 2010 | animations | - |
| 52 | OXSDK:encrypted_pptx.pptx | 278,016 | encrypted | Agile AES-256/SHA-512 | password undocumented: use only for detect/prompt |
| 53 | TIKA:testPPT_protected_passtika.pptx | 41,472 | encrypted | Standard v4.2 | tika |
| 54 | PYPPTX:cht-charts.pptx | 77,751 | Mac PowerPoint 2011 | many chart types | - |
| 55 | PYPPTX:sld-notes.pptx | 22,964 | Mac PowerPoint 2011 | notes | - |
| 56 | PYPPTX:tbl-cell.pptx | 28,247 | Mac PowerPoint 2011 | table cells | - |
| 57 | TIKA:testPPT_comment.pptx | 30,939 | PowerPoint | comments | - |
| 58 | POI:document/SampleDoc.doc | 27,136 | Word (.doc) | basic | - |
| 59 | POI:document/HeaderFooterUnicode.doc | 28,672 | Word (.doc) | non-ASCII header/footer | - |
| 60 | POI:document/simple-table.doc | 19,456 | Word 97 | table | - |
| 61 | POI:document/SimpleMacro.doc | 36,864 | Word (.doc) | VBA | - |
| 62 | POI:document/password_tika_binaryrc4.doc | 22,016 | Word (.doc) | RC4 | tika |
| 63 | POI:document/password_password_cryptoapi.doc | 27,136 | Word (.doc) | RC4 CryptoAPI | password |
| 64 | POI:spreadsheet/SampleSS.xls | 17,408 | Excel 2003 | basic | - |
| 65 | POI:spreadsheet/comments.xls | 14,336 | Excel (.xls) | comments | - |
| 66 | POI:spreadsheet/WithChart.xls | 20,992 | Excel 2003 | chart | - |
| 67 | POI:spreadsheet/SimpleMacro.xls | 30,720 | Excel (.xls) | VBA | - |
| 68 | POI:spreadsheet/FormulaEvalTestData.xls | 178,176 | Excel (.xls) | formula oracle | - |
| 69 | POI:spreadsheet/password.xls | 22,528 | Excel 2003 | encrypted | password |
| 70 | POI:spreadsheet/xor-encryption-abc.xls | 4,096 | Excel (.xls) | XOR obfuscation | abc |
| 71 | POI:slideshow/SampleShow.ppt | 125,440 | PowerPoint (.ppt) | basic | - |
| 72 | POI:slideshow/WithComments.ppt | 10,752 | PowerPoint (.ppt) | comments | - |
| 73 | POI:slideshow/SimpleMacro.ppt | 104,960 | PowerPoint (.ppt) | VBA | - |
| 74 | POI:slideshow/Password_Protected-hello.ppt | 10,752 | PowerPoint (.ppt) | encrypted | hello |
| 75 | POI:slideshow/54880_chinese.ppt | 103,936 | PowerPoint (.ppt) | Chinese text | - |
| 76 | OCR:c03-29.pdf | 167,938 | scan (PD) | image-only scanned page, no text layer | public domain |
| 77 | OCR:skew.pdf | 76,013 | tiff2pdf | skewed scan | GFDL-1.2+ or CC-BY-SA-3.0 |
| 78 | OCR:acroform.pdf | 10,733 | Acrobat 19 | AcroForm (1 widget) + image | CC-BY-SA-4.0 |
| 79 | PDFBOX:AcroFormsBasicFields.pdf | 170,599 | Acrobat 10 | AcroForm, 29 widgets | Apache-2.0 |
| 80 | PDFJS:acroform_calculation_order.pdf | 1,041 | hand-written | field calculation order | Apache-2.0 repo |
| 81 | PDFJS:annotation-text-widget.pdf | 93,171 | LiveCycle ES9 | text widgets + JavaScript | provenance unclear |
| 82 | PDFJS:annotation-button-widget.pdf | 23,785 | LiveCycle ES9 | button/check/radio widgets | provenance unclear |
| 83 | VERA:PDF_A-2b/6.4%20Interactive%20forms/6.4.1%20General/veraPDF%20test%20suite%206-4-1-t02-pass-a.pdf | 5,418 | veraPDF | PDF/A-2b form (pass) | CC-BY-4.0 |
| 84 | VERA:PDF_UA-1/7.1%20General/7.1-t03-pass-b.pdf | 14,300 | veraPDF | tagged PDF/UA-1 (pass) | CC-BY-4.0 |
| 85 | PDF20:pdf20-utf8-test.pdf | 13,926 | by hand | PDF 2.0 UTF-8 strings | CC-BY-SA-4.0 |
| 86 | PDF20:Simple%20PDF%202.0%20file.pdf | 5,211 | by hand | minimal PDF 2.0 | CC-BY-SA-4.0 |
| 87 | IRS:fw9.pdf | 140,815 | Designer 6.5 | real-world AcroForm + XFA hybrid, 23 widgets | US Gov work |

Exclude from vendoring: POI domain-named crawled files, clusterfuzz files (malformed; use in a separate fuzz set only), `ChronologicalResume.dotx` (Office template content) and `cryptoapi-proc2356.ppt` (1.3 MB). `comment.docx` and `rtl.docx` are LibreOffice-made, not Office-made.

### C. Reference-only corpora (fetch on demand to a cache outside the repository, never commit)
| Corpus | Location | License status | Use |
|---|---|---|---|
| LibreOffice core qa | LibreOffice/core@9919c425 sw/qa/extras/ooxmlexport/data, sc/qa/unit/data/xlsx, sd/qa/unit/data/pptx | MPL repo; TDF Bugzilla attachments considered CC BY-SA 4.0 unless otherwise specified; older fdo#/i# files unknown | engine regression on pinned files |
| pdf.js full corpus | mozilla/pdf.js test/pdfs (+ .link) | no per-file license; .link files are external | renderer regression |
| govdocs1 by_type | digitalcorpora S3: docx.zip 29.0 MB/164, xlsx.zip 5.7 MB/39, pptx.zip 534 MB/220 | "to the best of our knowledge freely redistributed"; malware | sandboxed smoke tests |
| veraPDF full | 3,261 files, ~167 MB | CC BY 4.0 (confirm Isartor/TWG subfolders) | PDF/A and PDF/UA |
| OPF format-corpus | openpreserve/format-corpus | CC0 unless stated | legacy formats; fully-featured-pdf 22.7 MB |

### D. Tools (O=open/parse, D=display/render, E=edit, R=recalculate, S=save)
| Tool | Version (2026-09-28) | License | Capabilities | Role |
|---|---|---|---|---|
| LibreOffice (bundled engine) | 26.8 | MPL-2.0 | O D E R S | engine; PDF export for render tests |
| openpyxl | 3.1.5 | MIT | O E S (no R; data_only reads cached values) | XLSX read-back and generation |
| XlsxWriter | 3.2.9 | BSD-2-Clause | S only | fast XLSX generation, constant_memory |
| python-docx | 1.2.0 | MIT | O E S (no layout) | DOCX generation and read-back |
| python-pptx | 1.0.2 | MIT | O E S (no render) | PPTX generation and read-back |
| ExcelJS | 4.4.0 (last release 2023-10) | MIT | O E S (no R) | Node read-back |
| JSZip | 3.10.2 | MIT or GPL-3.0+ | raw zip | OPC integrity checks |
| pdfjs-dist + @napi-rs/canvas | 6.3.289 / 1.0.9 | Apache-2.0 / MIT | O D, text, forms, annotations | text extraction, rasterizing |
| pypdfium2 | 5.13.0 | BSD-3 / Apache-2.0 | O D, text | reference rasterizer |
| pypdf | 6.19.0 | BSD-3 | O E S | AcroForm read-back |
| pdf-lib / @cantoo/pdf-lib | 1.17.1 / 2.11.1 | MIT | O E S (no render) | PDF and form fixtures |
| reportlab | 5.0.1 | BSD | S | PDF fixtures, AcroForm, invariant |
| Pillow | 12.3.0 | MIT-CMU | image to PDF | scanned fixtures |
| msoffcrypto-tool | 6.0.0 | MIT | decrypt; encrypt OOXML (experimental) | password fixtures and checks |
| OOXML-Validator | 2.1.6 (win-x64.zip 43.6 MB) | MIT | schema validation | Open XML SDK validator |
| pixelmatch / odiff-bin | 7.2.0 / 4.5.0 | ISC / MIT | pixel diff | visual regression |
| qpdf | 12.4.2 | Apache-2.0 | structure check | `qpdf --check` |
| poppler pdftoppm | 26.09 (oschwartz10612 build, 43.7 MB) | GPL | D | optional cross-check (dev-only) |
| veraPDF | current | GPLv3+/MPLv2+ | validation | PDF/A and PDF/UA (needs Java) |
| PyMuPDF | 1.28.2 | AGPL-3.0 / commercial | O D E S | avoid, or use dev-only |
| reuse | 6.2.0 | GPL-3.0+ (tool) | license lint | fixture metadata in CI |

### E. Formula oracle (expected values independent of the engine)
| Formula | Expected | Note |
|---|---|---|
| =SUM(1,2,3) | 6 | |
| =ROUND(-2.5,0) | -3 | rounds half away from zero |
| =MOD(-3,2) | 1 | result takes the divisor's sign |
| =DATE(2024,2,29) | 45351 | 1900 date system serial |
| =DATE(2026,1,1) | 46023 | |
| =LEN("çğıİöşü") | 7 | |
| =UNICODE("ğ") / =UNICODE("İ") | 287 / 304 | |
| =UNICHAR(305) | ı | |
| =SUMPRODUCT({1,2,3},{4,5,6}) | 32 | |
| =IFERROR(1/0,"hata") | hata | |
| =DATE(1900,3,1)-DATE(1900,2,28) | Excel 2 (documented leap-year bug); LibreOffice 1 (inferred) | known divergence: assert per engine |
| =UPPER("ıi") in a tr-TR context | unknown for Excel | cannot verify without Office |

### F. What cannot be verified without Microsoft Office
| Area | Offline proxy we can run | Remaining gap |
|---|---|---|
| Opens without "repair" prompt | OPC checks + OOXML-Validator + comparing parts with Office-made originals | Office parser tolerance/strictness beyond the schemas (MS-OI29500 deviations) |
| Layout fidelity (line/page breaks, slide text fitting) | LibreOffice render vs our goldens; metric-compatible fonts | Word/PowerPoint layout engines; Aptos and other cloud fonts |
| Excel recalculation | cached Excel results in Office-made files as oracle; LibreOffice calculateAll | formulas we save are never recalculated by Excel; locale-sensitive functions; 1900 dates |
| VBA macros | byte-identical vbaProject.bin after round trip | whether Office trusts or runs the macros; VBA signatures |
| Charts, SmartArt, chartEx | part preservation + LibreOffice rendering | Office rendering; SmartArt staying editable |
| Encryption, signatures | msoffcrypto-tool decrypts our output; signature parts dropped or kept deliberately | Office acceptance and signature UI |
| Legacy .doc/.xls/.ppt output | re-read with LibreOffice/POI | Office acceptance |

## Risks
- Provenance risk in Apache POI/Tika/PDFBox/pdf.js test files: some came from bug reports or web crawls, so the Apache-2.0 label may not reflect the true rights holder. Mitigate with an allowlist (exclude domain-named and clusterfuzz files and MS templates), unmodified copies, LICENSE+NOTICE, and a per-file provenance manifest.
- Share-alike and attribution fixtures (pdf20examples CC BY-SA 4.0, OCRmyPDF acroform CC BY-SA 4.0, skew.pdf CC BY-SA 3.0/GFDL, veraPDF CC BY 4.0) must stay unmodified in a separate third_party folder with REUSE metadata. Modifying them triggers ShareAlike.
- LibreOffice trusts cached formula results for files whose app.xml says 'Microsoft…' or 'LibreOffice…'. openpyxl and XlsxWriter both claim 'Microsoft', its default OOXMLRecalcMode is 'never', and it ignores fullCalcOnLoad. Tests can pass or fail on stale values, and the product itself may show stale results to users. This is a data-integrity decision for the engine configuration.
- Fonts drive layout: Carlito/Caladea/Liberation are normally not installed system-wide on Windows, and LibreOffice has no Aptos substitute, so documents from Microsoft 365 (Aptos default) reflow. Golden images are machine-dependent unless test documents use only the bundled fonts and a substitution check is enforced.
- Visual goldens break on renderer upgrades (pdf.js, @napi-rs/canvas, PDFium) and on LibreOffice export changes (JPEG q90 default, non-embedded standard-14 fonts). Pin versions, set UseLosslessCompression/EmbedStandardFonts, and regenerate goldens only in deliberate PRs.
- Byte-level reproducibility is fragile: zip timestamps, core.xml dates and zlib/library versions change the bytes. Hash uncompressed part contents and normalize metadata instead of comparing zip bytes.
- Tool maintenance: pdf-lib has had no release since 2021-11; ExcelJS last released 2023-10; @xarsh/ooxml-validator was first published 2026-09-27 (immature). Prefer the upstream OOXML-Validator release, @cantoo/pdf-lib or reportlab.
- govdocs1 and other crawled corpora contain malware and third-party content. Never vendor them; open them only in a sandbox.
- The password for Open XML SDK encrypted_pptx.pptx is not documented. Use it only for 'encrypted file detected / password prompt / graceful failure' tests.
- Unauthenticated GitHub API use hit the 60 requests/hour limit during this research. CI must fetch fixtures via pinned raw URLs with sha256 checks and caching, not via the REST API.
- Compatibility claims could overreach: without Microsoft Office, pass results only show conformance to schemas, LibreOffice and open-source readers. Docs must not say 'fully compatible with Microsoft Office'.

## Recommendation
1) Corpus layout (repo):
- `tests/corpus/generated/`: self-authored, CC0, deterministic, regenerated in CI.
- `tests/corpus/third_party/<source>/`: the 87 allowlisted files from Table B, byte-for-byte, each source folder with its LICENSE/NOTICE.
- `tests/corpus/external.json`: reference-only corpora from Table C, fetched on demand to a cache folder outside the repository.
- Add a `REUSE.toml` with per-file SPDX entries and run `reuse lint` in CI.
- Add a `manifest.json` entry per file with: id, source repo + commit, URL, sha256 of the file, sha256 of each uncompressed part, SPDX license, copyright, generator (app.xml), feature tags, password and encryption type, and expected facts (page/slide/sheet counts, text snippets, formula results).

2) Generation (pin exact versions in a lock file):
- Python 3.12 venv: python-docx 1.2.0, python-pptx 1.0.2, openpyxl 3.1.5, XlsxWriter 3.2.9, reportlab 5.0.1, Pillow 12.3.0, msoffcrypto-tool 6.0.0, pypdf, pypdfium2 5.13.0.
- Node: @cantoo/pdf-lib (or pdf-lib 1.17.1) + @pdf-lib/fontkit.
- After every save, normalize: zip entries dated 1980-01-01 in original order, and fixed `dcterms:created/modified`. Hash the uncompressed parts. This recipe was verified during the research with openpyxl.
- Turkish content:
  - pangram "Pijamalı hasta yağız şoföre çabucak güvendi." and its uppercase "PİJAMALI HASTA YAĞIZ ŞOFÖRE ÇABUCAK GÜVENDİ."
  - casing pairs "ıIiİ" and place names (İstanbul, Iğdır, Şırnak)
  - `w:lang tr-TR` language tags
  - `[$-41F]` number formats
  - file paths containing Turkish characters
- PDFs must embed an OFL Unicode font such as Noto Sans or DejaVu. The standard-14 fonts are WinAnsi and cannot encode ğ, ş, ı or İ.
- Large fixtures:
  - 100k-row XLSX via openpyxl write_only or XlsxWriter constant_memory.
  - 300-page DOCX with explicit page breaks. Assert the page count via the LibreOffice PDF export, not app.xml.
  - 200-slide PPTX via python-pptx, reusing one image part.
  - Generate them in CI or in a local cache; do not commit them.
- Formula sheets: write formulas with no cached value (openpyxl) or a sentinel value, keep expected values in JSON (Table E), and assert after the engine recalculates and saves.
- Features the libraries cannot author (pivot tables via DataPilot, XLSX change tracking, PDF/A, password-protected OOXML via LibreOffice):
  - Generate once with LibreOffice UNO, using the bundled Python and an isolated `-env:UserInstallation` profile.
  - Commit the result as a static fixture with its hashes.
  - SmartArt, VBA and chartEx can only come from the Office-made fixtures.

3) Verification harness (all offline):
- L0 OPC: unique zip names, every relationship target exists, a content type for every part, XML well-formed.
- L1 schema: OOXML-Validator v2.1.6 win-x64 with the Office2019 and Microsoft365 profiles. Record baseline errors of the original fixture and fail only on new errors.
- L2 semantics: read back with openpyxl, python-docx, python-pptx and pypdf, and optionally ExcelJS. These only read; they are not an editing or recalculation engine.
- L3 preservation: diff the part inventory before and after open→save. Untouched parts (vbaProject.bin, customXml, embeddings, diagrams, chartEx, people/commentsExtended) must survive, byte-identical where not edited. Any dropped part is a test failure that lists the part.
- L4 text: LibreOffice PDF export, then pdf.js `getTextContent` or pypdfium2 text, compared with expected Turkish strings.
- L5 visual:
  - Export with an isolated profile and `{"UseLosslessCompression":true,"EmbedStandardFonts":true}`.
  - Rasterize at 96–150 DPI with pypdfium2 or pdf.js (pinned versions).
  - Compare with pixelmatch (threshold 0.1, includeAA=false, windowSize 16 with a pixel budget, or a page diff ratio ≤0.1% as a starting point) or odiff.
  - Store diff images as CI artifacts.
  - Build goldens with the same pipeline and update them only in explicit PRs.
- In the test profile, set `OOXMLRecalcMode=0` or call `calculateAll()` before reading any values.
- Check fonts in the exported PDF and fail on unexpected substitution. Use only bundled fonts (Liberation, Carlito, Caladea, DejaVu, Noto) in generated fixtures.

4) Engine: run every engine test with the chosen LibreOffice (26.8.x), with its bundled fonts in share/fonts/truetype. Keep caches, external corpora and large generated files outside the repository. This workstream needs under 0.5 GB.

5) Honest docs wording.
- EN: "Files are opened, edited and saved by the bundled LibreOffice <version> engine. Automated tests check our output with independent open-source tools (Open XML SDK validator, openpyxl, python-docx, python-pptx, PDF.js) and with LibreOffice/PDF.js rendering comparisons. We do not test with Microsoft Office. A file that passes our tests may still look or behave differently in Microsoft Word, Excel or PowerPoint, and Excel may calculate some formulas differently. Please report such cases."
- TR: "Dosyalar, uygulamayla gelen LibreOffice <sürüm> motoruyla açılır, düzenlenir ve kaydedilir. Otomatik testlerimiz çıktılarımızı bağımsız açık kaynak araçlarla (Open XML SDK doğrulayıcısı, openpyxl, python-docx, python-pptx, PDF.js) ve LibreOffice/PDF.js görüntü karşılaştırmalarıyla denetler. Microsoft Office ile test yapmıyoruz. Testlerimizden geçen bir dosya Word, Excel veya PowerPoint'te farklı görünebilir ya da davranabilir; Excel bazı formülleri farklı hesaplayabilir. Lütfen bu tür durumları bildirin."
- Never write "fully/100% compatible with Microsoft Office" or "tested in Office".
- If a maintainer ever spot-checks in real Office, label it as manual, with Office version, build and date, and keep it out of the CI claims.

## Facts
- [high] Apache POI switched from Subversion to Git in July 2025; primary gitbox repo with GitHub mirror github.com/apache/poi (branch trunk). Legacy SVN https://svn.apache.org/repos/asf/poi/trunk/test-data/ still returns HTTP 200. (https://poi.apache.org/devel/git.html)
- [high] POI test-data at commit 581a4cba5973743e35482163c8848ced8b7ae4f0 contains ~1,690 entries (spreadsheet 832, document 317, slideshow 278 files, plus poifs, xmldsign, integration, etc.). (https://api.github.com/repos/apache/poi/git/trees/trunk?recursive=1)
- [medium] POI's LICENSE has no separate terms for test-data, and the POI source distribution task does not exclude test-data, so test files ship under the repo's Apache-2.0 (with POI NOTICE). (https://raw.githubusercontent.com/apache/poi/trunk/legal/LICENSE ; https://raw.githubusercontent.com/apache/poi/trunk/build.gradle)
- [medium] POI test-data includes third-party files crawled from the web or taken from bug reports (e.g. document/au.edu.utas.www___...International-Travel-Approval-Request-Form.doc, document/ca.kwsymphony.www_...doc, document/bib-chernigovka.netdo.ru_...docx, spreadsheet/0-www-crossref-org...xlsm, slideshow/at.ecodesign.www_...pptx); their copyright is not the ASF's, so they should be excluded from a vendored corpus. (https://github.com/apache/poi/tree/trunk/test-data)
- [high] POI documents sample passwords in test-data/poi-integration-exceptions.csv: spreadsheet/protected_passtika.xlsx=tika; poifs/protect.xlsx=VelvetSweatshop; poifs/60320-protected.xlsx=Test001!!; poifs/protected_sha512.xlsx='this is a test'; document/bug53475-password-is-pass.docx=pass; document/password_tika_binaryrc4.doc=tika; document/password_password_cryptoapi.doc=password; spreadsheet/password.xls=password; spreadsheet/xor-encryption-abc.xls=abc; slideshow/Password_Protected-hello.ppt=hello; slideshow/cryptoapi-proc2356.ppt=crypto. (https://raw.githubusercontent.com/apache/poi/trunk/test-data/poi-integration-exceptions.csv)
- [high] POI Decryptor.DEFAULT_PASSWORD is "VelvetSweatshop" (Excel's built-in default encryption password). (https://raw.githubusercontent.com/apache/poi/trunk/poi/src/main/java/org/apache/poi/poifs/crypt/Decryptor.java)
- [high] Parse of the EncryptionInfo streams: Agile v4.4 = POI bug53475-password-is-pass.docx (AES-256/SHA-1), POI poifs/protected_sha512.xlsx (AES-256/SHA-512), Open XML SDK encrypted_pptx.pptx (AES-256/SHA-512, spinCount 100000; password undocumented). Standard v3.2 = POI poifs/protect.xlsx and poifs/extenxls_pwd123.xlsx. Standard v4.2 = POI spreadsheet/protected_passtika.xlsx and Tika testWORD/testPPT/testEXCEL_protected_passtika.*. (inspection of files downloaded from the pinned raw URLs (POI 581a4cb, Tika 162f939, Open-XML-SDK 431ab05))
- [high] By docProps/app.xml, most selected POI OOXML samples were saved by Microsoft Word/Excel/PowerPoint 12.0–16.0 (including Mac builds). Exceptions: document/comment.docx (LibreOffice 6.0.7.3), document/rtl.docx (LibreOffice 24.2.7.2, Arabic RTL) and Tika testWORD_various.docx (LibreOffice 5.3.1.2). (inspection of https://raw.githubusercontent.com/apache/poi/581a4cba5973743e35482163c8848ced8b7ae4f0/test-data/ files)
- [high] POI document/delins.docx (Word 2007) contains 32 w:ins and 4 w:del tracked changes. (https://raw.githubusercontent.com/apache/poi/581a4cba5973743e35482163c8848ced8b7ae4f0/test-data/document/delins.docx)
- [high] POI spreadsheet/FormulaEvalTestData_Copy.xlsx (Excel 2013, calcId 152511) has 4 sheets, 1,295 formula cells and 1,268 Excel-cached results, so it can serve as a recalculation oracle. (https://raw.githubusercontent.com/apache/poi/581a4cba5973743e35482163c8848ced8b7ae4f0/test-data/spreadsheet/FormulaEvalTestData_Copy.xlsx)
- [high] None of the inspected POI, Tika, Open XML SDK or python-docx/python-pptx/openpyxl samples contains Turkish-specific letters (ğ ş ı İ). Non-ASCII content found: Latin accents, Japanese (with_japanese.pptx), Chinese (54880_chinese.ppt), Greek (Complex01.docx), CJK (mailmerge.docx), Arabic (LibreOffice-made rtl.docx). (inspection of the downloaded samples)
- [high] The Open XML SDK repository is MIT (Copyright .NET Foundation and Contributors). Its TestFiles include Office-generated Complex01.docx (Word 2013: comments, charts, SmartArt, footnotes, headers/footers, 32 content controls, 8 tracked deletions, embedded objects, Greek text), Strict01.docx (same content, ISO Strict), Complex01.xlsx, svg.docx, Of16-01.docx/.pptx, animation.pptx, Revision_NameCommentChange.xlsx and encrypted_pptx.pptx. (https://raw.githubusercontent.com/dotnet/Open-XML-SDK/431ab05cf160248cc3885a4a766026d4f8243792/LICENSE)
- [high] python-docx 1.2.0 (2025-06-16, MIT) added comment support. Its feature test files were saved by Word 2016 or Mac Word 2011. (https://raw.githubusercontent.com/python-openxml/python-docx/e45454602b53e8e572b179ccf1c91093ec9f4ed7/HISTORY.rst)
- [high] python-pptx's canonical repository is github.com/scanny/python-pptx (github.com/python-openxml/python-pptx returned 404 on 2026-09-28). The latest release is 1.0.2 (MIT, 2024-08-07), and its test files were saved by Mac PowerPoint 2011/2016. (https://pypi.org/pypi/python-pptx/json)
- [high] openpyxl 3.1.5 (MIT, 2024-06-28) is hosted at foss.heptapod.net/openpyxl/openpyxl. The repo has 38 xlsx/xlsm test files, mostly Excel-generated (Win/Mac). (https://foss.heptapod.net/api/v4/projects/322/repository/tree)
- [high] openpyxl provides read/preserve support for pivot tables only and does not let client code create them. Write-only mode keeps memory under ~10 MB, supports append() only and can be saved once. (https://openpyxl.readthedocs.io/en/stable/pivot.html ; https://openpyxl.readthedocs.io/en/stable/optimized.html)
- [high] The TDF Bugzilla footer states that all contributions are 'considered to be released under the Creative Commons Attribution-ShareAlike 4.0 International License, unless otherwise specified'; source-form contributions such as patches fall under MPL-2.0. (https://bugs.documentfoundation.org/)
- [medium] LibreOffice core has large OOXML qa sets (sc/qa/unit/data/xlsx at least 608 files, sw/qa/extras/ooxmlexport/data at least 2,000, sd/qa/unit/data/pptx at least 810). Many files are named after bug reports. (https://github.com/LibreOffice/core/tree/master/sw/qa/extras/ooxmlexport/data)
- [high] The veraPDF corpus is licensed CC BY 4.0 (README). The staging branch at bb75f4f has 3,261 entries, about 167 MB. (https://github.com/veraPDF/veraPDF-corpus/blob/staging/README.md)
- [high] PDF Association pdf20examples are licensed CC BY-SA 4.0 (LICENSE.md). (https://raw.githubusercontent.com/pdf-association/pdf20examples/master/LICENSE.md)
- [high] OCRmyPDF licenses its test resources per file via REUSE.toml: c03-29.pdf and multipage.pdf are public domain (Project Gutenberg scan); linn/skew/ccitt/jbig2/cardinal PDFs are GFDL-1.2-or-later OR CC-BY-SA-3.0; acroform.pdf and francais.pdf are CC-BY-SA-4.0. (https://raw.githubusercontent.com/ocrmypdf/OCRmyPDF/main/REUSE.toml)
- [medium] The pdf.js test/pdfs .gitignore whitelists about 957 committed PDFs; other PDFs are referenced via external .link files. No per-file license statement was found (repo is Apache-2.0). (https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/.gitignore)
- [high] OPF format-corpus: 'All items are CC0 licenced unless otherwise stated'. office-examples mainly covers OpenOffice/LibreOffice/legacy formats; fully-featured-pdf is 22.7 MB and built from Google Docs. (https://github.com/openpreserve/format-corpus)
- [high] govdocs1 is described as 'freely available for research and may be (to the best of our knowledge) freely redistributed'. It contains malware that will not be removed. The S3 by_type archives are docx.zip 29.0 MB (164 files), xlsx.zip 5.7 MB (39), pptx.zip 534 MB (220). (https://digitalcorpora.org/corpora/file-corpora/files/ ; https://digitalcorpora.s3.amazonaws.com/corpora/files/govdocs1/by_type/docx.zip)
- [medium] The IRS fw9.pdf is an AcroForm+XFA hybrid (Producer 'Designer 6.5', 23 widgets). IRS forms are US federal government works (public domain in the US). (https://www.irs.gov/pub/irs-pdf/fw9.pdf ; https://www.irs.gov/irm/part1/irm_01-017-008)
- [high] PDFBox AcroFormsBasicFields.pdf (Adobe Acrobat 10, 29 widgets) and pdf.js annotation-text-widget.pdf (LiveCycle Designer ES 9, 13 widgets, JavaScript) are real AcroForm samples. pdf.js acroform_calculation_order.pdf is a 1 KB hand-written form. (https://raw.githubusercontent.com/apache/pdfbox/b29f6d6f995f0aa0602e9c3b55031f295920d354/pdfbox/src/test/resources/org/apache/pdfbox/pdmodel/interactive/form/AcroFormsBasicFields.pdf)
- [high] LibreOffice's OOXMLRecalcMode defaults to 1 ('Recalc never') for Excel 2007+ files. (https://raw.githubusercontent.com/LibreOffice/core/master/officecfg/registry/schema/org/openoffice/Office/Calc.xcs)
- [high] LibreOffice treats an XLSX as coming from a 'known good generator' when docProps Application starts with 'Microsoft' or 'LibreOffice', and then trusts cached formula results. A hard recalculation happens only for other generators whose cached results are all 0 or absent. (https://raw.githubusercontent.com/LibreOffice/core/master/sc/source/filter/oox/workbookhelper.cxx ; https://raw.githubusercontent.com/LibreOffice/core/master/sc/source/filter/oox/workbookfragment.cxx)
- [high] LibreOffice's XLSX import (WorkbookSettings::importCalcPr) does not read the calcPr fullCalcOnLoad attribute. (https://raw.githubusercontent.com/LibreOffice/core/master/sc/source/filter/oox/workbooksettings.cxx)
- [high] openpyxl writes Application 'Microsoft Excel Compatible / Openpyxl <version>' and calcPr fullCalcOnLoad=True (calcId 124519). XlsxWriter writes Application 'Microsoft Excel', stores 0 as the formula result and sets fullCalcOnLoad. (https://foss.heptapod.net/openpyxl/openpyxl/-/raw/branch/default/openpyxl/packaging/extended.py ; https://raw.githubusercontent.com/jmcnamara/XlsxWriter/main/xlsxwriter/app.py)
- [high] The XlsxWriter FAQ says LibreOffice doesn't recalculate Excel formulas that reference other cells by default, so they show XlsxWriter's 0. The workaround is 'Recalculation on File Load: Always recalculate' or writing a blank cached result. (https://raw.githubusercontent.com/jmcnamara/XlsxWriter/main/dev/docs/source/faq.rst)
- [high] XlsxWriter fixes zip entry timestamps to 1980-01-01 (in-memory mode) or 1980-01-31 (temp files). docProps created defaults to now unless set via set_properties({'created': ...}). (https://raw.githubusercontent.com/jmcnamara/XlsxWriter/main/xlsxwriter/workbook.py)
- [high] python-docx and python-pptx write zip entries with ZipFile.writestr(name, blob). Per the Python docs, the entry date and time are then set to the current time, so output is not byte-reproducible without post-processing. (https://docs.python.org/3/library/zipfile.html#zipfile.ZipFile.writestr)
- [high] Measured during the research: openpyxl write-only built a 100,000-row × 5-column Turkish XLSX with formulas in 3.4 s (3.47 MB). Two runs differed only in zip timestamps and dcterms:modified (openpyxl overwrites modified at save). Normalizing both (fixed zip metadata and core.xml dates) gave byte-identical files. (experiment with a generator and a normalizer script)
- [medium] The reportlab Canvas has an 'invariant' parameter (defaulting to rl_config.invariant) for repeatable output, and canvas.acroForm creates textfield/checkbox/radio/choice/listbox widgets. (https://learn.schrodinger.com/public/python_api/2022-1/_modules/reportlab/pdfgen/canvas.html ; https://docs.reportlab.com/reportlab/userguide/ch4_pdffeatures/)
- [high] pdf-lib 1.17.1 was last published 2021-11-06. Its standard fonts use WinAnsi encoding (except Symbol/ZapfDingbats), and PDFDocument.create/load accept updateMetadata. The maintained fork @cantoo/pdf-lib 2.11.1 was published 2026-09-15 (MIT). (https://raw.githubusercontent.com/Hopding/pdf-lib/93dd36e85aa659a3bca09867d2d8fac172501fbe/src/core/embedders/StandardFontEmbedder.ts)
- [high] Pillow's PDF writer sets creationDate/modDate to time.gmtime() unless they are passed explicitly. (https://raw.githubusercontent.com/python-pillow/Pillow/main/src/PIL/PdfImagePlugin.py)
- [high] msoffcrypto-tool 6.0.0 (MIT) decrypts ECMA-376 Agile/Standard and Office binary RC4/RC4 CryptoAPI. Encryption is OOXML-only and marked experimental. (https://raw.githubusercontent.com/nolze/msoffcrypto-tool/master/README.md)
- [high] pdfjs-dist 6.3.289 (Apache-2.0) needs Node >=22.13 and has an optional dependency on @napi-rs/canvas. The official Node example examples/node/pdf2png/pdf2png.mjs renders pages to PNG using cMapUrl and standardFontDataUrl. (https://registry.npmjs.org/pdfjs-dist/6.3.289 ; https://github.com/mozilla/pdf.js/blob/master/examples/node/pdf2png/pdf2png.mjs)
- [high] pixelmatch 7.2.0 (ISC): threshold defaults to 0.1, includeAA defaults to false (anti-aliased pixels ignored), and the new windowSize option returns the maximum diff count in any N×N window to suppress scattered noise. (https://raw.githubusercontent.com/mapbox/pixelmatch/main/README.md)
- [high] odiff-bin 4.5.0 (MIT) supports png/jpeg/webp/tiff, anti-aliasing detection, ignoreRegions, a threshold option and failOnLayoutDiff. (https://raw.githubusercontent.com/dmtrKovalenko/odiff/main/README.md)
- [high] pypdfium2 5.13.0 (BSD-3-Clause / Apache-2.0) ships a 3.9 MB win_amd64 wheel. (https://pypi.org/pypi/pypdfium2/json)
- [high] OOXML-Validator v2.1.6 (MIT, uses the Open XML SDK OpenXmlValidator) publishes win-x64.zip (43.6 MB, 2024-12-12) and targets Office2007…Microsoft365. The npm wrapper @xarsh/ooxml-validator 0.4.0 (MIT) was first published 2026-09-27. (https://github.com/mikeebowen/OOXML-Validator/releases/tag/v2.1.6 ; https://registry.npmjs.org/@xarsh/ooxml-validator)
- [high] LibreOffice PDF export defaults: UseLosslessCompression=false (JPEG Quality=90), EmbedStandardFonts=false, ExportFormFields=true, UseTaggedPDF=false. (https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html)
- [high] The LibreOffice CLI supports --headless, --convert-to ext[:filter[:params]] with --outdir, and -env:UserInstallation=file:///... for an isolated profile. JSON filter options (e.g. PageRange) on the command line arrived in 7.4. (https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html ; https://vmiklos.hu/blog/pdf-convert-to.html)
- [high] LibreOffice on Windows registers its bundled fonts from $BRAND_BASE_DIR/share/fonts/truetype privately (AddFontResourceExW with FR_PRIVATE), so they are not visible to other processes such as Electron. (https://raw.githubusercontent.com/LibreOffice/core/master/vcl/win/gdi/salfont.cxx)
- [high] LibreOffice's font replacement table maps calibri<->carlito and cambria<->caladea but has no entry for Aptos. (https://raw.githubusercontent.com/LibreOffice/core/master/officecfg/registry/data/org/openoffice/VCL.xcu)
- [high] Microsoft documents that Excel treats 1900 as a leap year for Lotus 1-2-3 compatibility, so date arithmetic before 1900-03-01 differs from the true calendar. (https://learn.microsoft.com/en-us/troubleshoot/microsoft-365-apps/excel/wrongly-assumes-1900-is-leap-year)
- [high] [MS-OI29500] documents where Office varies from or extends ISO/IEC 29500. It is a guide, not a substitute for testing in Office. (https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/1fd4a662-8623-49c0-82f0-18fa91b413b8)
- [high] All 87 curated URLs listed in the tables returned HTTP 200 (HEAD or GET) on 2026-09-28. The curated set totals 6.34 MB. (pinned raw URLs in the tables)
