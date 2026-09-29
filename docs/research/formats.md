# LibreOffice engine per-format capability matrix (ground truth: git tag libreoffice-26.8.0.3 filter/type fragments + read-only parse of the LibreOffice 26.2.6.3 registry .xcd files, verified against 26.8.0.3 source, Bugzilla and 26.8 help)

> Research notes of 2026-09-28 on the per-format capabilities of the LibreOffice engine, prepared before the architecture decision and published
> with details about the research machine removed. Findings age quickly: check the linked sources before relying
> on a version number, a price, a bug status or a release date. Decisions are recorded in [docs/adr](../adr/README.md).

## Summary
**Sources inspected.** Two sources were used:
- the writer/calc/impress/draw/pdfimport/main `.xcd` files of a LibreOffice 26.2.6.3 administrative image (build 8221e31…), parsed read-only;
- all 247 filter and 188 type fragments at git tag `libreoffice-26.8.0.3`. These fragments are what the 26.8.0.3 `.xcd` files are built from.

For the 27 target formats the two versions are identical, with one exception: 26.8 adds the ISO macro-enabled filters `Office Open XML Text VBA` and `Calc Office Open XML VBA` and makes them the preferred DOCM/XLSM types. I confirmed runtime behaviour in the 26.8.0.3 source (oox detection and export, sw/sc/sd exporters, crypto), in Bugzilla (REST API) and in help.libreoffice.org 26.8. I could not read the wiki release notes: they sit behind a bot-check wall (Anubis) that I didn't try to get past.

**What the filter matrix shows**
- **Opening:** every target format opens.
- **Saving back in the same format:** works for all of them except five.
  - XLSB has an import-only filter.
  - DOTM, XLTM, POTM and PPSM have no stock filter that combines "macro-enabled" with template or slideshow. Saving them writes the macro-free content type and drops the macros.
