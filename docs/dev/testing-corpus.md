# Test corpus and independent verification (developer notes)

Scope: `tests/corpus/**`, `scripts/corpus/**`, `tests/tools/**`, `tests/unit/tools/**`,
`tests/engine/independent.test.ts`, `tests/engine/visual.test.ts`. Layout, commands and the list of fixtures are in
[tests/README.md](../../tests/README.md); corpus rules in [tests/corpus/README.md](../../tests/corpus/README.md).
All measurements below: LibreOffice 26.8.0.3 (x64, `vendor/libreoffice`), Windows 11, Node 22.20, pdf.js 6.3.289
(legacy build) with @napi-rs/canvas 1.0.9, pixelmatch 7.2.0, on 2026-09-29, while other agents were running
LibreOffice on the same machine.

## Progress (session 2, 2026-09-29)

- [x] Visual test: the bullet-list differences (DOCX page 1, PPTX slide 2) are **real round-trip changes**,
      explained by the XML and reproduced pixel for pixel (0 px) by applying the documented change to the original
      ([Findings](#findings) F1, F2). The test now compares the round trip with *original + documented change*
      under a strict windowed budget ([Visual budget](#visual-budget)); opt-in measurement report kept.
- [x] XLSM: semantic comparison of the VBA project (name, modules with type and order, PROJECT declarations,
      code); regenerated container and dropped procedure attributes documented and asserted (F3). DOCM/PPTM:
      stream-identical passthrough asserted (research said "byte for byte"; the container is in fact rewritten).
- [x] Fixes: `tests/tools/text.ts` TS2749, `scripts/corpus/lib/index.mjs` preserve-caught-error, unused `sha` in
      `independent.test.ts` (now used for stream hashes). Lint and `tsc -p tsconfig.node.json` clean for these files.
- [x] Documentation: `tests/README.md`, `tests/corpus/README.md`, this file; `third-party.mjs` verify now also
      fails on unpinned files and stale `ATTRIBUTION.md`/`manifest.json` (unit test `third-party.test.ts`).
- [x] Runs (see [Test runs](#test-runs)): unit tools 58/58, whole unit project 618/618, engine independent +
      visual 64 passed / 3 skipped; `test-output/corpus` and `test-output/visual` cleaned (no failures, no diffs).
- Open: see [Not covered / next steps](#not-covered--next-steps).

## Tools

| Module | Notes |
|---|---|
| `tests/tools/soffice.ts` → `scripts/corpus/lib/soffice.mjs` | Headless `--convert-to` runner without the bridge. Each runner has its own profile (`test-output/corpus/soffice/<name>-<pid>-<random>`), hence its own single-instance pipe; conversions of a runner are serialised; every invocation has a timeout (default 180 s) after which the process tree is killed (`taskkill /T /F`); `dispose()` kills leftovers found by command line and deletes the profile; `leftovers()` lets the suites assert that nothing survived. |
| profile (`profileXcu`) | UI language forced to en-US (document locale may be tr-TR), macro execution disabled (`DisableMacrosExecution`, security level 3), formulas always recalculated on load (OOXML and ODF), no lock files, no automatic spell checking, no OpenCL, no update check, no migration of a user profile. |
| `tests/tools/ooxml.ts`, `odf.ts`, `opc.ts`, `xml.ts` | Independent readers: they read the XML, never lay out or recalculate. Values come from cached results in the files, which is exactly what another application sees. |
| `tests/tools/pdf.ts` | pdf.js text, metadata, page sizes, widgets with kind (`text`, `checkbox`, `radio`, `push`, `combo`, `list`, `signature`); rendering to PNG. |
| `tests/tools/visual.ts` | pixelmatch in two passes (mask for statistics, picture only when a diff image is written). Result: differing pixels, page ratio, `hotspot` (densest `window × window` square, scanned with half-window overlap so a cluster up to half a window wide is never split) and `bounds`. `withinBudget()` / `describeDiff()` for assertions. |
| `tests/tools/opc.ts` `patchPackage` | Copy of a package with text edits of some parts; an edit that changes nothing throws, so a documented change that no longer matches the generator fails loudly. `replaceOnce` throws on zero or several matches. |
| `tests/tools/cfb.ts`, `vba.ts` | [MS-CFB] reader and [MS-OVBA] project reader: decompression (checked against the spec example), dir-stream records (project name, code page, module name/stream/offset/type), module sources, PROJECT-stream declarations and project ID, all streams for hash comparisons. |

## Visual budget

Pipeline: LibreOffice exports the original and the round-tripped file to PDF (lossless images, embedded
standard fonts); pdf.js renders every page at scale 1.5 (108 dpi); pixelmatch compares them with colour
threshold 0.1 and anti-aliased pixels excluded. Both sides of a comparison are rendered in the same run with the
same fonts, so no reference images are stored: absolute renders depend on the fonts of the machine (see
[Fonts](#fonts)).

Measured (SIMPAPER_VISUAL_REPORT output and the calibration runs of this session; window = 32 × 32 px):

| Comparison | Page | Differing px | Page ratio | Densest window | Where |
|---|---|---:|---:|---:|---|
| same DOCX exported and rendered twice | 1, 2 | 0 | 0 | 0 | — |
| DOCX round trip vs original | 1 | 1,502 | 0.133 % | 170 | x 134–402, y 896–953 (the bullet list) |
| DOCX round trip vs original | 2 | 0 | 0 | 0 | — |
| DOCX round trip vs original + F1 | 1, 2 | 0 | 0 | 0 | — |
| PPTX round trip vs original | 2 | 4,220 | 0.362 % | 247 | x 112–500, y 313–401 (level-2 item and the item below) |
| PPTX round trip vs original | 1, 3 | 0 | 0 | 0 | — |
| PPTX round trip vs original + F2 | 1–3 | 0 | 0 | 0 | — |
| XLSX round trip vs original | 1–4 | 0 | 0 | 0 | — |
| one-word change (`docx-changed`) | 1 | 1,590 | 0.141 % | 198 | the changed line |
| one-word change (`pptx-changed`) | 2 | 2,049 | 0.176 % | 238 | the changed bullet |
| one letter e → a ("sözcükler" → "sözcüklar"), 11 pt | 1 | 26 | 0.0023 % | 26 | 16 × 6 px |
| colon → full stop (rest of the line moves) | 1 | 325 | 0.029 % | 55 | one line |
| diacritic removed ("Görsel" → "Gorsel", 12 pt bold) | 1 | 4 | 0.0004 % | 4 | — |
| dotless ı → dotted i ("ığdır" → "iğdır") | 1 | 2 | 0.0002 % | 2 | — |

At scale 2 (144 dpi) the one-letter change counted 15 px and the diacritic 8 px: more edge pixels are classified
as anti-aliasing, so a higher resolution does not buy sensitivity; 108 dpi keeps pages at about 1.1 megapixels.

Budget used for every "must look the same" comparison (`BUDGET` in `visual.test.ts`):

- **≤ 8 differing pixels in any 32 × 32 window.** The noise floor is 0 px (identical content rendered twice,
  and all round-trip pages once the documented changes are applied). 8 px leaves room for isolated stray pixels
  while a single changed letter (26 px) fails. A page ratio alone cannot do this: the letter is 0.0023 % of the
  page, far below any page-level threshold that tolerates real-world noise.
- **≤ 0.02 % differing pixels per page** (≈ 225 px on A4, 233 px on a 16:9 slide) for diffuse differences spread
  thinner than 8 px per window (for example a colour or spacing change across the page).
- **Blind spot, by design:** a single diacritic or dot (2–4 px). Exact text comparisons in
  `independent.test.ts` (paragraph, cell and slide texts) catch those.

Sensitivity is asserted, not assumed: the one-word variants must fail the budget on the changed page and pass
on all others, and the one-letter change (built with `patchPackage`) must fail through the window count while
its page ratio stays within the budget.

### Known changes

A round-trip change that is understood and documented is part of the expectation instead of a larger
threshold. `KNOWN_CHANGES` in `visual.test.ts` holds, per corpus file:

- `edits`: the change as text edits of the generated package. The test renders *original + edits* and requires
  the round trip to match it under the same strict budget — so any additional change on those pages, including
  inside the list, still fails;
- `verify`: XML assertions that the original lacks and the round trip contains exactly the documented markup;
- `pages`: where the change is visible. A separate test requires those pages to differ from the plain original
  and all other pages to match it; when LibreOffice stops making the change, that test fails with a message to
  remove the entry and update this file.

To add a known change: explain it in the XML first, write the edits, and confirm with
`SIMPAPER_VISUAL_REPORT` that *round trip vs original + edits* is 0 px (or within the budget) before adding it here
under [Findings](#findings).

To re-derive the budget (for example after an engine upgrade):

```powershell
$env:SIMPAPER_VISUAL_REPORT = "test-output/corpus/visual-report.jsonl"
npx vitest run --project engine tests/engine/visual.test.ts
```

Each JSON line holds engine version, scale, case, kind (`roundtrip`, `roundtrip-vs-original`,
`roundtrip-vs-original-with-known-changes`, `one-word-change`, `one-letter-change`, `same-file-twice`), page,
ratio, differing pixels, densest-window pixels and bounds.

### Fonts

The generated DOCX/PPTX ask for Carlito. The development engine image keeps Carlito in `vendor/libreoffice/Fonts/`
(the MSI's system-font folder), which LibreOffice does not load, so it substitutes Calibri (installed on this PC):
the exported PDFs embed `Calibri`. This affects both sides of every comparison equally. It also means the renders
are machine-dependent, which is why baselines are rendered at test time instead of being stored.

## Findings

Round-trip behaviour of LibreOffice 26.8.0.3 established by these suites. "Asserted" names the test that fails
when the behaviour changes. None of this was checked in Microsoft Office.

**F1 — DOCX: a bullet without a bullet font is rewritten to the Symbol font** (asserted: visual, known change
`docx-bullet-symbol-font`). The generated list level has `w:numFmt="bullet"`, `w:lvlText="•"` (U+2022) and no
`w:rPr`, so the bullet uses the paragraph font. After open → save: `w:lvlText` is U+F0B7 (Symbol's private-use
bullet) with `w:rFonts w:ascii/hAnsi/cs="Symbol"`; LibreOffice also adds a `num` tab stop, eight further
(decimal) levels and a second abstract numbering with `none` levels. Visible effect: the three list lines differ in 1,502 px (bullet
glyph and line metrics of the Symbol font); the original with only the U+F0B7/Symbol change applied renders
identical to the round trip (0 px). Text, numbering and indentation are unchanged.

**F2 — PPTX: the slide master's text styles are not written back** (asserted: visual, known change
`pptx-master-text-styles`; independent, `poi-notes-pptx: known change …` with an Office-made deck). The saved
master has no `p:txStyles` (for the generated deck it has no placeholders either); each layout's body
placeholder gets LibreOffice's own outline list styles instead (level 2: `spcBef` 11.34 pt, `buSzPct` 75 %,
Symbol U+F02D; levels 3–7 with smaller space before and Symbol/Wingdings bullets). Slide paragraphs get explicit
line spacing, indents, bullet font, character and colour, and text size, but not space-before or bullet size,
so those now come from LibreOffice's list style: in `pptx-basic` the level-2 item moves down by
about 11 pt, its dash shrinks to 75 % and the next item moves down with it (4,220 px). The original with only
those two properties added to the master's level 2 renders identical to the round trip (0 px). Consequence:
decks from PowerPoint whose master text styles define spacing or bullet sizes not repeated on the paragraphs
can change appearance after a save in Simpaper — a candidate for the compatibility notes and the loss-risk
analysis.

**F3 — Macros (VBA)** (asserted: independent, `poi-macro-*`). Fresh conversions of the Apache POI samples:

| File | vbaProject.bin before → after | Streams | Result |
|---|---|---|---|
| SimpleMacro.docm (`MS Word 2007 XML VBA`) | 12,800 → 13,312 bytes | 10 → 10, all byte-identical | passthrough at stream level |
| SimpleMacro.pptm (`Impress MS PowerPoint 2007 XML VBA`) | 11,264 → 11,776 bytes | 9 → 9, all byte-identical | passthrough at stream level |
| SimpleMacro.xlsm (`Calc MS Excel 2007 VBA XML`) | 16,384 → 6,144 bytes | 13 → 9 | regenerated |

- DOCM/PPTM: Writer and Impress write the imported VBA storage back stream by stream (code, compiled-code caches
  `__SRP_*`, protection and workspace data); only the compound file around it is new. The research note
  (docs/research/formats.md: "byte for byte") is therefore true for the streams, not for the file.
- XLSM: Calc rebuilds the project from its Basic modules (VbaExport). Preserved and asserted: project name, code
  page, module names, module types (procedural vs document/class), module order, the `Module=`/`Document=`
  declarations of the PROJECT stream and the code of every module. Changed and asserted: a new project GUID,
  no `__SRP_*` streams, `_VBA_PROJECT` reduced to the version-independent 7 bytes `CC 61 FF FF 00 00 00`
  ([MS-OVBA] 2.3.4.1; Office recompiles from source), and the procedure attributes are dropped
  (`Attribute TestMacro.VB_Description = "…"`, `Attribute TestMacro.VB_ProcData.VB_Invoke_Func = " \n14"`), i.e.
  the macro description and its keyboard shortcut are lost. The protection fields (CMG/DPB/GC) of the PROJECT stream
  are re-encoded (observed, not asserted).
  Whether Excel opens and runs the rebuilt project is not verified. The test profile disables macro execution.

**F4 — XLSX in a tr-TR profile: two number formats are rewritten** (asserted: independent, `known locale
effect`): `0.00%` → `%0.00`, `dd.mm.yyyy` → `dd/mm/yyyy` (also with time). How other applications display the
rewritten codes is not verified here.

**F5 — DOCX chartEx charts become their fallback pictures** (asserted: independent, `poi-charts-docx: known
loss`); classic DrawingML charts survive.

**F6 — Encrypted OOXML in a headless conversion** (asserted: independent): an encrypted XLSX fails fast with a
conversion error, but an encrypted DOCX is "converted" as plain text of the container bytes. Callers must detect
encryption themselves (`isEncryptedOoxml`) and ask for the password first.

**F7 — Minor notation differences** (noted by session 1 in the comparison helpers of `independent.test.ts`;
tolerated, not asserted): Calc writes `TRUE()`/`FALSE()` instead of the constants and a meaningless `formula2`
("0") for list validations; Writer keeps non-ASCII query characters of hyperlinks unescaped (IRI form).

**F8 — Profile settings** (recorded by session 1 in `soffice.mjs`, not re-measured in session 2): with a Turkish UI
language (`ooLocale=tr`) `soffice.bin` crashed with 0xC000000D during headless start-up and then hung, so the UI
language of test profiles is always en-US; automatic spell checking made some starts take 25–40 s.

Observation, not asserted: in PPTX round trips the text runs get an explicit `<a:latin typeface="Calibri"/>`
where the original inherited the theme font Carlito (the theme itself still says Carlito). Seen on this machine,
where Carlito is not available to the engine (see [Fonts](#fonts)); DOCX keeps `Carlito`.

## Test runs

Session 2, 2026-09-29 (Vitest durations; other agents were running LibreOffice at the same time):

| Command | Result | Duration |
|---|---|---:|
| `npx vitest run --project unit tests/unit/tools` | 9 files, 58 tests passed | 1.9 s |
| `npx vitest run --project unit` (whole project, regression check) | 53 files, 618 tests passed | 6.3 s |
| `npx vitest run --project engine tests/engine/independent.test.ts tests/engine/visual.test.ts` | 2 files, 64 passed, 3 skipped | 141 s |
| `npx vitest run --project engine tests/engine/visual.test.ts` (after the last edit, which stopped registering the empty "known changes" test for XLSX) | 16 passed, 1 skipped | 53 s |

Skipped by design: the tr-TR-only locale check in the en-US XLSX run, and the one-word-change test for XLSX (no
changed variant). `npx tsc -p tsconfig.node.json --noEmit` and `npx eslint` on the files of this area: clean.

## Not covered / next steps

- Schema validation of saved files (Open XML SDK validator) and a part-inventory diff listing every part a round
  trip drops are planned (docs/TESTING.md) but not implemented; `scripts/verify/` is reserved for them.
- The visual suite covers the three generated OOXML files only; third-party samples are checked structurally.
- Diacritic-only changes are left to the text comparisons (see [Visual budget](#visual-budget)).
- Nothing here says how Microsoft Office opens, renders or recalculates the saved files.
