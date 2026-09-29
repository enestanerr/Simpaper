/**
 * Visual round-trip check: original and LibreOffice-round-tripped DOCX/XLSX/PPTX are exported to PDF by
 * headless LibreOffice and rasterised by pdf.js (an independent renderer) at 108 dpi; pages are compared
 * with pixelmatch (colour threshold 0.1, anti-aliased pixels ignored). Rendering is deterministic — the
 * same file rendered twice differs in 0 px — so the budget is strict (measurements and reasoning:
 * docs/dev/testing-corpus.md, "Visual budget"):
 *
 * - at most BUDGET.maxWindowPixels differing pixels in any 32 × 32 px window. The smallest change measured,
 *   one letter (e → a) in 11 pt body text, differs in 26 px of one window; a changed word in ~200 px.
 *   Changes of a single diacritic (2–4 px, e.g. ı → i) stay below it; the text checks of
 *   independent.test.ts cover those;
 * - at most BUDGET.maxRatio differing pixels per page, for diffuse changes spread thinner than the window
 *   budget.
 *
 * KNOWN CHANGES. Round-trip changes that LibreOffice makes and that are documented as findings are part of
 * the expectation, not tolerated noise: the round trip must look exactly like the original with the
 * documented XML change applied (built with patchPackage, rendered the same way), within the same strict
 * budget. So a new regression on those pages still fails, the XML of each change is asserted, and the test
 * reports when LibreOffice stops making a change (then update the finding).
 *
 * SENSITIVITY. A one-word change (corpus variants *-changed) and a one-letter change (built here) must fail
 * the budget — proof that the budget sees what it is meant to see.
 *
 * Diff images are kept in test-output/visual only for failing comparisons. Set VARAK_VISUAL_REPORT=<file>
 * to append every measurement as JSON lines when re-deriving the budget.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ensureGeneratedCorpus, type Corpus } from '../tools/corpus';
import { openPackage, patchPackage, relKind, replaceOnce, type OpcPackage } from '../tools/opc';
import { CORPUS_OUTPUT, VISUAL_OUTPUT } from '../tools/paths';
import { pdfInfo, renderPdfPages } from '../tools/pdf';
import { ENGINE_VERSION, Soffice, hasEngine } from '../tools/soffice';
import { comparePng, describeDiff, inkRatio, type CompareResult, type DiffBudget } from '../tools/visual';
import { NS, attr, descendants, kid, kids, type XElement } from '../tools/xml';

const OUT = join(CORPUS_OUTPUT, 'visual-work');
/** pdf.js scale: 1.5 × 72 dpi = 108 dpi. */
const SCALE = 1.5;
/** Strict budget for pages that must look the same (32 × 32 px windows, the default of comparePng). */
const BUDGET = { maxRatio: 0.0002, maxWindowPixels: 8 } as const satisfies DiffBudget;

function report(entry: Record<string, unknown>, r: CompareResult): void {
  const file = process.env['VARAK_VISUAL_REPORT'];
  if (!file) return;
  const measured = { ratio: r.ratio, diffPixels: r.diffPixels, windowPixels: r.hotspot.diffPixels, bounds: r.bounds };
  appendFileSync(file, `${JSON.stringify({ engine: ENGINE_VERSION, scale: SCALE, ...entry, ...measured })}\n`);
}

// ------------------------------------------------------------------------------------------ known changes
const W = NS.w;
const A = NS.a;
const P = NS.p;
const el = (parent: XElement | undefined, ns: string, local: string) => (parent ? kid(parent, ns, local) : undefined);

interface KnownChange {
  /** Short id used in test names, reports and docs/dev/testing-corpus.md. */
  id: string;
  /** 0-based pages whose rendering the change affects. */
  pages: number[];
  /** What LibreOffice writes instead of the original markup. */
  summary: string;
  /** Asserts on both packages that the round trip wrote exactly the documented change. */
  verify(original: OpcPackage, roundTripped: OpcPackage): Promise<void>;
  /** The documented change as text edits of the generated package: the expected state after the round trip. */
  edits: Record<string, (xml: string) => string>;
}

