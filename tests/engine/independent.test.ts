/**
 * Independent verification of what the unmodified LibreOffice engine writes: every file is produced
 * by headless LibreOffice (no bridge) and read back with readers that share no code with it
 * (JSZip + XML, exceljs, pdf.js). Expectations come from the generator's manifest (computed in JS)
 * or from the third-party files themselves — never from LibreOffice output.
 *
 * Skipped when no engine is available (vendor/libreoffice or VARAK_ENGINE_DIR).
 */
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ensureGeneratedCorpus, type Corpus, type DocxFacts, type PptxFacts, type XlsxFacts } from '../tools/corpus';
import { odfText, odpPages, odsSheets } from '../tools/odf';
import { mainPart, openPackage } from '../tools/opc';
import {
  docxDocument,
  expandRange,
  formattingOf,
  normalizeNumFmt,
  pptxSlides,
  sameNumber,
  xlsxWorkbook,
  type DocxDocument,
  type PptxSlide,
  type XlsxPrimitive,
  type XlsxWorkbook,
} from '../tools/ooxml';
import { CORPUS_OUTPUT, THIRD_PARTY_DIR } from '../tools/paths';
import { ENGINE_VERSION, Soffice, SofficeConversionError, convertTarget, hasEngine } from '../tools/soffice';
import { isEncryptedOoxml, readText, rtfText } from '../tools/text';
import { vbaProject, type VbaProject } from '../tools/vba';
import { NS, kid } from '../tools/xml';

const OUT = join(CORPUS_OUTPUT, 'independent');

// ------------------------------------------------------------------------------------------ helpers
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const isoToSerial = (iso: string) => (Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - EXCEL_EPOCH) / 86_400_000;

function expectSame(actual: XlsxPrimitive | number | string | boolean | undefined, expected: number | string | boolean, where: string): void {
  if (typeof expected === 'number') {
    expect(typeof actual, `${where}: ${JSON.stringify(actual)}`).toBe('number');
    expect(sameNumber(actual as number, expected), `${where}: ${String(actual)} ≠ ${expected}`).toBe(true);
  } else {
    expect(actual, where).toBe(expected);
  }
}

/**
 * Formula text for comparison (notation only): no spaces, `_xlfn.` prefixes or redundant sheet quotes,
 * upper case outside strings, and TRUE()/FALSE() written as the constants TRUE/FALSE (LibreOffice writes
 * the function form; both mean the same in OOXML).
 */
function normalizeFormula(f: string | undefined): string {
  return (f ?? '')
    .replace(/^=/, '')
    .replace(/_xlfn\./g, '')
    .split(/("[^"]*")/)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/\s+/g, '')
            .replace(/'([A-Za-z0-9_]+)'!/g, '$1!')
            .toUpperCase()
            .replace(/\b(TRUE|FALSE)\(\)/g, '$1'),
    )
    .join('');
}

/** Same URL in URI or IRI form (LibreOffice writes non-ASCII query characters unescaped). */
const sameUrl = (a: string | undefined, b: string) => a !== undefined && new URL(a).href === new URL(b).href;

/** Number formats a tr-TR LibreOffice profile rewrites when saving XLSX (observed with 26.8.0.3). */
const TR_FORMAT_REWRITES: Record<string, string> = { '0.00%': '%0.00', 'dd.mm.yyyy': 'dd/mm/yyyy', 'dd.mm.yyyy hh:mm': 'dd/mm/yyyy hh:mm' };
const formatAfterSave = (fmt: string, locale: string) => (locale === 'tr-TR' ? (TR_FORMAT_REWRITES[fmt] ?? fmt) : fmt);

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function partNames(path: string, pattern: RegExp): Promise<string[]> {
  return (await openPackage(path)).parts.filter((p) => pattern.test(p)).sort();
}

async function mainContentType(path: string): Promise<string | undefined> {
  const pkg = await openPackage(path);
  return pkg.contentType(await mainPart(pkg));
}

interface ThirdPartyEntry {
  id: string;
  path: string;
  password?: string;
  expect: Record<string, unknown>;
}
const thirdParty = JSON.parse(readFileSync(join(THIRD_PARTY_DIR, 'manifest.json'), 'utf8')) as { files: ThirdPartyEntry[] };
const sample = (id: string) => {
  const f = thirdParty.files.find((x) => x.id === id);
  if (!f) throw new Error(`third-party sample ${id} missing from manifest`);
  return { ...f, abs: join(THIRD_PARTY_DIR, f.path) };
};