- **PDF:** "opening" converts the PDF into Draw shapes through `xpdfimport.exe`, which is built on Poppler (GPL-2.0). "Saving" writes a brand-new PDF.
- **Two OOXML dialects per application:**
  - The "MS … 2007" filters write ECMA-376 1st edition (FileFormatVersion 0).
  - The "Office Open XML …" filters write ISO/IEC 29500:2008 Transitional (FileFormatVersion 1).
  - When opening a file, the detector chooses the ISO type when a Word file has compatibilityMode above 12, an Excel file has lowestEdited above 4, or the file is Strict.
  - PPTX is always detected as the ECMA type.
  - Strict files can be imported but never saved as Strict (tdf#149658).
- **Macros in macro-enabled files:**
  - DOCM and PPTM keep the original `vbaProject.bin` byte for byte, but only when saved with a VBA filter.
  - XLSM macros are rebuilt from the imported modules by LibreOffice's VBA exporter, not copied.
  - Default settings: VBA Load, Executable and Save are all on for Writer and Calc. Impress only has Load and Save; PowerPoint macros never run. Macro security level defaults to 2 (High).
- **Slideshow files:** the PPS/PPSX filters carry the STARTPRESENTATION flag. Loading a file with them starts the slideshow immediately.
- **Templates:** they open as a new untitled document unless `AsTemplate=false` is passed.
- **Passwords:**
  - OOXML: LibreOffice opens both Microsoft encryption schemes: the older "Standard" one and the "Agile" one (AES-128/192/256). It saves only with Standard encryption (AES-128/SHA-1).
  - DOC and XLS: it opens the XOR, RC4 and RC4 CryptoAPI schemes and saves with RC4.
  - PPT: it can neither open nor save a password-protected file.
  - Rights-managed (IRM/DRM) files cannot be opened at all.
- **ODF:** new files are saved as ODF 1.4 Extended by default.

**Feature fidelity (26.8)**
- **Supported, with known bugs:** tracked changes, comments and DOCX comment replies, content controls, equations (OMML ↔ Math in DOCX; in PPTX only whole-object equations), sparklines, pivot tables, external links, embedded fonts (DOCX/PPTX), standard MS Forms ActiveX controls, OLE conversion, animations.
- **Kept on save but not editable:**
  - SmartArt: by default the original is kept and its fallback drawing is displayed.
  - Office 2016+ charts (waterfall, treemap, sunburst, funnel and similar): basic save-and-reload support for all these types since 26.2.0.2, but they are **not drawn**. Pareto export is incomplete (tdf#165742).
- **Only in 26.8:** Excel threaded comments survive open and save, but they show as ordinary notes with no reply UI. The 26.2.6 binaries have no threaded-comment code, so there they collapse into plain notes.
- **Not supported or lost on save:** slicers, timelines, Power Query, the Morph transition, ink, PowerPoint 3D models (a fallback picture is kept instead), IRM, and equations inline in PPTX text.

**CSV and plain text**
- The CSV option string has 15 tokens. Their order in the source (`asciiopt.cxx`) matches the help page.
- If no options are passed through the API, CSV defaults to UTF-8, comma separator and double quotes. That is wrong for Turkish data, so options must always be passed.
- Token 6 (language) only affects import.
- The 26.8 source also accepts an undocumented `DETECT` value for the separator and the character set.
- "Text (encoded)" options take the form `charset,lineend,font,langtag,BOM,hidden`.

**Fonts**
- LibreOffice bundles metric-compatible substitutes: Carlito for Calibri, Caladea for Cambria, Liberation for Arial / Times New Roman / Courier New.
- There is no substitute for **Aptos**, the newer Office default font.
- In the admin image the bundled fonts are in a top-level `Fonts` folder, because the normal installer puts them in the system font folder. A portable LibreOffice only picks up fonts from `share\fonts\truetype` (plus its internal OpenSymbol), so these fonts will not be used until they are copied there.

## Tables
### 1. Per-format matrix
Flags are exact strings from the 26.8.0.3 fragments. They are identical in the 26.2.6.3 `.xcd` files unless marked. "Auto" means the oox/Plain/Storage detector picks the type; the "Export FilterName" column holds exact `storeToURL` FilterName strings.

| Fmt | Type name(s) | Import filter | Export FilterName | Flags | Open / Save same / Convert | Notes |
|---|---|---|---|---|---|---|
| DOCX | `writer_MS_Word_2007` (ECMA), `writer_OOXML` (ISO, preferred) | auto → `MS Word 2007 XML` or `Office Open XML Text` | `Office Open XML Text` (FFV 1 = ISO 29500 Transitional; UI "Word 2010–365 Document") or `MS Word 2007 XML` (FFV 0 = ECMA-376 1st ed.; UI "Word 2007") | IMPORT EXPORT ALIEN 3RDPARTYFILTER ENCRYPTION PASSWORDTOMODIFY SUPPORTSSIGNING | Y / Y / Y | ISO chosen if compatibilityMode > 12 or file is Strict |
| DOC | `writer_MS_Word_97` (doc wps); import-only: `MS Word 95`, `MS WinWord 6.0`, `MS WinWord 5`, `DosWord`, `Mac_Word` | `MS Word 97` | `MS Word 97` | IMPORT EXPORT ALIEN PREFERRED ENCRYPTION PASSWORDTOMODIFY | Y / Y / Y | Password save = RC4. `.dot` = `MS Word 97 Vorlage` (TEMPLATE TEMPLATEPATH) |
| DOCM | `writer_MS_Word_2007_VBA`; 26.8 adds `writer_OOXML_VBA` (preferred) | auto (macroEnabled content type or `.docm` name) | `MS Word 2007 XML VBA`; 26.8 only: `Office Open XML Text VBA` (FFV 1) | IMPORT EXPORT ALIEN 3RDPARTYFILTER ENCRYPTION PASSWORDTOMODIFY SUPPORTSSIGNING | Y / Y / Y | Only a filter name ending in "VBA" writes vbaProject.bin (original bytes); other DOCX filters drop macros and warn |
| DOTX | `writer_MS_Word_2007_Template` (dotx dotm), `writer_OOXML_Text_Template` (preferred) | auto | `Office Open XML Text Template` or `MS Word 2007 XML Template` | IMPORT EXPORT ALIEN 3RDPARTYFILTER TEMPLATE TEMPLATEPATH | Y / Y / Y | Opens as untitled unless AsTemplate=false; no ENCRYPTION flag |
| DOTM | same template types | auto | none macro-enabled (template filters write dotx content type) | n/a | Y / **N (VBA dropped)** / Y | Needs a TEMPLATE + VBA filter, which the stock config lacks |
| RTF | `writer_Rich_Text_Format` | `Rich Text Format` (Calc: `Rich Text Format (StarCalc)` = IMPORT ALIEN) | `Rich Text Format` | IMPORT EXPORT ALIEN 3RDPARTYFILTER PREFERRED | Y / Y / Y | |
| TXT | `generic_Text` (csv tsv tab txt) | `Text` (auto charset/BOM) or `Text (encoded)` + options; Calc CSV filter | `Text (encoded)` + FilterOptions (or `Text`) | IMPORT EXPORT ALIEN (`Text` also PREFERRED) | Y / Y / Y | Options in table 4 |
| ODT | `writer8`; `.fodt` `writer_ODT_FlatXML`; `.ott` `writer8_template` | `writer8` | `writer8` / `OpenDocument Text Flat XML` / `writer8_template` | IMPORT EXPORT TEMPLATE OWN DEFAULT PREFERRED ENCRYPTION PASSWORDTOMODIFY GPGENCRYPTION | Y / Y / Y | Default ODF 1.4 Extended |
| XLSX | `MS Excel 2007 XML` (ECMA), `Office Open XML Spreadsheet` (ISO, preferred) | auto | `Calc Office Open XML` (FFV 1; "Excel 2010–365 Spreadsheet") or `Calc MS Excel 2007 XML` (FFV 0; "Excel 2007") | IMPORT EXPORT ALIEN 3RDPARTYFILTER PREFERRED ENCRYPTION PASSWORDTOMODIFY SUPPORTSSIGNING | Y / Y / Y | ISO chosen if lowestEdited > 4 or file is Strict |
| XLS | `calc_MS_Excel_97` (xls xlc xlm xlw xlk et); import-only: `MS Excel 95`, `MS Excel 5.0/95`, `MS Excel 4.0` | `MS Excel 97` | `MS Excel 97` | IMPORT EXPORT ALIEN PREFERRED ENCRYPTION PASSWORDTOMODIFY | Y / Y / Y | `.xlt` = `MS Excel 97 Vorlage/Template`. Password save = RC4 |
| XLSM | `MS Excel 2007 VBA XML`; 26.8 adds `Office Open XML Spreadsheet VBA` (preferred) | auto | `Calc MS Excel 2007 VBA XML` (UserData macro-enabled); 26.8 only: `Calc Office Open XML VBA` (FFV 1) | IMPORT EXPORT ALIEN 3RDPARTYFILTER PREFERRED ENCRYPTION PASSWORDTOMODIFY (+SUPPORTSSIGNING only on the 26.8 ISO filter) | Y / Y / Y | VBA regenerated from modules (VbaExport), not byte-copied |
| XLSB | `MS Excel 2007 Binary` | `Calc MS Excel 2007 Binary` | **none** | IMPORT ALIEN 3RDPARTYFILTER PREFERRED | Y / **N** / Y (to XLSX/ODS/PDF/CSV) | Import only |
| XLTX | `MS Excel 2007 XML Template` (xltx xltm), `Office Open XML Spreadsheet Template` (preferred) | auto | `Calc Office Open XML Template` or `Calc MS Excel 2007 XML Template` | IMPORT EXPORT ALIEN 3RDPARTYFILTER TEMPLATE TEMPLATEPATH | Y / Y / Y | |
| XLTM | same template types | auto | none macro-enabled | n/a | Y / **N (VBA dropped)** / Y | |
| CSV | `generic_Text` | `Text - txt - csv (StarCalc)` (+ `Orcus CSV` IMPORT-only) | `Text - txt - csv (StarCalc)` | IMPORT EXPORT ALIEN (options dialog as UIComponent) | Y / Y (one sheet) / Y | API default with no options: UTF-8, `,`, `"` |
| TSV | `generic_Text` (tsv tab) | same, options `9,34,76,…` | same, `9,34,76,…` | same | Y / Y / Y | No dedicated filter |
| ODS | `calc8`; `.fods` `calc_ODS_FlatXML`; `.ots` `calc8_template` | `calc8` | `calc8` | IMPORT EXPORT TEMPLATE OWN DEFAULT ENCRYPTION PASSWORDTOMODIFY GPGENCRYPTION | Y / Y / Y | |
| PPTX | `MS PowerPoint 2007 XML` (always picked by the detector), `Office Open XML Presentation` | `Impress MS PowerPoint 2007 XML` | `Impress MS PowerPoint 2007 XML` (FFV 0; "PowerPoint 2007–365") or `Impress Office Open XML` (FFV 1) | IMPORT EXPORT ALIEN 3RDPARTYFILTER PREFERRED ENCRYPTION PASSWORDTOMODIFY (+SUPPORTSSIGNING only on the MS filter) | Y / Y / Y | |
| PPT | `impress_MS_PowerPoint_97` (ppt dps); `impress_PowerPoint3` (MWAW, PowerPoint 1–4/95, import-only) | `MS PowerPoint 97` | `MS PowerPoint 97` | IMPORT EXPORT ALIEN (**no ENCRYPTION**) | Y (not if encrypted) / Y / Y | `.pot` = `MS PowerPoint 97 Vorlage` |
| PPTM | `MS PowerPoint 2007 XML VBA` | auto | `Impress MS PowerPoint 2007 XML VBA` (UserData macro-enabled) | IMPORT EXPORT ALIEN 3RDPARTYFILTER PREFERRED ENCRYPTION PASSWORDTOMODIFY SUPPORTSSIGNING | Y / Y / Y | Original vbaProject.bin copied back; never executed |
| PPS | `impress_MS_PowerPoint_97_AutoPlay` | `MS PowerPoint 97 AutoPlay` | `MS PowerPoint 97 AutoPlay` | IMPORT EXPORT ALIEN STARTPRESENTATION | Y (slideshow auto-starts) / Y / Y | Load with `MS PowerPoint 97` to edit |
| PPSX | `MS PowerPoint 2007 XML AutoPlay`, `Office Open XML Presentation AutoPlay` | auto | `Impress MS PowerPoint 2007 XML AutoPlay` or `Impress Office Open XML AutoPlay` | IMPORT EXPORT ALIEN 3RDPARTYFILTER PREFERRED STARTPRESENTATION ENCRYPTION PASSWORDTOMODIFY | Y (slideshow auto-starts) / Y / Y | The flag also sets the slideshow content type on export |
| PPSM | no type lists `.ppsm`; content type → `MS PowerPoint 2007 XML AutoPlay` | auto (content-type detection) | none macro-enabled | n/a | Y / **N (VBA dropped)** / Y | |
| POTX | `MS PowerPoint 2007 XML Template` (potx potm), `Office Open XML Presentation Template` (preferred) | auto | `Impress MS PowerPoint 2007 XML Template` or `Impress Office Open XML Template` | IMPORT EXPORT ALIEN 3RDPARTYFILTER TEMPLATE TEMPLATEPATH PREFERRED | Y / Y / Y | |
| POTM | same template types | auto | none macro-enabled | n/a | Y / **N (VBA dropped)** / Y | |
| ODP | `impress8`; `.fodp` `impress_ODP_FlatXML`; `.otp` `impress8_template` | `impress8` | `impress8` | IMPORT EXPORT TEMPLATE OWN DEFAULT PREFERRED ENCRYPTION PASSWORDTOMODIFY GPGENCRYPTION | Y / Y / Y | |
| PDF | `pdf_Portable_Document_Format` (PDFDetector; preferred filter `draw_pdf_import`) | `draw_pdf_import` (3RDPARTYFILTER ALIEN IMPORT PREFERRED SUPPORTSSIGNING), `impress_pdf_import`, `writer_pdf_import` (Poppler-based xpdfimport); hybrid PDF → `writer/calc/impress/draw_pdf_addstream_import` (IMPORT NOTINFILEDIALOG) | `writer_pdf_Export`, `calc_pdf_Export`, `impress_pdf_Export`, `draw_pdf_Export` (EXPORT ALIEN 3RDPARTYFILTER) | see previous columns | Open = conversion into shapes / Save = regenerated PDF / Convert = Y | FilterData `IsAddStream=true` makes a hybrid PDF; SelectPdfVersion 0,1,2,3,4,15,16,17,20 |

### 2. Feature fidelity (26.8.0.3 unless noted)
| Feature | Word | Excel | PowerPoint | Evidence |
|---|---|---|---|---|
| VBA | Load, Exec and Save on by default; DOCM keeps original vbaProject.bin only via a "*VBA" filter; runs a subset of VBA (VBASupport) | Load, Exec and Save on; XLSM VBA regenerated; best object-model coverage | Load and Save only (never runs); PPTM passthrough | main.xcd; docxexport/xestream/pptx-epptooxml; help 01130100 |
| Macro-enabled templates/shows | DOTM → macros dropped | XLTM → dropped | POTM, PPSM → dropped | filter config |
| ActiveX | MS Forms 2.0 → form controls; DOCX export yes | imported; form controls exported (tdf#119060, tdf#133999) | imported; no ActiveX export code found (low) | axcontrol.hxx; docxattributeoutput.cxx |
| Embedded OLE | Word/Excel/PowerPoint/MathType objects converted on load and back on save; Visio and PDF → Draw; others kept as OLE with preview image | same | same (tdf#139904) | Common.xcs; tdf#58323 |
| SmartArt | original kept + fallback drawing; no edit or create (tdf#37932) | shown from fallback | same; many bugs (tdf#106547) | main.xcd SmartArtToShapes=false |
| Equations | OMML ↔ Math | n/a | whole-object a14:m in/out; inline formulas unsupported (tdf#129061) | starmath ooxml*; textbodycontext.cxx |
| chartex (waterfall, treemap, sunburst, funnel, box & whisker, histogram/pareto, region map) | round-trip only | basic import/export since 25.8 (funnel) and 26.2.0.2 (all types); **not rendered**; pareto export incomplete | same | tdf#165742 |
| Pivot / slicers / timelines | n/a | pivot tables in/out; **slicers unsupported** (tdf#119807); no timeline code | n/a | Library_scfilt.mk |
| External links | n/a | externalLink in/out | n/a | externallinkbuffer; xelink.cxx |
| Power Query / Data Model | n/a | **lost on save** (tdf#158857); Data Model not supported (low) | n/a | |
| Sparklines | n/a | in/out | n/a | SparklineFragment/SparklineExt |
| Comments | comments + replies/resolved | 26.8: threaded comments in/out, shown as notes, no reply UI (tdf#172194); 26.2.6 converts them to notes (tdf#127105) | comments | xeescher.cxx |
| Content controls | text, checkbox, dropdown, combo, date, picture, group, data binding | n/a | n/a | docxattributeoutput.cxx; tdf#113363 |
| Tracked changes | ins/del/move, run/paragraph/section property changes (tdf#115709) | revision issues (tdf#125650) | n/a | |
| Animations / transitions | n/a | n/a | supported with gaps (tdf#139897); **no Morph** (tdf#116736) | |
| Video / audio | n/a | n/a | import/export (p14 accepted); playback depends on platform (tdf#107322) | contexthandler2.cxx |
| 3D models / ink | fallback picture (inference) | same | am3d → fallback picture; InkML unsupported (tdf#148268) | contexthandler2.cxx |
| Font embedding | DOCX in/out | n/a | PPTX in/out | FontTable.cxx; pptx-epptooxml.cxx |
| Missing fonts | Calibri→Carlito, Cambria→Caladea, Arial/Times/Courier→Liberation; **Aptos has no substitute** | same | same | main.xcd VCL table |
| OOXML password | open: Standard + Agile (AES-128/192/256); save: Standard AES-128/SHA-1 | same | same | Standard2007Engine.cxx |
| Legacy password | DOC: open XOR/RC4/CryptoAPI, save RC4 | XLS: open XOR/RC4/CryptoAPI, save RC4 | PPT: **cannot open** (tdf#33538) **or save** (tdf#63016) | ww8par/wrtww8, xistream/xestream |
| IRM/DRM | not supported (tdf#116197) | same | same | oox.component |
| Strict vs Transitional | Strict import only (mapped onto transitional; tdf#83571); export = ECMA-376 1st ed. or ISO Transitional; no Strict export (tdf#149658) | same (tdf#59399 fixed) | same | filterdetect.cxx |
| ODF | default save 1.4 Extended; 1.2, 1.2 ext, 1.3, 1.3 ext and 1.4 selectable | same | same | saveopt.hxx |

### 3. CSV FilterOptions (`Text - txt - csv (StarCalc)`)
| # | Meaning | Import / Export | Values (default) |
|---|---|---|---|
| 1 | Field separator(s) | both | ASCII codes joined by `/` (59=`;`, 44=`,`, 9=TAB, 32=space); `/MRG` merges repeats; `FIX` = fixed width; `DETECT` (26.8 source only) |
| 2 | Text delimiter | both | 34 `"`, 39 `'` |
| 3 | Character set | both | 76 UTF-8, 36 Windows-1254, 1 Windows-1252, 0 system, 65535 UTF-16; ANSI/MAC/IBMPC/SYSTEM; `DETECT` (26.8 source only) |
| 4 | First line (1-based) | import | 1 |
| 5 | Column formats (`col/fmt` pairs) | import | 1 Standard, 2 Text, 3 MM/DD/YY, 4 DD/MM/YY, 5 YY/MM/DD, 9 skip, 10 US-English |
| 6 | Language (LCID, decimal) | import only | 0 = UI language; 1055 tr-TR, 1033 en-US |
| 7 | Quoted field as text / (export) quote all text | both | false |
| 8 | Detect special numbers / (export) save numbers as numbers | both | import false, export true |
| 9 | Save cell contents as shown | export | true |
| 10 | Export formulas | export | false |
| 11 | Trim spaces | import | false |
| 12 | Sheet to export | export | 0 = current, -1 = all (separate files), N |
| 13 | Evaluate formulas | import | true if omitted; false if present and not "true" |
| 14 | Include BOM | export | false |
| 15 | Detect scientific notation | import | true |

Examples (FilterName `Text - txt - csv (StarCalc)`):
- TR import (`;` separator, decimal comma, UTF-8, column 1 as text, no formula evaluation): `59,34,76,1,1/2,1055,false,true,true,false,false,0,false,false,true`
- EN import: `44,34,76,1,,1033,false,true,true,false,false,0,false,false,true`
- TSV import: `9,34,76,1,,1033,false,true,true,false,false,0,false,false,true`
- TR export for Excel (`;`, UTF-8 with BOM, values as shown): `59,34,76,1,,0,false,true,true,false,false,0,false,true`
- EN export (`,`, UTF-8): `44,34,76,1,,0,false,true,true,false,false,0,false,false`. Token 6 is ignored on export, so the decimal separator follows the cell/document locale. Test this.
- TSV export: `9,34,76,1,,0,false,true,true,false,false,0,false,false`

### 4. `Text (encoded)` FilterOptions (Writer)
| # | Meaning | Example |
|---|---|---|
| 1 | Charset name (RTL name) | `UTF8`, `MS_1254`, `ISO_8859_9`, `IBM_857`, `UNICODE` |
| 2 | Line end | `CRLF` / `LF` / `CR` |
| 3 | Font (import) | empty |
| 4 | Language tag (BCP 47) | `tr-TR` |
| 5 | Include BOM (anything but FALSE = true) | `true` |
| 6 | Include hidden text | `false` |

Examples: legacy Turkish import `MS_1254,CRLF,,tr-TR`; UTF-8 export `UTF8,CRLF,,tr-TR,true,false`.

## Risks
- LibreOffice 26.2.x lacks XLSX threaded-comment round-trip, the ISO macro-enabled filters and the 26.8 chartex fixes, so the engine version has to be chosen deliberately.
- Loading PPS/PPSX/PPSM with detected filters starts the slideshow (STARTPRESENTATION) inside the embedded window. Load them with the non-AutoPlay filter.
- DOTM, XLTM, POTM and PPSM cannot be saved with their macros. Saving them under their original extension writes a macro-free content type, and Office may reject a mismatched extension (inference). XLSB can't be saved at all.
- XLSM VBA is regenerated, not byte-copied: the VBA project can differ and VBA signatures are lost. DOCM/PPTM passthrough can drift out of sync if macros are edited in LibreOffice's Basic editor.
- Silent data loss on save: slicers, timelines, Power Query, the Excel Data Model, Morph, ink, 3D models and IRM. chartex charts round-trip partially but are not drawn, and pareto export is incomplete. SmartArt cannot be edited. Inline PPTX equations are lost.
- OOXML password saving uses ECMA-376 Standard encryption (AES-128/SHA-1), which is weaker than Office's default. The Save dialog path excludes VBA/template filters. Setting a password through the UNO `EncryptionData` property is untested. PPT has no password open or save at all.
- Fonts: the portable image does not load its bundled Carlito/Caladea/Liberation fonts until they are copied to share/fonts/truetype. Aptos (the Office default since 2023–24) has no metric-compatible substitute, so pagination and layout will drift.
- Macro defaults in the stock config are Load, Executable and Save = true. Hardening is required, but DisablePythonRuntime must stay false because the UNO bridge uses Python.
- CSV: the API default (UTF-8, comma) ignores the Turkish locale. Evaluating formulas (token 13) enables CSV formula injection. Scientific-notation detection can corrupt codes such as 1E5.
- PDF: Draw import is a lossy conversion done by xpdfimport (Poppler, GPL-2.0); it does not edit the PDF in place. Bundling it brings GPL source-offer and notice obligations, and LICENSE.html lists other GPL/LGPL/MPL components too.
- Strict OOXML is always re-saved as Transitional. ECMA vs ISO dialect depends on the filter chosen, and PPTX always round-trips through the ECMA filter.
- Research gaps: wiki release notes were unreadable (behind a bot-check wall), so version attribution comes from Bugzilla commit comments and source tags. Media playback codecs and XLSX Data Model / timeline handling were not verified at runtime.

## Recommendation
Keep an unmodified LibreOffice as the DOCX/XLSX/PPTX editing engine. It is the only candidate with real open, edit, recalculate and save for all three families. Wrap it with an explicit filter policy and a loss guard:

1. **Engine version.** Prefer 26.8.x over 26.2.6.3, because 26.8 adds threaded-comment round-trip, the ISO macro-enabled filters and the chartex fixes. Pin the version and verify it by hash, and re-check when 26.8.1/26.8.2 ship. If 26.2.6 stays, document that XLSX threaded comments degrade to notes.
2. **Filter policy.** Always pass FilterName on storeToURL. To keep the file's dialect, read the detected FilterName back from the loaded model and reuse it when saving. For new files use `Office Open XML Text`, `Calc Office Open XML` and `Impress MS PowerPoint 2007 XML`.
   - Load PPS/PPSX/PPSM with the non-AutoPlay filter and save them with the AutoPlay one.
   - Pass `AsTemplate=false` when the user edits a template itself.
3. **Lossy formats.**
   - XLSB: open, then force Save As XLSX or ODS.
   - DOTM/XLTM/POTM/PPSM: warn the user and offer DOCM/XLSM/PPTM, the macro-free template/show format, or ODF. Custom macro-enabled template/show filters registered through an extension are possible in principle but untested.
4. **Pre-save loss scanner.** Before saving, inspect the original OOXML package for parts LibreOffice drops or does not draw: slicers, timelines, Power Query data, `xl/model`, chartEx, ink, 3D models, IRM data spaces, and threaded comments on 26.2. Warn the user, and always keep the original file.
5. **Macro security.** Ship a config layer that disables macro execution (`DisableMacrosExecution=true`, or `MacroExecutionMode=NEVER_EXECUTE` on load). Leave VBA Load/Save on so macros are preserved, and keep `DisablePythonRuntime=false`.
6. **Passwords.** Open with the `Password` property. Save OOXML with `EncryptionData` = {OOXPassword, CryptoType='Standard'}, verify with Office, and document that this is AES-128. Hide the password option for PPT and show a clear message for IRM files.
7. **Fonts.** Copy the bundled fonts from the image's `Fonts` folder into `share/fonts/truetype` in the portable image. Accept that Aptos has no substitute and warn when it is missing.
8. **CSV/TXT.** Never rely on the defaults. Ship tr-TR and en-US presets from table 3, with token 13 = false. Use `Text (encoded)` with explicit charset and BOM settings.
9. **PDF.** Use a dedicated PDF stack for viewing, annotating and editing. Use LibreOffice only for export (PDF/A-1b–4, PDF/UA, hybrid via `IsAddStream`) and for re-opening hybrid PDFs. If Draw's PDF import is ever exposed, label it "convert".
10. **Before committing to this architecture, build a round-trip regression corpus per format:** open, save, re-open, then compare the XML parts and the rendered pages. Include Turkish-locale CSVs, Strict files, encrypted files and the loss cases above.

## Facts
- [high] The LibreOffice 26.2.6.3 Windows build (buildid 8221e31b3ac356a1623c672912a3d2b492f7e3d1) bundles Python 3.12 (python-core-3.12.14), pdfiumlo.dll and xpdfimport.exe; its administrative image is about 1,525 MB. (program/version.ini and program/ of the 26.2.6.3 administrative image)
- [high] For all 27 target formats the 26.8.0.3 filter/type fragments equal the 26.2.6.3 .xcd definitions, except 26.8 adds filters 'Office Open XML Text VBA' and 'Calc Office Open XML VBA' (types writer_OOXML_VBA, 'Office Open XML Spreadsheet VBA', both preferred) and sets writer_MS_Word_2007_VBA Preferred=false. (https://github.com/LibreOffice/core/tree/libreoffice-26.8.0.3/filter/source/config/fragments + share/registry/*.xcd of the 26.2.6.3 image)
- [high] DOCX filters: 'MS Word 2007 XML' (type writer_MS_Word_2007, FileFormatVersion 0) and 'Office Open XML Text' (type writer_OOXML, FileFormatVersion 1, UI 'Word 2010–365 Document'), both flags IMPORT EXPORT ALIEN 3RDPARTYFILTER ENCRYPTION PASSWORDTOMODIFY SUPPORTSSIGNING. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/filter/source/config/fragments/filters/OOXML_Text.xcu)
- [high] FileFormatVersion 0 maps to oox ECMA_376_1ST_EDITION and 1 to ISOIEC_29500_2008; a filter without the property (e.g. 'Calc MS Excel 2007 XML', 'Impress MS PowerPoint 2007 XML') defaults to 0. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/oox/source/core/filterbase.cxx (and include/oox/core/filterbase.hxx))
- [high] OOXML detection: Word files with w:compatibilityMode > 12, Excel files with lowestEdited > 4, and any Strict file (purl.oclc.org relationships) map to the ISO types; Strict is explicitly 'Not supported, map to ISO transitional'; PPTX/PPTM/PPSX/POTX always map to the 'MS PowerPoint 2007 XML*' (ECMA) types; a .docm file name forces the VBA type. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/oox/source/core/filterdetect.cxx)
- [high] Macro-enabled template and show content types (dotm, xltm, potm, ppsm) are detected as the plain template/AutoPlay types; no type lists the .ppsm extension. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/oox/source/core/filterdetect.cxx + types fragments)
- [high] OOXML export behaviour is driven by filter config: UserData containing 'macro-enabled' sets VBA export, the TEMPLATE flag sets template content type, the STARTPRESENTATION flag sets slideshow content type. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/oox/source/core/filterbase.cxx)
- [high] No stock filter combines macro-enabled with TEMPLATE or STARTPRESENTATION, so DOTM/XLTM/POTM/PPSM cannot be saved with macros; although the exporters contain code paths for macroEnabledTemplate / slideshow.macroEnabled content types. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sd/source/filter/eppt/pptx-epptooxml.cxx ; sc/source/filter/excel/xestream.cxx ; sw/source/filter/ww8/docxexport.cxx)
- [high] DOCX export writes VBA only when the filter name ends with 'VBA'; otherwise, if the document storage has _MS_VBA_Macros, it warns that macros won't be saved. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sw/source/filter/ww8/docxexportfilter.cxx)
- [high] DOCM and PPTM export copy the original VBA binary stored at import (_MS_VBA_Macros) into word/ppt vbaProject.bin (binary passthrough); XLSM export regenerates vbaProject.bin with VbaExport from the document's Basic modules. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sw/source/filter/ww8/docxexport.cxx ; sd/source/filter/eppt/pptx-epptooxml.cxx (WriteVBA) ; sc/source/filter/excel/xestream.cxx)
- [high] Default VBA options: Calc Filter/Import/VBA UseExport, Load, Executable and Save all true; Writer Load, Executable and Save true; Impress only Load and Save true. MacroSecurityLevel default 2; DisableMacrosExecution false; DisablePythonRuntime false. (share/registry/main.xcd of the 26.2.6.3 image)
- [high] Help 26.8: 'Executable code' exists for Word and Excel only; LibreOffice inserts 'Option VBASupport 1' giving limited support for VBA statements, functions and objects; 'Save original Basic code' takes precedence. (https://help.libreoffice.org/latest/en-US/text/shared/optionen/01130100.html)
- [high] Loading with a STARTPRESENTATION filter (PPS/PPSX AutoPlay) sets SID_DOC_STARTPRESENTATION, so Impress starts the slideshow on load. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sfx2/source/doc/objstor.cxx)
- [high] MediaDescriptor AsTemplate: loading a template-type component creates a new untitled document by default; AsTemplate=FALSE loads the template itself for editing. (https://api.libreoffice.org/docs/idl/ref/servicecom_1_1sun_1_1star_1_1document_1_1MediaDescriptor.html)
- [high] XLSB: filter 'Calc MS Excel 2007 Binary' has flags IMPORT ALIEN 3RDPARTYFILTER PREFERRED only (no EXPORT). (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/filter/source/config/fragments/filters/calc_MS_Excel_2007_Binary.xcu)
- [high] PPT: 'MS PowerPoint 97' has flags IMPORT EXPORT ALIEN (no ENCRYPTION); PPS: 'MS PowerPoint 97 AutoPlay' IMPORT EXPORT ALIEN STARTPRESENTATION. (share/registry/impress.xcd of the 26.2.6.3 image)
- [high] CSV and TSV have no separate type or filter: type generic_Text covers csv, tsv, tab and txt; the Calc filter is 'Text - txt - csv (StarCalc)' (IMPORT EXPORT ALIEN, with an options dialog as UIComponent); 'Orcus CSV' is import-only. (share/registry/calc.xcd and writer.xcd of the 26.2.6.3 image)
- [high] OOXML decryption supports ECMA-376 Standard (2007 and 2007 SP2 EncryptionInfo) and Agile (AES-128/192/256 CBC; SHA-1/384/512), plus the Excel default password 'VelvetSweatshop'. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/oox/source/crypto/StrongEncryptionDataSpace.cxx ; AgileEngine.cxx ; oox/source/core/filterdetect.cxx)
- [high] OOXML save-with-password uses StrongEncryptionDataSpace, whose default engine is Standard2007Engine: AES-128, SHA-1, CryptoAPI flags, VERSION_INFO_2007_FORMAT. It is not Agile. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/oox/source/crypto/Standard2007Engine.cxx)
- [high] The Save dialog enables OOXML encryption (OOXPassword + CryptoType 'Standard') only for: Calc MS Excel 2007 XML, MS Word 2007 XML, Impress MS PowerPoint 2007 XML (+AutoPlay), Calc Office Open XML, Impress Office Open XML (+AutoPlay), Office Open XML Text. VBA and template filters are excluded. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sfx2/source/dialog/filedlghelper.cxx)
- [high] Encryption engine is chosen by EncryptionData CryptoType; 'Standard' is mapped to com.sun.star.comp.oox.crypto.StrongEncryptionDataSpace. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/oox/source/crypto/DocumentEncryption.cxx)
- [high] IRM/DRM: decryption instantiates com.sun.star.comp.oox.crypto.<DataSpaceName>; only StrongEncryptionDataSpace is registered, so IRM files cannot be opened (feature request tdf#116197 still NEW). An extension could provide another data space (inference). (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/oox/util/oox.component ; https://bugs.documentfoundation.org/show_bug.cgi?id=116197)
- [high] DOC import handles XOR, RC4 and RC4-CryptoAPI encryption; DOC export encrypts with RC4 only (MSCodec_Std97). (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sw/source/filter/ww8/ww8par.cxx ; sw/source/filter/ww8/wrtww8.cxx)
- [high] XLS import has Biff5 (XOR), Biff8 Std (RC4) and Biff8 CryptoAPI decrypters; XLS export encrypts with MSCodec_Std97 (RC4). (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sc/source/filter/excel/xistream.cxx ; xestream.cxx)
- [high] Password-protected PPT/PPS cannot be opened (tdf#33538 NEW); saving PPT with a password is not implemented (tdf#63016 NEW); PPT with password-to-modify fails to open (tdf#73971 NEW). (https://bugs.documentfoundation.org/show_bug.cgi?id=33538)
- [high] Strict OOXML: XLSX Strict opening fixed (tdf#59399); remaining Strict import problems are tracked in META tdf#83571; Strict export is not available (tdf#149658 NEW). (https://bugs.documentfoundation.org/show_bug.cgi?id=149658)
- [high] ODF default save version: Office.Common/Save/ODF/DefaultVersion = 3 (ODFVER_LATEST), which resolves to ODF 1.4 Extended; selectable values include 1.2, 1.2 extended (compat), 1.2 extended, 1.3, 1.3 extended, 1.4. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/include/unotools/saveopt.hxx ; officecfg/registry/schema/org/openoffice/Office/Common.xcs ; main.xcd of the 26.2.6.3 image)
- [high] CSV FilterOptions: 15 comma-separated tokens in this order: separator, text delimiter, charset, first line, column formats, language (LCID), quoted-as-text, detect special numbers, save as shown, export formulas, trim spaces, sheet to export, evaluate formulas, BOM, detect scientific notation. (https://help.libreoffice.org/latest/en-US/text/shared/guide/csv_params.html ; https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sc/source/ui/dbgui/asciiopt.cxx)
- [medium] The 26.8 source accepts 'DETECT' for the separator token and the charset token, and '/MRG' and 'FIX' for the separator token. DETECT is not documented in help. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sc/source/ui/dbgui/asciiopt.cxx)
- [high] CSV import or export via API without FilterOptions defaults to UTF-8, comma separator, double-quote delimiter. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sc/source/ui/docshell/docsh.cxx)
- [medium] CSV export parser (ScImportOptions) reads tokens 1-3 and 7-14 (7 = quote all text, 8 = save numbers as such, 12 = sheet -1/N, 14 = BOM); it does not parse token 6 (language). A code comment says multi-sheet export is 'Only from command line --convert-to'. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sc/source/ui/dbgui/imoptdlg.cxx ; sc/source/ui/docshell/docsh.cxx)
- [high] 'Text (encoded)' FilterOptions: charset name (e.g. UTF8, MS_1254, ISO_8859_9, IBM_857, UNICODE), line end (CRLF/LF/CR), font name, BCP-47 language tag, include BOM (anything but FALSE = true), include hidden text. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sw/source/filter/basflt/fltini.cxx)
- [medium] Writer 'Text' import without explicit options auto-detects encoding, line end and BOM. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sw/source/filter/ascii/parasc.cxx)
- [high] PDF import filters: draw_pdf_import (PREFERRED, SUPPORTSSIGNING; type PreferredFilter), impress_pdf_import and writer_pdf_import (via XmlFilterAdaptor). PDFDetector routes PDFs whose trailer has /AdditionalStreams (hybrid PDF) to writer/calc/impress/draw_pdf_addstream_import, which open the embedded ODF. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sdext/source/pdfimport/config/pdf_import_filter.xcu ; sdext/source/pdfimport/filterdet.cxx)
- [high] The 26.2.6.3 build's LICENSE.html lists poppler under GPL Version 2 (and poppler-data under GPL); xpdfimport.exe (the PDF import helper) and pdfiumlo.dll are shipped in program/. (LICENSE.html and program/xpdfimport.exe of the 26.2.6.3 image)
- [high] PDF export SelectPdfVersion in source: 0 default (1.7), 1 PDF/A-1b, 2 PDF/A-2b, 3 PDF/A-3b, 4 PDF/A-4, 15/16/17 = PDF 1.5/1.6/1.7, 20 = PDF 2.0. The help page lists only 0-3 and 15-17. IsAddStream embeds the original document (hybrid PDF); PDFUACompliance, EncryptFile and DocumentOpenPassword are also available. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/filter/source/pdf/pdfexport.cxx ; https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html)
- [high] LibreOffice QA: 'we do not and can not edit a PDF' — PDF is filter-imported into Draw/Writer/Impress and exported anew; issues are tracked in META tdf#99746 (Draw) and tdf#113123 (Writer). (https://bugs.documentfoundation.org/show_bug.cgi?id=99746)
- [high] chartex (Office 2016+ charts): funnel support was added in 25.8. 'Step 5.1: Support basic I/O for additional chartex types', covering all other chartex types including RegionMap, landed in 26.2.0.2 and 26.8; ParetoLine is incomplete especially on export; 26.8 adds axis, tickLabels, layout and geography fixes. tdf#165742 is still NEW. (https://bugs.documentfoundation.org/show_bug.cgi?id=165742 ; https://github.com/LibreOffice/core/commit/2dba43e31707b183d9b7cb7975209bd334900268)
- [medium] chartex charts are round-tripped but not rendered as real charts: a string 'One or more chart types are unsupported in this version of %PRODUCTNAME' exists. Native waterfall, treemap, sunburst and funnel chart types are still open requests (tdf#120609, tdf#72992, tdf#159180, tdf#97832). (https://github.com/LibreOffice/core/commit/1946b58f20835d6a414fcf5b3ec1992df3672c07)
- [medium] The 26.2.6.3 mergedlo.dll contains the FunnelChartType and SunburstChartType service names (chartex basic I/O backported) but no 'threadedComment' tokens. (program/mergedlo.dll of the 26.2.6.3 image, byte search)
- [high] XLSX threaded comments: 26.8 imports them (threadedcommentsfragment, personsfragment) and exports them (SaveThreadedCommentsXml). QA says they are 'imported as normal note. No data lost, but cannot reply'; UI work is tdf#172194 (NEW). Before 26.8, re-saving converted them to notes and lost metadata (tdf#127105). (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sc/source/filter/excel/xeescher.cxx ; https://bugs.documentfoundation.org/show_bug.cgi?id=172194)
- [high] Slicers are not supported (tdf#119807 NEW; tdf#122475 'Slicer gets replaced when opened in LO' is a duplicate); the Calc filter library has no slicer or timeline modules. (https://bugs.documentfoundation.org/show_bug.cgi?id=119807 ; https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sc/Library_scfilt.mk)
- [high] Power Query is lost when saving XLSX (tdf#158857 'Keep Power Query when saving XLSX', NEW). (https://bugs.documentfoundation.org/show_bug.cgi?id=158857)
- [high] XLSX has import and export code for pivot tables (pivot cache and table, PivotTableFormat), sparklines (SparklineFragment/SparklineExt), external links (externallinkbuffer; xelink.cxx writes xl/externalLinks) and query tables/connections. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sc/Library_scfilt.mk ; sc/source/filter/excel/xelink.cxx)
- [high] DOCX content controls exported: plain text, checkbox (w14), dropDownList, comboBox, date, picture, group, citation, docPartObj, dataBinding. Issues are tracked in META tdf#113363. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sw/source/filter/ww8/docxattributeoutput.cxx)
- [medium] DOCX tracked-change export writes w:ins, w:del, w:moveFrom/moveTo, rPrChange, pPrChange, sectPrChange, plus w15:commentEx (comment replies/resolved). Issues in META tdf#115709. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sw/source/filter/ww8/docxattributeoutput.cxx)
- [high] SmartArt: option SmartArtToShapes defaults to false, keeping the original SmartArt for round-trip and showing the fallback drawing; editing and creation are unsupported (tdf#37932 NEW); many layout and round-trip bugs in META tdf#106547. (share/registry/main.xcd of the 26.2.6.3 image ; https://bugs.documentfoundation.org/show_bug.cgi?id=106547)
- [medium] Equations: DOCX OMML is converted to and from LibreOffice Math (starmath ooxmlimport/ooxmlexport). PPTX imports a14:m in text bodies and exports Math objects as a14:m; inline formulas are unsupported (tdf#129061) and no fallback image is written (tdf#97356). (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/oox/source/drawingml/textbodycontext.cxx ; oox/source/export/shapes.cxx)
- [medium] The generic mc:AlternateContent handler only accepts Choice branches requiring p14, p15, x12ac, v, cx1, cx2, cx4; other Requires values (e.g. PowerPoint 3D models 'am3d', ink) fall back to the Fallback content, typically a picture (inference for 3D and ink). (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/oox/source/core/contexthandler2.cxx)
- [high] Morph transition unsupported (tdf#116736 NEW); PPTX ink/InkML not imported (tdf#148268 NEW). (https://bugs.documentfoundation.org/show_bug.cgi?id=116736 ; https://bugs.documentfoundation.org/show_bug.cgi?id=148268)
- [high] ActiveX import maps the MS Forms 2.0 set (CommandButton, Label, Image, ToggleButton, CheckBox, OptionButton, TextBox, ListBox, ComboBox, SpinButton, ScrollBar, Frame) plus some ComCtl/HTML controls to form controls; DOCX export writes ActiveX controls. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/include/oox/ole/axcontrol.hxx ; sw/source/filter/ww8/docxattributeoutput.cxx)
- [high] OLE defaults: MathType->Math, WinWord->Writer, Excel->Calc, PowerPoint->Impress, Visio->Draw and PDF->Draw conversion on load are all true; the Microsoft export conversions start with MathToMathType true. (share/registry/main.xcd of the 26.2.6.3 image ; officecfg Common.xcs at the 26.8.0.3 tag)
- [high] Embedded fonts: DOCX import (FontTable embedRegular/Bold/Italic) and export (obfuscated fonts); PPTX import (embeddedFontLst) and export (EmbedFonts document settings). (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/sw/source/writerfilter/dmapper/FontTable.cxx ; oox/source/ppt/presentationfragmenthandler.cxx ; sd/source/filter/eppt/pptx-epptooxml.cxx)
- [high] Bundled fonts include Carlito, Caladea, Liberation Sans/Serif/Mono/Sans Narrow, DejaVu, Noto subsets, Linux Libertine/Biolinum, Amiri and OpenSymbol. The font substitution table maps calibri->carlito, cambria->caladea, arial->liberationsans; there is no entry for Aptos, and Georgia falls back to Bell/Charter/Times. (Fonts folder and share/registry/main.xcd of the 26.2.6.3 image)
- [medium] On Windows, LibreOffice privately registers fonts from $BRAND_BASE_DIR/share/resource/common/fonts and share/fonts/truetype; the MSI admin image puts bundled fonts in TARGETDIR/Fonts (system Fonts folder on a normal install), which a portable copy does not load. (https://github.com/LibreOffice/core/blob/libreoffice-26.8.0.3/vcl/win/gdi/salfont.cxx ; layout of the administrative image)
- [high] The newest release on the stable download mirror is 26.8.0 (also 26.2.6, 26.2.5, 25.8.7); there is no 26.8.1 yet. (https://download.documentfoundation.org/libreoffice/stable/)