/** Numbering level used by the first numbered paragraph of a DOCX (numFmt, lvlText and bullet font). */
async function docxFirstListLevel(pkg: OpcPackage): Promise<{ numFmt?: string; lvlText?: string; font?: string }> {
  const document = (await pkg.xml('word/document.xml'))!;
  const numPr = descendants(document, W, 'numPr')[0];
  expect(numPr, 'a numbered paragraph').toBeDefined();
  const numId = attr(el(numPr, W, 'numId')!, W, 'val');
  const ilvl = attr(el(numPr, W, 'ilvl')!, W, 'val') ?? '0';
  const numberingPart = (await pkg.relationships('word/document.xml')).find((r) => relKind(r.type) === 'numbering')?.part;
  const numbering = numberingPart ? await pkg.xml(numberingPart) : undefined;
  expect(numbering, 'numbering part').toBeDefined();
  const num = kids(numbering!, W, 'num').find((n) => attr(n, W, 'numId') === numId);
  const abstractId = attr(el(num, W, 'abstractNumId')!, W, 'val');
  const abstract = kids(numbering!, W, 'abstractNum').find((a) => attr(a, W, 'abstractNumId') === abstractId);
  const lvl = abstract ? kids(abstract, W, 'lvl').find((l) => attr(l, W, 'ilvl') === ilvl) : undefined;
  expect(lvl, `level ${ilvl} of numbering ${numId}`).toBeDefined();
  const rFonts = el(el(lvl, W, 'rPr'), W, 'rFonts');
  return { numFmt: attr(el(lvl, W, 'numFmt')!, W, 'val'), lvlText: attr(el(lvl, W, 'lvlText')!, W, 'val'), font: rFonts ? attr(rFonts, W, 'ascii') : undefined };
}

/** Space-before and bullet-size children of a DrawingML paragraph-properties element. */
function spacingAndBulletSize(pPr: XElement | undefined): { spcBef?: string; buSzPct?: string; hasBuSz: boolean } {
  const pts = el(el(pPr, A, 'spcBef'), A, 'spcPts');
  const pct = el(pPr, A, 'buSzPct');
  return {
    spcBef: pts ? attr(pts, '', 'val') : undefined,
    buSzPct: pct ? attr(pct, '', 'val') : undefined,
    hasBuSz: ['buSzPct', 'buSzPts', 'buSzTx'].some((n) => el(pPr, A, n) !== undefined),
  };
}

/** Part names of slide `index` (0-based, presentation order), its layout and the master. */
async function pptxSlideChain(pkg: OpcPackage, index: number): Promise<{ slide: string; layout: string; master: string }> {
  const presRels = await pkg.relationships('ppt/presentation.xml');
  const pres = (await pkg.xml('ppt/presentation.xml'))!;
  const sldId = kids(el(pres, P, 'sldIdLst')!, P, 'sldId')[index]!;
  const slide = presRels.find((r) => r.id === attr(sldId, NS.r, 'id'))!.part!;
  const layout = (await pkg.relationships(slide)).find((r) => relKind(r.type) === 'slideLayout')!.part!;
  const master = (await pkg.relationships(layout)).find((r) => relKind(r.type) === 'slideMaster')!.part!;
  return { slide, layout, master };
}