// ------------------------------------------------------------------------------------------ suite
describe.skipIf(!hasEngine)(`independent verification of LibreOffice ${ENGINE_VERSION ?? ''} output`, () => {
  let corpus: Corpus;
  let en: Soffice;
  let tr: Soffice;
  let failures = 0;

  beforeAll(async () => {
    rmSync(OUT, { recursive: true, force: true });
    corpus = await ensureGeneratedCorpus({ derived: true });
    en = Soffice.create({ locale: 'en-US', name: 'independent-en' });
    tr = Soffice.create({ locale: 'tr-TR', name: 'independent-tr' });
  });

  afterEach((ctx) => {
    if (ctx.task.result?.state === 'fail') failures++;
  });

  afterAll(async () => {
    await en?.dispose();
    await tr?.dispose();
    if (failures === 0) rmSync(OUT, { recursive: true, force: true }); // keep artefacts of failed runs
  });

  // ---------------------------------------------------------------------------------------- DOCX
  describe('DOCX round trip (open → save as DOCX)', () => {
    let facts: DocxFacts;
    let doc: DocxDocument;
    let path: string;

    beforeAll(async () => {
      facts = corpus.facts<DocxFacts>('docx-basic');
      path = await en.roundTrip(corpus.path('docx-basic'), join(OUT, 'docx'));
      doc = await docxDocument(path);
    });

    it('keeps the Turkish text, bullets and the default language', () => {
      const paragraphs = doc.paragraphs.map((p) => p.text);
      for (const t of facts.texts) expect(paragraphs, t).toContain(t);
      expect(doc.paragraphs.filter((p) => p.numbered).map((p) => p.text)).toEqual(facts.bullets);
      expect(doc.defaultLanguage).toBe(facts.language);
    });

    it('keeps the headings with their outline levels', () => {
      const headings = doc.paragraphs.filter((p) => p.outlineLevel !== undefined && p.outlineLevel < 9).map((p) => ({ level: p.outlineLevel! + 1, text: p.text }));
      expect(headings).toEqual(facts.headings);
    });

    it('keeps bold, italic and underline', () => {
      for (const w of facts.bold) expect(formattingOf(doc.runs, w)?.every((r) => r.bold), `bold ${w}`).toBe(true);
      for (const w of facts.italic) expect(formattingOf(doc.runs, w)?.every((r) => r.italic), `italic ${w}`).toBe(true);
      for (const w of facts.underline) expect(formattingOf(doc.runs, w)?.every((r) => r.underline), `underline ${w}`).toBe(true);
      for (const w of facts.plain) expect(formattingOf(doc.runs, w)?.some((r) => r.bold || r.italic || r.underline), `plain ${w}`).toBe(false);
    });

    it('keeps the table', () => {
      expect(doc.tables).toEqual([facts.table]);
    });

    it('keeps header and footer with PAGE/NUMPAGES fields', () => {
      expect(doc.headers).toContain(facts.header);
      expect(doc.footers.some((f) => f.startsWith(facts.footerPrefix))).toBe(true);
      expect(doc.headerFooterFields).toEqual(expect.arrayContaining(facts.footerFields));
    });

    it('keeps the comment, the tracked insertion and the hyperlink', () => {
      expect(doc.comments.map(({ author, text }) => ({ author, text }))).toEqual(facts.comments);
      expect(doc.insertions.map(({ author, text }) => ({ author, text }))).toEqual(facts.insertions);
      expect(doc.hyperlinks.map((h) => h.text)).toEqual(facts.hyperlinks.map((h) => h.text));
      doc.hyperlinks.forEach((h, i) => expect(sameUrl(h.target, facts.hyperlinks[i]!.target), `${h.target}`).toBe(true));
    });

    it('keeps the picture (320×200 PNG) and its description', async () => {
      expect(doc.pictures).toHaveLength(1);
      const png = await (await openPackage(path)).bytes(doc.pictures[0]!.part);
      const buf = Buffer.from(png!);
      expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([facts.images[0]!.widthPx, facts.images[0]!.heightPx]);
      expect(doc.pictures[0]!.descr).toBe(facts.images[0]!.alt);
    });

    it('keeps A4 page size and 2.5 cm margins', () => {
      const s = doc.sections.at(-1)!;
      expect([s.pageWidth, s.pageHeight]).toEqual([facts.page.width, facts.page.height]);
      expect(s.margins).toMatchObject({ top: facts.page.margin, right: facts.page.margin, bottom: facts.page.margin, left: facts.page.margin });
    });
  });

  // ---------------------------------------------------------------------------------------- XLSX
  describe.each([['en-US'], ['tr-TR']])('XLSX round trip in a %s profile', (locale) => {
    let facts: XlsxFacts;
    let wb: XlsxWorkbook;

    beforeAll(async () => {
      facts = corpus.facts<XlsxFacts>('xlsx-basic');
      const runner = locale === 'tr-TR' ? tr : en;
      wb = await xlsxWorkbook(await runner.roundTrip(corpus.path('xlsx-basic'), join(OUT, `xlsx-${locale}`)));
    });

    it('writes cached results equal to the independently computed values (including the stale one)', () => {
      const calc = wb.sheet('Hesaplar');
      for (const f of facts.formulas) {
        const cell = calc.cells.get(f.address);
        expect(cell?.hasCachedResult, `${f.address} has a cached result`).toBe(true);
        expectSame(cell?.value, f.expected, `${f.address} ${f.formula}`);
      }
    });

    it('keeps the formulas', () => {
      const calc = wb.sheet('Hesaplar');
      for (const f of facts.formulas) expect(normalizeFormula(calc.cells.get(f.address)?.formula), f.address).toBe(normalizeFormula(f.formula));
    });

    it('keeps constants, dates and number formats', () => {
      const data = wb.sheet('Veriler');
      facts.rows.forEach((r, i) => {
        const row = i + 2;
        expect(data.cells.get(`A${row}`)?.value).toBe(r.city);
        expect(data.cells.get(`B${row}`)?.value).toBe(r.region);
        expectSame(data.cells.get(`C${row}`)?.value, r.population, `C${row}`);
        expectSame(data.cells.get(`D${row}`)?.value, r.area, `D${row}`);
        expectSame(data.cells.get(`E${row}`)?.value, r.founded, `E${row}`);
        expectSame(data.cells.get(`F${row}`)?.value, r.growth, `F${row}`);
        expect(normalizeNumFmt(data.cells.get(`F${row}`)?.numFmt)).toBe(normalizeNumFmt(formatAfterSave(facts.dataFormats.growth, locale)));
        expect(normalizeNumFmt(data.cells.get(`E${row}`)?.numFmt)).toBe(normalizeNumFmt(formatAfterSave(facts.dataFormats.founded, locale)));
      });
      for (const f of facts.formats) {
        const cell = wb.sheet(f.sheet).cells.get(f.address);
        expect(normalizeNumFmt(cell?.numFmt), `${f.address} format`).toBe(normalizeNumFmt(formatAfterSave(f.numFmt, locale)));
        expectSame(cell?.value, f.value, `${f.address} value`);
      }
    });

    it.runIf(locale === 'tr-TR')('known locale effect: percent and date formats are rewritten on save (0.00% → %0.00, dd.mm.yyyy → dd/mm/yyyy)', () => {
      // Turkish convention puts % first; "/" is the OOXML date-separator placeholder. How other Excel
      // installations render the rewritten codes cannot be verified here; the compatibility notes must say so.
      const data = wb.sheet('Veriler');
      expect(data.cells.get('F2')?.numFmt).toBe('%0.00');
      expect(data.cells.get('E2')?.numFmt).toBe('dd/mm/yyyy');
      expect(wb.sheet('Biçimler').cells.get('B11')?.numFmt).toBe('dd/mm/yyyy hh:mm');
    });

    it('keeps merged cells, frozen panes, data validation, conditional formatting and the defined name', () => {
      expect(wb.sheets.map((s) => s.name)).toEqual(facts.sheets);
      expect(wb.sheet('Biçimler').merges).toEqual(facts.merges['Biçimler']);
      expect(wb.sheet('Veriler').frozen).toEqual(facts.frozen['Veriler']);
      const dv = facts.dataValidations['Veriler']!;
      for (const address of expandRange(dv.range)) {
        // LibreOffice also writes a meaningless formula2 ("0") for list validations; only formula1 matters.
        const v = wb.sheet('Veriler').dataValidations.get(address);
        expect({ type: v?.type, formula1: v?.formulae[0] }, address).toEqual({ type: dv.type, formula1: dv.formula });
      }
      expect(wb.sheet('Veriler').conditionalFormats.map((c) => c.ref)).toEqual(facts.conditionalFormats['Veriler']);
      expect(wb.definedNames['Nufus']).toEqual([facts.definedNames['Nufus']]);
    });
  });

  // ---------------------------------------------------------------------------------------- PPTX
  describe('PPTX round trip (open → save as PPTX)', () => {
    let facts: PptxFacts;
    let slides: PptxSlide[];

    beforeAll(async () => {
      facts = corpus.facts<PptxFacts>('pptx-basic');
      slides = await pptxSlides(await en.roundTrip(corpus.path('pptx-basic'), join(OUT, 'pptx')));
    });

    it('keeps the slide count, titles and Turkish texts', () => {
      expect(slides).toHaveLength(facts.slideCount);
      slides.forEach((s, i) => {
        expect(s.title).toBe(facts.slides[i]!.title);
        for (const t of facts.slides[i]!.texts) expect(s.texts, t).toContain(t);
      });
    });

    it('keeps bullet levels, speaker notes, the picture and the table', () => {
      const body = slides[1]!.paragraphs.filter((p) => p.placeholder !== 'title' && p.text.trim() !== '');
      expect(body.map((p) => p.level)).toEqual(facts.slides[1]!.bulletLevels);
      slides.forEach((s, i) => {
        expect(s.notes).toBe(facts.slides[i]!.notes);
        expect(s.imageCount).toBe(facts.slides[i]!.images);
      });
      expect(slides[2]!.tables).toEqual([facts.slides[2]!.table]);
    });
  });

  // ---------------------------------------------------------------------------------------- derived formats
  describe('derived formats written by npm run corpus:generate', () => {
    it('ODT keeps text, headings, table, header/footer, comment and picture', async () => {
      const facts = corpus.facts<DocxFacts>('docx-basic');
      const odt = await odfText(corpus.path('docx-basic-odt'));
      expect(odt.mimetype).toBe('application/vnd.oasis.opendocument.text');
      for (const t of facts.texts) expect(odt.paragraphs).toContain(t);
      expect(odt.headings).toEqual(facts.headings);
      expect(odt.tables).toEqual([facts.table]);
      expect(odt.headers).toContain(facts.header);
      expect(odt.footers.some((f) => f.startsWith(facts.footerPrefix))).toBe(true);
      expect(odt.annotations).toEqual(facts.comments);
      expect(odt.images).toBe(1);
    });

    it('ODS keeps data and formulas with recalculated values', async () => {
      const facts = corpus.facts<XlsxFacts>('xlsx-basic');
      const sheets = await odsSheets(corpus.path('xlsx-basic-ods'));
      expect(sheets.map((s) => s.name)).toEqual(facts.sheets);
      const calc = sheets.find((s) => s.name === 'Hesaplar')!;
      for (const f of facts.formulas) {
        const cell = calc.cells.get(f.address)!;
        expect(cell.formula, f.address).toMatch(/^of:=/);
        const value = cell.valueType === 'date' ? isoToSerial(String(cell.value)) : cell.value;
        expectSame(value ?? undefined, f.expected, `${f.address} ${f.formula}`);
      }
      const data = sheets.find((s) => s.name === 'Veriler')!;
      expect(data.cells.get('A7')?.value).toBe('Iğdır');
    });

    it('ODP keeps slide texts, notes and pictures', async () => {
      const facts = corpus.facts<PptxFacts>('pptx-basic');
      const pages = await odpPages(corpus.path('pptx-basic-odp'));
      expect(pages).toHaveLength(facts.slideCount);
      pages.forEach((p, i) => {
        for (const t of facts.slides[i]!.texts) expect(p.texts, t).toContain(t);
        expect(p.notes).toBe(facts.slides[i]!.notes);
        expect(p.images).toBe(facts.slides[i]!.images);
      });
      expect(pages[2]!.tables).toEqual([facts.slides[2]!.table]);
    });

    it('CSV (tr-TR: ";", decimal comma, UTF-8 BOM) and CSV/TSV (en-US) match the locale oracle', () => {
      const facts = corpus.facts<XlsxFacts>('xlsx-basic');
      const trCsv = readText(corpus.path('xlsx-basic-csv-tr'));
      expect(trCsv.bom).toBe(true);
      expect(trCsv.lines).toEqual(facts.csv['tr-TR'].lines);
      const enCsv = readText(corpus.path('xlsx-basic-csv-en'));
      expect(enCsv.bom).toBe(false);
      expect(enCsv.lines).toEqual(facts.csv['en-US'].lines);
      expect(readText(corpus.path('xlsx-basic-tsv-en')).lines).toEqual(facts.tsv['en-US'].lines);
    });

    it('TXT (UTF-8 with BOM) and RTF contain the document text', () => {
      const facts = corpus.facts<DocxFacts>('docx-basic');
      const txt = readText(corpus.path('docx-basic-txt'));
      expect(txt.bom).toBe(true);
      for (const t of facts.texts.filter((x) => !facts.bullets.includes(x))) expect(txt.lines).toContain(t);
      for (const b of facts.bullets) expect(txt.lines.some((l) => l.trim().endsWith(b))).toBe(true);
      const rtf = rtfText(readFileSync(corpus.path('docx-basic-rtf'), 'latin1'));
      for (const t of facts.texts) expect(rtf, t).toContain(t);
    });

    it('DOC, XLS and PPT reopen in LibreOffice with their content', async () => {
      const docx = await docxDocument(await en.convert(corpus.path('docx-basic-doc'), convertTarget('docx', 'MS Word 2007 XML'), { outDir: join(OUT, 'legacy') }));
      const dfacts = corpus.facts<DocxFacts>('docx-basic');
      for (const t of dfacts.texts) expect(docx.paragraphs.map((p) => p.text)).toContain(t);
      expect(docx.tables[0]).toEqual(dfacts.table);

      const xfacts = corpus.facts<XlsxFacts>('xlsx-basic');
      const wb = await xlsxWorkbook(await en.convert(corpus.path('xlsx-basic-xls'), convertTarget('xlsx', 'Calc MS Excel 2007 XML'), { outDir: join(OUT, 'legacy') }));
      for (const f of xfacts.formulas) expectSame(wb.sheet('Hesaplar').cells.get(f.address)?.value, f.expected, `${f.address} ${f.formula}`);

      const pfacts = corpus.facts<PptxFacts>('pptx-basic');
      const slides = await pptxSlides(await en.convert(corpus.path('pptx-basic-ppt'), convertTarget('pptx', 'Impress MS PowerPoint 2007 XML'), { outDir: join(OUT, 'legacy') }));
      expect(slides).toHaveLength(pfacts.slideCount);
      slides.forEach((s, i) => {
        for (const t of pfacts.slides[i]!.texts) expect(s.texts, t).toContain(t);
        expect(s.notes).toBe(pfacts.slides[i]!.notes);
      });
    });

    it('templates and the slideshow carry their own package content types and the content', async () => {
      const ct = 'application/vnd.openxmlformats-officedocument';
      expect(await mainContentType(corpus.path('docx-basic-dotx'))).toBe(`${ct}.wordprocessingml.template.main+xml`);
      expect(await mainContentType(corpus.path('xlsx-basic-xltx'))).toBe(`${ct}.spreadsheetml.template.main+xml`);
      expect(await mainContentType(corpus.path('pptx-basic-potx'))).toBe(`${ct}.presentationml.template.main+xml`);
      expect(await mainContentType(corpus.path('pptx-basic-ppsx'))).toBe(`${ct}.presentationml.slideshow.main+xml`);
      const dfacts = corpus.facts<DocxFacts>('docx-basic');
      const dotx = await docxDocument(corpus.path('docx-basic-dotx'));
      for (const t of dfacts.texts) expect(dotx.paragraphs.map((p) => p.text)).toContain(t);
      const pfacts = corpus.facts<PptxFacts>('pptx-basic');
      for (const id of ['pptx-basic-potx', 'pptx-basic-ppsx']) {
        const slides = await pptxSlides(corpus.path(id));
        expect(slides.map((s) => s.title)).toEqual(pfacts.slides.map((s) => s.title));
      }
      const xltx = await xlsxWorkbook(corpus.path('xlsx-basic-xltx'));
      const xfacts = corpus.facts<XlsxFacts>('xlsx-basic');
      for (const f of xfacts.formulas) expectSame(xltx.sheet('Hesaplar').cells.get(f.address)?.value, f.expected, `${f.address}`);
    });
  });

  // ---------------------------------------------------------------------------------------- third-party samples
  describe('third-party Office samples', () => {
    // ------------------------------------------------------------------ macros (VBA)
    // DOCM/PPTM: Writer and Impress keep the imported VBA storage and write it back (research: formats.md,
    // "DOCM and PPTM export copy the original VBA binary"). XLSM: Calc rebuilds vbaProject.bin from its
    // Basic modules (VbaExport), so the file is regenerated and only its content can be compared.
    const macroRuns = new Map<string, Promise<{ before: VbaProject; after: VbaProject }>>();
    /** Saves a macro sample once with its VBA filter; the VBA project before and after. */
    function macroRoundTrip(id: string): Promise<{ before: VbaProject; after: VbaProject }> {
      let run = macroRuns.get(id);
      if (!run) {
        run = (async () => {
          const s = sample(id);
          const vbaPart = String(s.expect['vbaPart']);
          const ext = s.abs.slice(s.abs.lastIndexOf('.') + 1);
          const out = await en.convert(s.abs, convertTarget(ext, String(s.expect['saveFilter'])), { outDir: join(OUT, `third-party-vba-${id}`) });
          const before = await (await openPackage(s.abs)).bytes(vbaPart);
          const after = await (await openPackage(out)).bytes(vbaPart);
          if (!before || !after) throw new Error(`${vbaPart} missing ${before ? 'after saving' : 'in the sample'}`);
          return { before: vbaProject(before), after: vbaProject(after) };
        })();
        macroRuns.set(id, run);
      }
      return run;
    }
    const moduleList = (p: VbaProject) => p.modules.map(({ name, type, streamName }) => ({ name, type, streamName }));
    const code = (p: VbaProject, strip: (source: string) => string = (s) => s) => p.modules.map((m) => ({ name: m.name, source: strip(m.source).trimEnd() }));
    /** Procedure attribute lines (`Attribute TestMacro.VB_Description = …`); module attributes (`Attribute VB_Name`) stay. */
    const withoutProcedureAttributes = (source: string) =>
      source
        .split('\n')
        .filter((l) => !/^Attribute \w+\.VB_/.test(l))
        .join('\n');
    const streamHashes = (p: VbaProject) => new Map([...p.streams].map(([path, data]) => [path, sha(data)]));

    it.each([['poi-macro-docm'], ['poi-macro-pptm'], ['poi-macro-xlsm']])('%s: the VBA project keeps its name, modules (names, types, order) and module declarations', async (id) => {
      const { before, after } = await macroRoundTrip(id);
      expect(before.modules.length).toBeGreaterThan(0);
      expect(after.name).toBe(before.name);
      expect(after.codePage).toBe(before.codePage);
      expect(moduleList(after)).toEqual(moduleList(before));
      expect(after.declarations).toEqual(before.declarations);
    });

    it.each([['poi-macro-docm'], ['poi-macro-pptm']])('%s: every module keeps its source code exactly', async (id) => {
      const { before, after } = await macroRoundTrip(id);
      expect(code(after)).toEqual(code(before));
    });

    it.each([['poi-macro-docm'], ['poi-macro-pptm']])('%s: known behaviour — every stream of vbaProject.bin is carried over unchanged', async (id) => {
      // Stream-level passthrough, including the compiled-code caches (__SRP_*), protection and workspace
      // data. The compound file around the streams is written anew (other size and bytes, measured
      // 2026-09-29), so a byte comparison of vbaProject.bin would fail although nothing changed.
      const { before, after } = await macroRoundTrip(id);
      expect(streamHashes(after)).toEqual(streamHashes(before));
    });

    it('poi-macro-xlsm: known loss — the code of every module survives but procedure attributes (macro description, shortcut key) are dropped', async () => {
      const { before, after } = await macroRoundTrip('poi-macro-xlsm');
      expect(code(after)).toEqual(code(before, withoutProcedureAttributes));
      const all = (p: VbaProject) => p.modules.map((m) => m.source).join('\n');
      expect(all(before)).toMatch(/^Attribute TestMacro\.VB_Description = "This is a test macro"$/m);
      expect(all(before)).toMatch(/^Attribute TestMacro\.VB_ProcData\.VB_Invoke_Func = /m);
      expect(all(after)).not.toMatch(/VB_Description|VB_Invoke_Func/);
    });

    it('poi-macro-xlsm: known behaviour — Calc regenerates vbaProject.bin: new project ID, no compiled-code caches, version-independent _VBA_PROJECT', async () => {
      // Office recompiles from source when _VBA_PROJECT carries no performance cache ([MS-OVBA] 2.3.4.1:
      // Reserved1 0x61CC, Version 0xFFFF). Whether Excel accepts the rebuilt project is not verified here.
      const { before, after } = await macroRoundTrip('poi-macro-xlsm');
      expect(before.id).toMatch(/^\{[0-9A-F-]{36}\}$/i);
      expect(after.id).toMatch(/^\{[0-9A-F-]{36}\}$/i);
      expect(after.id).not.toBe(before.id);
      const srp = (p: VbaProject) => [...p.streams.keys()].filter((k) => /\/__SRP_\d+$/.test(k));
      expect(srp(before).length).toBeGreaterThan(0);
      expect(srp(after)).toEqual([]);
      expect(before.streams.get('VBA/_VBA_PROJECT')!.length).toBeGreaterThan(7);
      expect(after.streams.get('VBA/_VBA_PROJECT')!.toString('hex')).toBe('cc61ffff000000');
    });

    // ------------------------------------------------------------------ other samples (open → save in the same format)
    const roundTrips = new Map<string, Promise<string>>();
    /** Round trip of a third-party sample in its own format, once per sample (several tests read it). */
    function roundTripped(id: string): Promise<string> {
      let run = roundTrips.get(id);
      if (!run) {
        run = en.roundTrip(sample(id).abs, join(OUT, `third-party-${id}`));
        roundTrips.set(id, run);
      }
      return run;
    }

    it.each([['poi-smartart-pptx'], ['poi-charts-xlsx'], ['poi-pivot-xlsx']])('%s: SmartArt/chart/pivot parts survive a round trip', async (id) => {
      const s = sample(id);
      const pattern = new RegExp(String(s.expect['partPattern']));
      expect(await partNames(s.abs, pattern)).toHaveLength(Number(s.expect['partCount']));
      expect(await partNames(await roundTripped(id), pattern)).toHaveLength(Number(s.expect['partCount']));
    });

    it('poi-smartart-pptx: slide texts survive', async () => {
      const s = sample('poi-smartart-pptx');
      const before = await pptxSlides(s.abs);
      const after = await pptxSlides(await roundTripped('poi-smartart-pptx'));
      expect(after.map((x) => x.texts)).toEqual(before.map((x) => x.texts));
    });

    it('poi-charts-docx: the four DrawingML charts survive', async () => {
      const s = sample('poi-charts-docx');
      const pkg = await openPackage(await roundTripped('poi-charts-docx'));
      const charts = pkg.parts.filter((p) => /^word\/charts\/chart\d+\.xml$/.test(p));
      const kinds: string[] = [];
      for (const c of charts) kinds.push(...((await pkg.text(c))!.match(/<c:(bar|line|radar|stock)Chart>/g) ?? []));
      expect(kinds.sort()).toEqual(['<c:barChart>', '<c:lineChart>', '<c:radarChart>', '<c:stockChart>']);
      expect(charts).toHaveLength(Number(s.expect['classicCharts']));
    });

    it('poi-charts-docx: known loss — chartEx charts in DOCX are replaced by their fallback pictures', async () => {
      // Documents current engine behaviour for the loss-risk analysis: if this starts failing,
      // LibreOffice changed how it handles chartEx in Writer; update the compatibility notes.
      const s = sample('poi-charts-docx');
      const before = await openPackage(s.abs);
      for (const part of s.expect['chartExParts'] as string[]) expect(await before.text(part)).toContain('chartex');
      const after = await openPackage(await roundTripped('poi-charts-docx'));
      const chartParts = after.parts.filter((p) => /^word\/charts\/chart\d+\.xml$/.test(p));
      for (const part of chartParts) expect(await after.text(part)).not.toContain('chartex');
      const docBefore = (await before.text('word/document.xml'))!;
      const docAfter = (await after.text('word/document.xml'))!;
      const count = (s2: string, re: RegExp) => s2.match(re)?.length ?? 0;
      expect(count(docBefore, /<w:drawing>/g)).toBe(8);
      expect(count(docAfter, /<w:drawing>/g)).toBe(8 - 2); // two AlternateContent wrappers collapse to their fallback
      expect(count(docAfter, /<a:blip /g)).toBe(count(docBefore, /<a:blip /g));
    });

    it('poi-tracked-changes-docx: inserted and deleted text survive (LibreOffice may split revisions)', async () => {
      const s = sample('poi-tracked-changes-docx');
      const before = await docxDocument(s.abs);
      const after = await docxDocument(await roundTripped('poi-tracked-changes-docx'));
      expect(before.insertions.length).toBeGreaterThan(0);
      expect(after.insertions.map((x) => x.text).join('')).toBe(before.insertions.map((x) => x.text).join(''));
      expect(after.deletions.map((x) => x.text).join('')).toBe(before.deletions.map((x) => x.text).join(''));
      expect(after.text).toBe(before.text);
    });

    it('poi-notes-pptx: slides and notes survive', async () => {
      const s = sample('poi-notes-pptx');
      const before = await pptxSlides(s.abs);
      const after = await pptxSlides(await roundTripped('poi-notes-pptx'));
      expect(before).toHaveLength(Number(s.expect['slides']));
      expect(after.map((x) => x.texts)).toEqual(before.map((x) => x.texts));
      expect(after.map((x) => x.notes)).toEqual(before.map((x) => x.notes));
    });

    it('poi-notes-pptx: known change — the slide master text styles (p:txStyles) written by PowerPoint are not written back', async () => {
      // LibreOffice writes its own outline list styles into the layouts instead. Paragraph properties a
      // slide inherited from p:txStyles can therefore change; the visual test shows the effect on the
      // generated deck (known change "pptx-master-text-styles").
      const masterTextStyles = async (path: string) => {
        const pkg = await openPackage(path);
        const masters = pkg.parts.filter((p) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(p));
        return Promise.all(masters.map(async (m) => kid((await pkg.xml(m))!, NS.p, 'txStyles') !== undefined));
      };
      const before = await masterTextStyles(sample('poi-notes-pptx').abs);
      expect(before.length).toBeGreaterThan(0);
      expect(before.every(Boolean)).toBe(true);
      const after = await masterTextStyles(await roundTripped('poi-notes-pptx'));
      expect(after.length).toBeGreaterThan(0);
      expect(after.some(Boolean)).toBe(false);
    });

    it('legacy DOC/XLS/PPT: text stored in the binaries reappears in the converted OOXML', async () => {
      const inBinary = (buf: Buffer, t: string) => buf.includes(Buffer.from(t, 'latin1')) || buf.includes(Buffer.from(t, 'utf16le'));
      const doc = sample('poi-legacy-doc');
      const docTexts = doc.expect['texts'] as string[];
      for (const t of docTexts) expect(inBinary(readFileSync(doc.abs), t), `oracle ${t}`).toBe(true);
      const docx = await docxDocument(await en.convert(doc.abs, convertTarget('docx', 'MS Word 2007 XML'), { outDir: join(OUT, 'third-party-legacy') }));
      for (const t of docTexts) expect(docx.paragraphs.map((p) => p.text)).toContain(t);

      const xls = sample('poi-legacy-xls');
      for (const t of [...(xls.expect['texts'] as string[]), ...(xls.expect['sheets'] as string[])]) expect(inBinary(readFileSync(xls.abs), t), `oracle ${t}`).toBe(true);
      const wb = await xlsxWorkbook(await en.convert(xls.abs, convertTarget('xlsx', 'Calc MS Excel 2007 XML'), { outDir: join(OUT, 'third-party-legacy') }));
      expect(wb.sheets.map((x) => x.name)).toEqual(xls.expect['sheets']);
      const values = wb.sheets.flatMap((x) => [...x.cells.values()].map((c) => c.value));
      for (const t of xls.expect['texts'] as string[]) expect(values).toContain(t);

      const ppt = sample('poi-legacy-ppt');
      for (const t of ppt.expect['texts'] as string[]) expect(inBinary(readFileSync(ppt.abs), t), `oracle ${t}`).toBe(true);
      const slides = await pptxSlides(await en.convert(ppt.abs, convertTarget('pptx', 'Impress MS PowerPoint 2007 XML'), { outDir: join(OUT, 'third-party-legacy') }));
      expect(slides).toHaveLength(Number(ppt.expect['slides']));
      for (const t of ppt.expect['texts'] as string[]) expect(slides.flatMap((x) => x.texts)).toContain(t);
    });

    it('password-protected XLSX: loading without the password fails fast instead of hanging', async () => {
      const s = sample('poi-encrypted-xlsx');
      expect(isEncryptedOoxml(readFileSync(s.abs))).toBe(true);
      // A hang would end in SofficeTimeoutError after 90 s; the elapsed-time bound leaves room for a busy machine.
      const started = Date.now();
      await expect(en.convert(s.abs, 'pdf', { outDir: join(OUT, 'third-party-encrypted'), timeoutMs: 90_000 })).rejects.toBeInstanceOf(SofficeConversionError);
      expect(Date.now() - started).toBeLessThan(45_000);
    });

    it('password-protected DOCX: known hazard — headless LibreOffice imports the encrypted container as plain text', async () => {
      // Callers must detect encryption themselves (isEncryptedOoxml) and ask for the password first;
      // LibreOffice does not fail here, it falls back to the text filter and "converts" the raw container.
      const s = sample('poi-encrypted-docx');
      const buf = readFileSync(s.abs);
      expect(isEncryptedOoxml(buf)).toBe(true);
      const out = await en.convert(s.abs, convertTarget('txt', 'Text (encoded)', 'UTF8'), { outDir: join(OUT, 'third-party-encrypted') });
      const text = readText(out).text;
      expect(text.length).toBeGreaterThan(buf.length * 0.9); // every container byte became a character
      expect(text).not.toContain('<w:document');
    });
  });

  it('leaves no soffice process behind', async () => {
    expect(await en.leftovers()).toEqual([]);
    expect(await tr.leftovers()).toEqual([]);
  });
});