const KNOWN_CHANGES: Record<string, KnownChange[]> = {
  'docx-basic': [
    {
      id: 'docx-bullet-symbol-font',
      pages: [0],
      summary: 'the bullet "•" (U+2022 in the paragraph font) as U+F0B7 in the Symbol font',
      async verify(original, roundTripped) {
        expect(await docxFirstListLevel(original)).toEqual({ numFmt: 'bullet', lvlText: '•', font: undefined });
        expect(await docxFirstListLevel(roundTripped)).toEqual({ numFmt: 'bullet', lvlText: '', font: 'Symbol' });
      },
      edits: {
        'word/numbering.xml': (xml) =>
          replaceOnce(
            replaceOnce(xml, '<w:lvlText w:val="•"/>', '<w:lvlText w:val=""/>'),
            '</w:pPr></w:lvl>',
            '</w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:cs="Symbol" w:hint="default"/></w:rPr></w:lvl>',
          ),
      },
    },
  ],
  'pptx-basic': [
    {
      id: 'pptx-master-text-styles',
      pages: [1],
      summary: "no master text styles (p:txStyles) and LibreOffice's own outline list styles in the layouts (level 2: 11.34 pt space before, bullet at 75 %)",
      async verify(original, roundTripped) {
        // Original: level 2 of the master body style has neither space before nor a bullet size.
        const before = await pptxSlideChain(original, 1);
        const bodyStyle = el(el((await original.xml(before.master))!, P, 'txStyles'), P, 'bodyStyle');
        expect(bodyStyle, 'original master body style').toBeDefined();
        expect(spacingAndBulletSize(el(bodyStyle, A, 'lvl2pPr'))).toEqual({ spcBef: undefined, buSzPct: undefined, hasBuSz: false });

        // Round trip: no master text styles; the layout's body placeholder defines level 2 itself …
        const after = await pptxSlideChain(roundTripped, 1);
        expect(el((await roundTripped.xml(after.master))!, P, 'txStyles'), 'p:txStyles in the round-tripped master').toBeUndefined();
        const body = descendants((await roundTripped.xml(after.layout))!, P, 'sp').find((sp) => {
          const ph = el(el(el(sp, P, 'nvSpPr'), P, 'nvPr'), P, 'ph');
          return ph !== undefined && ['body', 'obj', undefined].includes(attr(ph, '', 'type'));
        });
        const lvl2 = el(el(el(body, P, 'txBody'), A, 'lstStyle'), A, 'lvl2pPr');
        expect(spacingAndBulletSize(lvl2)).toEqual({ spcBef: '1134', buSzPct: '75000', hasBuSz: true });
        // … and the level-2 paragraph on the slide does not override it.
        const paragraphs = descendants((await roundTripped.xml(after.slide))!, A, 'p');
        const level2 = paragraphs.map((p) => el(p, A, 'pPr')).filter((pPr) => pPr && attr(pPr, '', 'lvl') === '1');
        expect(level2).toHaveLength(1);
        expect(spacingAndBulletSize(level2[0])).toEqual({ spcBef: undefined, buSzPct: undefined, hasBuSz: false });
      },
      edits: {
        'ppt/slideMasters/slideMaster1.xml': (xml) =>
          replaceOnce(
            replaceOnce(xml, '<a:lvl2pPr marL="742950" indent="-285750">', '<a:lvl2pPr marL="742950" indent="-285750"><a:spcBef><a:spcPts val="1134"/></a:spcBef>'),
            '<a:buFont typeface="Arial"/><a:buChar char="–"/>',
            '<a:buSzPct val="75000"/><a:buFont typeface="Arial"/><a:buChar char="–"/>',
          ),
      },
    },
  ],
};

/** All edits of the known changes of one file, composed per part. */
function composeEdits(changes: KnownChange[]): Record<string, (xml: string) => string> {
  const out: Record<string, (xml: string) => string> = {};
  for (const change of changes) {
    for (const [part, edit] of Object.entries(change.edits)) {
      const previous = out[part];
      out[part] = previous ? (xml) => edit(previous(xml)) : edit;
    }
  }
  return out;
}

const CASES = [
  { id: 'docx-basic', pages: 2, changed: 'docx-changed', changedPage: 0 },
  { id: 'pptx-basic', pages: 3, changed: 'pptx-changed', changedPage: 1 },
  { id: 'xlsx-basic', pages: undefined, changed: undefined, changedPage: 0 },
] as const;

/** A one-letter change in 11 pt body text on page 1 of docx-basic ("sözcükler" → "sözcüklar"). */
const LETTER_PROBE = { from: '> sözcükler.<', to: '> sözcüklar.<' };

// ------------------------------------------------------------------------------------------ suite
describe.skipIf(!hasEngine)(`visual round trip through LibreOffice ${ENGINE_VERSION ?? ''} (pdf.js renders)`, () => {
  let corpus: Corpus;
  let soffice: Soffice;
  let failures = 0;
  const renders = new Map<string, Promise<{ pdf: string; pngs: Buffer[] }>>();

  /** PDF export of `path` rendered to PNG pages (cached per key). */
  function render(key: string, path: string): Promise<{ pdf: string; pngs: Buffer[] }> {
    let cached = renders.get(key);
    if (!cached) {
      cached = soffice.toPdf(path, join(OUT, key)).then(async (pdf) => ({ pdf, pngs: await renderPdfPages(pdf, SCALE) }));
      renders.set(key, cached);
    }
    return cached;
  }
  const pages = async (key: string, path: string) => (await render(key, path)).pngs;

  /** Writes a patched copy of a corpus file (same extension, own folder) and returns its path. */
  async function patched(id: string, key: string, edits: Record<string, (xml: string) => string>): Promise<string> {
    const dir = join(OUT, `${key}-file`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${id}${extname(corpus.path(id))}`);
    writeFileSync(path, await patchPackage(corpus.path(id), edits));
    return path;
  }

  beforeAll(async () => {
    rmSync(OUT, { recursive: true, force: true });
    // Diff images of an earlier failing run of this suite are stale now.
    const prefixes = CASES.map((c) => `${c.id}-`);
    const stale = existsSync(VISUAL_OUTPUT) ? readdirSync(VISUAL_OUTPUT).filter((f) => prefixes.some((p) => f.startsWith(p))) : [];
    for (const f of stale) rmSync(join(VISUAL_OUTPUT, f), { force: true });
    corpus = await ensureGeneratedCorpus();
    soffice = Soffice.create({ name: 'visual' });
  });

  afterEach((ctx) => {
    if (ctx.task.result?.state === 'fail') failures++;
  });

  afterAll(async () => {
    await soffice?.dispose();
    // PDFs and renders are scratch; diff images of failed comparisons stay in test-output/visual.
    if (failures === 0) rmSync(OUT, { recursive: true, force: true });
  });

  describe.each(CASES)('$id', ({ id, pages: expectedPages, changed, changedPage }) => {
    const known = KNOWN_CHANGES[id] ?? [];
    const affected = new Set(known.flatMap((k) => k.pages));
    let original: Buffer[];
    let roundTripPath: string;
    let roundTripped: Buffer[];
    /** Renders of the original with the documented changes applied (= original when there are none). */
    let expected: Buffer[];

    beforeAll(async () => {
      original = await pages(`${id}-original`, corpus.path(id));
      roundTripPath = await soffice.roundTrip(corpus.path(id), join(OUT, `${id}-roundtrip-file`));
      roundTripped = await pages(`${id}-roundtrip`, roundTripPath);
      expected = known.length ? await pages(`${id}-known`, await patched(id, `${id}-known`, composeEdits(known))) : original;
    });

    it('renders non-blank pages', () => {
      if (expectedPages !== undefined) expect(original).toHaveLength(expectedPages);
      for (const p of original) expect(inkRatio(p)).toBeGreaterThan(0.001);
    });

    it(`looks the same after open → save${known.length ? ' (apart from the documented changes)' : ''}: ≤ ${BUDGET.maxWindowPixels} px per 32×32 window, ≤ ${BUDGET.maxRatio * 100} % per page`, () => {
      expect(roundTripped).toHaveLength(expected.length);
      expected.forEach((png, i) => {
        const r = comparePng(png, roundTripped[i]!, { ...BUDGET, name: `${id}-roundtrip-p${i + 1}` });
        report({ case: id, kind: known.length ? 'roundtrip-vs-original-with-known-changes' : 'roundtrip', page: i + 1 }, r);
        expect(r.passed, `page ${i + 1}: ${describeDiff(r)}`).toBe(true);
      });
    });

    for (const change of known) {
      it(`known change "${change.id}" (LibreOffice ${ENGINE_VERSION ?? '?'}): the round trip writes ${change.summary}`, async () => {
        await change.verify(await openPackage(corpus.path(id)), await openPackage(roundTripPath));
      });
    }

    if (known.length > 0) {
      it(`known changes are still visible on page(s) ${[...affected].map((p) => p + 1).join(', ')} and nowhere else`, () => {
        original.forEach((png, i) => {
          const r = comparePng(png, roundTripped[i]!, { ...BUDGET, writeDiff: 'never' });
          report({ case: id, kind: 'roundtrip-vs-original', page: i + 1 }, r);
          const message = affected.has(i)
            ? `page ${i + 1} no longer differs from the original: LibreOffice stopped making a documented change (${known.map((k) => k.id).join(', ')}). Remove it from KNOWN_CHANGES and update docs/dev/testing-corpus.md`
            : `page ${i + 1}: ${describeDiff(r)}`;
          expect(r.passed, message).toBe(!affected.has(i));
        });
      });
    }

    it.runIf(changed !== undefined)('detects a one-word change: only the changed page fails the budget', async () => {
      const variant = await pages(`${changed}-original`, corpus.path(changed!));
      expect(variant).toHaveLength(original.length);
      original.forEach((png, i) => {
        const r = comparePng(png, variant[i]!, { ...BUDGET, writeDiff: 'never' });
        report({ case: id, kind: 'one-word-change', page: i + 1 }, r);
        expect(r.passed, `page ${i + 1}: ${describeDiff(r)}`).toBe(i !== changedPage);
      });
    });
  });

  it('renders the same document identically twice (premise of the strict budget)', async () => {
    // Fresh export + render of the same file: if this fails, the renderer or the PDF export became
    // nondeterministic and every other comparison here is suspect.
    const first = await pages('docx-basic-original', corpus.path('docx-basic'));
    const again = await pages('docx-basic-again', corpus.path('docx-basic'));
    expect(again).toHaveLength(first.length);
    first.forEach((png, i) => {
      const r = comparePng(png, again[i]!, { writeDiff: 'never' });
      report({ case: 'docx-basic', kind: 'same-file-twice', page: i + 1 }, r);
      expect(r.diffPixels, `page ${i + 1}: ${describeDiff(r)}`).toBe(0);
    });
  });

  it('detects a one-letter change through the window budget (the page-level ratio alone would accept it)', async () => {
    const original = await pages('docx-basic-original', corpus.path('docx-basic'));
    const path = await patched('docx-basic', 'docx-letter', { 'word/document.xml': (xml) => replaceOnce(xml, LETTER_PROBE.from, LETTER_PROBE.to) });
    const variant = await pages('docx-letter', path);
    const r = comparePng(original[0]!, variant[0]!, { ...BUDGET, writeDiff: 'never' });
    report({ case: 'docx-basic', kind: 'one-letter-change', page: 1 }, r);
    expect(r.ratio, describeDiff(r)).toBeLessThanOrEqual(BUDGET.maxRatio);
    expect(r.hotspot.diffPixels, describeDiff(r)).toBeGreaterThan(BUDGET.maxWindowPixels);
    expect(r.passed).toBe(false);
    for (let i = 1; i < original.length; i++) expect(comparePng(original[i]!, variant[i]!, { ...BUDGET, writeDiff: 'never' }).passed).toBe(true);
  });

  it('exports the DOCX with the page count the generator laid out and A4 pages', async () => {
    const { pdf } = await render('docx-basic-original', corpus.path('docx-basic'));
    const info = await pdfInfo(pdf);
    expect(info.pages).toBe(2);
    for (const size of info.pageSizes) {
      expect(size.width).toBeCloseTo(595.3, 0);
      expect(size.height).toBeCloseTo(841.9, 0);
    }
  });

  it('leaves no soffice process behind', async () => {
    expect(await soffice.leftovers()).toEqual([]);
  });
});
