/**
 * Independent OOXML readers (no LibreOffice involved): DOCX and PPTX are parsed from the package XML,
 * XLSX is read with exceljs. They only read; they do not lay out, render or recalculate.
 */
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { mainPart, openPackage, relKind, type OpcPackage, type Relationship } from './opc';
import { NS, attr, descendants, isElement, kid, kids, textContent, type XElement } from './xml';

// =============================================================================================== DOCX
export interface DocxParagraph {
  text: string;
  styleId?: string;
  styleName?: string;
  /** Outline level from the paragraph or its style chain (0 = Heading 1). */
  outlineLevel?: number;
  numbered: boolean;
  inTable: boolean;
}

export interface DocxRun {
  text: string;
  /** Effective values: direct formatting, then character style, paragraph style chain, document defaults. */
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  charStyle?: string;
  paragraphIndex: number;
  inserted: boolean;
  deleted: boolean;
  hyperlink?: string;
}

export interface DocxSection {
  pageWidth?: number;
  pageHeight?: number;
  orient?: string;
  margins: { top?: number; right?: number; bottom?: number; left?: number; header?: number; footer?: number };
  headerRefs: number;
  footerRefs: number;
}

export interface DocxDocument {
  /** Body paragraphs in document order (table cells included). */
  paragraphs: DocxParagraph[];
  /** Visible body text, paragraphs joined with "\n" (deleted text excluded, inserted text included). */
  text: string;
  runs: DocxRun[];
  tables: string[][][];
  headers: string[];
  footers: string[];
  /** Field instructions used in headers/footers, e.g. `PAGE`. */
  headerFooterFields: string[];
  comments: { id: string; author: string; text: string }[];
  insertions: { author: string; text: string }[];
  deletions: { author: string; text: string }[];
  hyperlinks: { text: string; target?: string; anchor?: string }[];
  /** Pictures referenced from the body (`a:blip r:embed`). */
  pictures: { part: string; contentType?: string; bytes: number; descr?: string }[];
  sections: DocxSection[];
  styles: Map<string, StyleDef>;
  /** Language of the document defaults (w:lang). */
  defaultLanguage?: string;
}

interface Toggles {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
}

export interface StyleDef extends Toggles {
  id: string;
  name?: string;
  type?: string;
  basedOn?: string;
  outlineLevel?: number;
  isDefault: boolean;
}

const W = NS.w;
const wAttr = (el: XElement | undefined, name: string) => (el ? attr(el, W, name) : undefined);
const TRUE = ['1', 'true', 'on'];

function onOff(el: XElement | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = wAttr(el, 'val');
  return v === undefined || !['0', 'false', 'off', 'none'].includes(v.toLowerCase());
}

function readToggles(rPr: XElement | undefined): Toggles {
  if (!rPr) return {};
  return { b: onOff(kid(rPr, W, 'b')), i: onOff(kid(rPr, W, 'i')), u: onOff(kid(rPr, W, 'u')), strike: onOff(kid(rPr, W, 'strike')) };
}

async function readStyles(pkg: OpcPackage, rels: Relationship[]): Promise<{ styles: Map<string, StyleDef>; defaults: Toggles; language?: string }> {
  const styles = new Map<string, StyleDef>();
  const rel = rels.find((r) => relKind(r.type) === 'styles');
  const root = rel?.part ? await pkg.xml(rel.part) : undefined;
  if (!root) return { styles, defaults: {} };
  const docDefaults = kid(root, W, 'docDefaults');
  const rPrDefault = docDefaults ? kid(docDefaults, W, 'rPrDefault') : undefined;
  const defaultRPr = rPrDefault ? kid(rPrDefault, W, 'rPr') : undefined;
  for (const s of kids(root, W, 'style')) {
    const id = String(wAttr(s, 'styleId'));
    const pPr = kid(s, W, 'pPr');
    const outline = pPr ? wAttr(kid(pPr, W, 'outlineLvl'), 'val') : undefined;
    styles.set(id, {
      id,
      name: wAttr(kid(s, W, 'name'), 'val'),
      type: wAttr(s, 'type'),
      basedOn: wAttr(kid(s, W, 'basedOn'), 'val'),
      outlineLevel: outline === undefined ? undefined : Number(outline),
      isDefault: TRUE.includes(String(wAttr(s, 'default')).toLowerCase()),
      ...readToggles(kid(s, W, 'rPr')),
    });
  }
  const lang = defaultRPr ? kid(defaultRPr, W, 'lang') : undefined;
  return { styles, defaults: readToggles(defaultRPr), language: wAttr(lang, 'val') };
}

function styleValue<K extends keyof StyleDef>(styles: Map<string, StyleDef>, id: string | undefined, key: K): StyleDef[K] | undefined {
  const seen = new Set<string>();
  let cur = id ? styles.get(id) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur[key] !== undefined) return cur[key];
    cur = cur.basedOn ? styles.get(cur.basedOn) : undefined;
  }
  return undefined;
}

/** Visible (or deleted) text of one run. Page and column breaks are layout, not text. */
function runText(r: XElement, deleted: boolean): string {
  let s = '';
  for (const c of r.children) {
    if (!isElement(c) || c.ns !== W) continue;
    if (c.local === (deleted ? 'delText' : 't')) s += textContent(c);
    else if (c.local === 'tab') s += '\t';
    else if (c.local === 'cr' || (c.local === 'br' && !['page', 'column'].includes(wAttr(c, 'type') ?? ''))) s += '\n';
    else if (c.local === 'noBreakHyphen') s += '-';
  }
  return s;
}

/** First mc:Choice (or mc:Fallback) of an mc:AlternateContent element. */
const alternative = (el: XElement) => el.children.find((k): k is XElement => isElement(k) && (k.local === 'Choice' || k.local === 'Fallback'));

interface Ctx {
  rels: Map<string, Relationship>;
  styles: Map<string, StyleDef>;
  defaultParaStyle?: string;
  defaults: Toggles;
  doc: DocxDocument;
  /** Record runs, tables, revisions and hyperlinks (main body only). */
  body: boolean;
}

function collect(container: XElement, ctx: Ctx, inTable: boolean, out: DocxParagraph[]): void {
  for (const c of container.children) {
    if (!isElement(c)) continue;
    if (c.ns === W && c.local === 'p') paragraph(c, ctx, inTable, out);
    else if (c.ns === W && c.local === 'tbl') table(c, ctx, out);
    else if (c.local === 'AlternateContent') {
      const alt = alternative(c);
      if (alt) collect(alt, ctx, inTable, out);
    } else if (!(c.ns === W && c.local === 'sectPr')) collect(c, ctx, inTable, out);
  }
}

function table(tbl: XElement, ctx: Ctx, out: DocxParagraph[]): void {
  const rows: string[][] = [];
  for (const tr of kids(tbl, W, 'tr')) {
    const cells: string[] = [];
    for (const tc of kids(tr, W, 'tc')) {
      const start = out.length;
      collect(tc, ctx, true, out);
      cells.push(
        out
          .slice(start)
          .map((p) => p.text)
          .join('\n'),
      );
    }
    rows.push(cells);
  }
  if (ctx.body) ctx.doc.tables.push(rows);
}

interface RunState {
  inserted: boolean;
  deleted: boolean;
  hyperlink?: string;
}

function paragraph(p: XElement, ctx: Ctx, inTable: boolean, out: DocxParagraph[]): void {
  const pPr = kid(p, W, 'pPr');
  const styleId = wAttr(pPr ? kid(pPr, W, 'pStyle') : undefined, 'val') ?? ctx.defaultParaStyle;
  const ownOutline = wAttr(pPr ? kid(pPr, W, 'outlineLvl') : undefined, 'val');
  const index = out.length;
  const nested: XElement[] = [];
  let text = '';

  const visit = (el: XElement, state: RunState): void => {
    for (const c of el.children) {
      if (!isElement(c)) continue;
      if (c.local === 'AlternateContent') {
        const alt = alternative(c);
        if (alt) visit(alt, state);
        continue;
      }
      if (c.ns !== W) {
        visit(c, state);
        continue;
      }
      switch (c.local) {
        case 'p':
          nested.push(c); // text boxes: handled as separate paragraphs
          break;
        case 'pPr':
        case 'rPr':
          break;
        case 'r': {
          const t = runText(c, state.deleted);
          if (!state.deleted) text += t;
          if (ctx.body && t) {
            const rPr = kid(c, W, 'rPr');
            const direct = readToggles(rPr);
            const charStyle = wAttr(rPr ? kid(rPr, W, 'rStyle') : undefined, 'val');
            const eff = (k: keyof Toggles) => direct[k] ?? styleValue(ctx.styles, charStyle, k) ?? styleValue(ctx.styles, styleId, k) ?? ctx.defaults[k] ?? false;
            ctx.doc.runs.push({
              text: t,
              bold: eff('b'),
              italic: eff('i'),
              underline: eff('u'),
              strike: eff('strike'),
              charStyle,
              paragraphIndex: index,
              inserted: state.inserted,
              deleted: state.deleted,
              hyperlink: state.hyperlink,
            });
          }
          visit(c, state); // drawings may contain text boxes
          break;
        }
        case 'ins': {
          const before = text.length;
          visit(c, { ...state, inserted: true });
          if (ctx.body) ctx.doc.insertions.push({ author: wAttr(c, 'author') ?? '', text: text.slice(before) });
          break;
        }
        case 'del': {
          const deletedText = descendants(c, W, 'r')
            .map((r) => runText(r, true))
            .join('');
          visit(c, { ...state, deleted: true });
          if (ctx.body) ctx.doc.deletions.push({ author: wAttr(c, 'author') ?? '', text: deletedText });
          break;
        }
        case 'hyperlink': {
          const relId = attr(c, NS.r, 'id');
          const rel = relId ? ctx.rels.get(relId) : undefined;
          const target = rel ? (rel.external ? rel.target : rel.part) : undefined;
          const anchor = wAttr(c, 'anchor');
          const before = text.length;
          visit(c, { ...state, hyperlink: target ?? anchor });
          if (ctx.body) ctx.doc.hyperlinks.push({ text: text.slice(before), target, anchor });
          break;
        }
        default:
          visit(c, state);
      }
    }
  };
  visit(p, { inserted: false, deleted: false });

  out.push({
    text,
    styleId,
    styleName: styleId ? ctx.styles.get(styleId)?.name : undefined,
    outlineLevel: ownOutline !== undefined ? Number(ownOutline) : styleValue(ctx.styles, styleId, 'outlineLevel'),
    numbered: !!(pPr && kid(pPr, W, 'numPr')),
    inTable,
  });
  for (const n of nested) paragraph(n, ctx, inTable, out);
}

function section(sectPr: XElement): DocxSection {
  const pgSz = kid(sectPr, W, 'pgSz');
  const pgMar = kid(sectPr, W, 'pgMar');
  const num = (el: XElement | undefined, name: string) => {
    const v = wAttr(el, name);
    return v === undefined ? undefined : Number(v);
  };
  return {
    pageWidth: num(pgSz, 'w'),
    pageHeight: num(pgSz, 'h'),
    orient: wAttr(pgSz, 'orient'),
    margins: { top: num(pgMar, 'top'), right: num(pgMar, 'right'), bottom: num(pgMar, 'bottom'), left: num(pgMar, 'left'), header: num(pgMar, 'header'), footer: num(pgMar, 'footer') },
    headerRefs: kids(sectPr, W, 'headerReference').length,
    footerRefs: kids(sectPr, W, 'footerReference').length,
  };
}

function fieldInstructions(root: XElement): string[] {
  const out = descendants(root, W, 'instrText').map((i) => textContent(i).trim());
  for (const f of descendants(root, W, 'fldSimple')) out.push(String(wAttr(f, 'instr') ?? '').trim());
  return out.filter(Boolean).map((s) => s.split(/\s+/)[0]!.toUpperCase());
}

const relMap = (rels: Relationship[]) => new Map(rels.map((r) => [r.id, r]));

/** Full independent read of a DOCX package. */
export async function docxDocument(source: string | Uint8Array): Promise<DocxDocument> {
  const pkg = await openPackage(source);
  const docPart = await mainPart(pkg);
  const root = await pkg.xml(docPart);
  if (!root) throw new Error(`missing ${docPart}`);
  const rels = await pkg.relationships(docPart);
  const { styles, defaults, language } = await readStyles(pkg, rels);
  const doc: DocxDocument = {
    paragraphs: [],
    text: '',
    runs: [],
    tables: [],
    headers: [],
    footers: [],
    headerFooterFields: [],
    comments: [],
    insertions: [],
    deletions: [],
    hyperlinks: [],
    pictures: [],
    sections: [],
    styles,
    defaultLanguage: language,
  };
  const defaultParaStyle = [...styles.values()].find((s) => s.type === 'paragraph' && s.isDefault)?.id;
  const ctx: Ctx = { rels: relMap(rels), styles, defaultParaStyle, defaults, doc, body: true };
  const body = kid(root, W, 'body');
  if (body) collect(body, ctx, false, doc.paragraphs);
  doc.text = doc.paragraphs.map((p) => p.text).join('\n');
  doc.sections = descendants(root, W, 'sectPr').map(section);

  for (const rel of rels) {
    const kind = relKind(rel.type);
    if (!rel.part) continue;
    if (kind === 'header' || kind === 'footer' || kind === 'comments') {
      const partRoot = await pkg.xml(rel.part);
      if (!partRoot) continue;
      const partCtx: Ctx = { ...ctx, rels: relMap(await pkg.relationships(rel.part)), body: false };
      if (kind === 'comments') {
        for (const c of kids(partRoot, W, 'comment')) {
          const paras: DocxParagraph[] = [];
          collect(c, partCtx, false, paras);
          doc.comments.push({ id: String(wAttr(c, 'id')), author: wAttr(c, 'author') ?? '', text: paras.map((p) => p.text).join('\n') });
        }
      } else {
        const paras: DocxParagraph[] = [];
        collect(partRoot, partCtx, false, paras);
        (kind === 'header' ? doc.headers : doc.footers).push(paras.map((p) => p.text).join('\n'));
        doc.headerFooterFields.push(...fieldInstructions(partRoot));
      }
    }
  }
  for (const drawing of descendants(root, W, 'drawing')) {
    const docPr = descendants(drawing, NS.wp, 'docPr')[0];
    for (const blip of descendants(drawing, NS.a, 'blip')) {
      const rel = rels.find((r) => r.id === attr(blip, NS.r, 'embed'));
      if (!rel?.part) continue;
      const data = await pkg.bytes(rel.part);
      doc.pictures.push({ part: rel.part, contentType: pkg.contentType(rel.part), bytes: data?.length ?? 0, descr: docPr ? attr(docPr, '', 'descr') : undefined });
    }
  }
  return doc;
}

/** Text of a DOCX: body paragraphs, headers, footers and comments. */
export async function docxText(source: string | Uint8Array): Promise<{ body: string; paragraphs: string[]; headers: string[]; footers: string[]; comments: string[] }> {
  const d = await docxDocument(source);
  return { body: d.text, paragraphs: d.paragraphs.map((p) => p.text), headers: d.headers, footers: d.footers, comments: d.comments.map((c) => c.text) };
}

/** Body runs (table cells included) with effective bold/italic/underline/strike flags. */
export async function docxRuns(source: string | Uint8Array): Promise<DocxRun[]> {
  return (await docxDocument(source)).runs;
}

/**
 * The runs that together cover the first occurrence of `needle` within one paragraph
 * (engines may split or merge runs, so formatting is checked on the covering runs).
 */
export function formattingOf(runs: DocxRun[], needle: string): DocxRun[] | undefined {
  const byPara = new Map<number, DocxRun[]>();
  for (const r of runs) if (!r.deleted) byPara.set(r.paragraphIndex, [...(byPara.get(r.paragraphIndex) ?? []), r]);
  for (const list of byPara.values()) {
    const joined = list.map((r) => r.text).join('');
    const start = joined.indexOf(needle);
    if (start < 0) continue;
    const end = start + needle.length;
    const covering: DocxRun[] = [];
    let pos = 0;
    for (const r of list) {
      const rEnd = pos + r.text.length;
      if (rEnd > start && pos < end) covering.push(r);
      pos = rEnd;
    }
    return covering;
  }
  return undefined;
}

// =============================================================================================== PPTX
export interface PptxSlide {
  index: number;
  part: string;
  layoutName?: string;
  title?: string;
  paragraphs: { text: string; level: number; placeholder?: string }[];
  /** Non-empty paragraph texts of shapes, then table cell texts. */
  texts: string[];
  notes: string;
  imageCount: number;
  images: { part: string; bytes: number }[];
  tables: string[][][];
  hidden: boolean;
}

const P = NS.p;
const A = NS.a;

function drawingParagraphs(txBody: XElement): { text: string; level: number }[] {
  return kids(txBody, A, 'p').map((p) => {
    let text = '';
    for (const c of p.children) {
      if (!isElement(c) || c.ns !== A) continue;
      if (c.local === 'r' || c.local === 'fld') {
        const t = kid(c, A, 't');
        text += t ? textContent(t) : '';
      } else if (c.local === 'br') text += '\n';
    }
    const pPr = kid(p, A, 'pPr');
    return { text, level: Number((pPr && attr(pPr, '', 'lvl')) ?? 0) };
  });
}

function placeholderType(shape: XElement): string | undefined {
  const nv = kid(shape, P, 'nvSpPr') ?? kid(shape, P, 'nvPicPr') ?? kid(shape, P, 'nvGraphicFramePr');
  const nvPr = nv ? kid(nv, P, 'nvPr') : undefined;
  const ph = nvPr ? kid(nvPr, P, 'ph') : undefined;
  if (!ph) return undefined;
  return attr(ph, '', 'type') ?? 'body';
}

function tableTexts(frame: XElement): string[][] {
  const tbl = descendants(frame, A, 'tbl')[0];
  if (!tbl) return [];
  return kids(tbl, A, 'tr').map((tr) =>
    kids(tr, A, 'tc').map((tc) => {
      const body = kid(tc, A, 'txBody');
      return body
        ? drawingParagraphs(body)
            .map((p) => p.text)
            .join('\n')
        : '';
    }),
  );
}

/** Slides in presentation order with texts, notes, pictures and tables. */
export async function pptxSlides(source: string | Uint8Array): Promise<PptxSlide[]> {
  const pkg = await openPackage(source);
  const presPart = await mainPart(pkg);
  const pres = await pkg.xml(presPart);
  if (!pres) throw new Error(`missing ${presPart}`);
  const presRels = await pkg.relationships(presPart);
  const sldIdLst = kid(pres, P, 'sldIdLst');
  const slideParts = (sldIdLst ? kids(sldIdLst, P, 'sldId') : [])
    .map((s) => presRels.find((r) => r.id === attr(s, NS.r, 'id'))?.part)
    .filter((p): p is string => !!p);

  const slides: PptxSlide[] = [];
  for (const [index, part] of slideParts.entries()) {
    const root = await pkg.xml(part);
    if (!root) continue;
    const rels = await pkg.relationships(part);
    const slide: PptxSlide = { index, part, paragraphs: [], texts: [], notes: '', imageCount: 0, images: [], tables: [], hidden: attr(root, '', 'show') === '0' };
    const visit = (container: XElement): void => {
      for (const c of container.children) {
        if (!isElement(c)) continue;
        if (c.local === 'AlternateContent') {
          const alt = alternative(c);
          if (alt) visit(alt);
        } else if (c.ns !== P) {
          continue;
        } else if (c.local === 'sp') {
          const type = placeholderType(c);
          const body = kid(c, P, 'txBody');
          const paras = body ? drawingParagraphs(body) : [];
          if ((type === 'title' || type === 'ctrTitle') && slide.title === undefined) slide.title = paras.map((p) => p.text).join('\n');
          for (const p of paras) slide.paragraphs.push({ ...p, placeholder: type });
        } else if (c.local === 'pic') {
          const blip = descendants(c, A, 'blip')[0];
          const rel = blip ? rels.find((r) => r.id === attr(blip, NS.r, 'embed')) : undefined;
          if (rel?.part) slide.images.push({ part: rel.part, bytes: 0 });
        } else if (c.local === 'graphicFrame') {
          const t = tableTexts(c);
          if (t.length) slide.tables.push(t);
        } else if (c.local === 'grpSp') {
          visit(c);
        }
      }
    };
    const cSld = kid(root, P, 'cSld');
    const tree = cSld ? kid(cSld, P, 'spTree') : undefined;
    if (tree) visit(tree);
    for (const img of slide.images) img.bytes = (await pkg.bytes(img.part))?.length ?? 0;
    slide.imageCount = slide.images.length;
    slide.texts = [...slide.paragraphs.map((p) => p.text), ...slide.tables.flat(2)].filter((t) => t.trim() !== '');

    const layoutRel = rels.find((r) => relKind(r.type) === 'slideLayout');
    const layout = layoutRel?.part ? await pkg.xml(layoutRel.part) : undefined;
    const layoutCSld = layout ? kid(layout, P, 'cSld') : undefined;
    slide.layoutName = layoutCSld ? attr(layoutCSld, '', 'name') : undefined;

    const notesRel = rels.find((r) => relKind(r.type) === 'notesSlide');
    const notes = notesRel?.part ? await pkg.xml(notesRel.part) : undefined;
    if (notes) {
      const texts: string[] = [];
      for (const sp of descendants(notes, P, 'sp')) {
        if (placeholderType(sp) !== 'body') continue;
        const body = kid(sp, P, 'txBody');
        if (body) texts.push(...drawingParagraphs(body).map((p) => p.text));
      }
      slide.notes = texts.join('\n').trim();
    }
    slides.push(slide);
  }
  return slides;
}

// =============================================================================================== XLSX
export type XlsxPrimitive = number | string | boolean | null | { error: string };

export interface XlsxCell {
  address: string;
  /** Constant value, or the cached result of a formula cell. Dates are Excel serial numbers. */
  value: XlsxPrimitive;
  formula?: string;
  /** True when a formula cell carries a cached result. */
  hasCachedResult: boolean;
  numFmt?: string;
  isDate: boolean;
}

export interface XlsxSheet {
  name: string;
  cells: Map<string, XlsxCell>;
  merges: string[];
  frozen?: { xSplit: number; ySplit: number };
  /** Per-cell data validations (ranges expanded). */
  dataValidations: Map<string, { type: string; formulae: string[] }>;
  conditionalFormats: { ref: string; types: string[] }[];
}

export interface XlsxWorkbook {
  sheets: XlsxSheet[];
  sheet(name: string): XlsxSheet;
  definedNames: Record<string, string[]>;
  /** docProps/app.xml Application. */
  application?: string;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const toSerial = (d: Date) => (d.getTime() - EXCEL_EPOCH) / 86_400_000;

function primitive(v: unknown): { value: XlsxPrimitive; isDate: boolean } {
  if (v === null || v === undefined) return { value: null, isDate: false };
  if (v instanceof Date) return { value: toSerial(v), isDate: true };
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return { value: v, isDate: false };
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['error'] === 'string') return { value: { error: o['error'] }, isDate: false };
    if (Array.isArray(o['richText'])) return { value: (o['richText'] as { text: string }[]).map((t) => t.text).join(''), isDate: false };
    if (typeof o['text'] === 'string') return { value: o['text'], isDate: false };
  }
  return { value: String(v), isDate: false };
}

const colNumber = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n: number) => {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Expands `A1:B3` (or a single address; `$` and exceljs' `range:` prefix allowed) into addresses. */
export function expandRange(range: string): string[] {
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(range.replace(/^range:/, '').trim());
  if (!m) return [range];
  const [c1, r1, c2, r2] = [colNumber(m[1]!), Number(m[2]), colNumber(m[3] ?? m[1]!), Number(m[4] ?? m[2])];
  const out: string[] = [];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) out.push(`${colName(c)}${r}`);
  return out;
}

interface ExcelJsInternals {
  dataValidations?: { model?: Record<string, { type?: string; formulae?: unknown[] }> };
  conditionalFormattings?: { ref: string; rules: { type: string }[] }[];
}

/** Values, formulas, cached results, number formats, merges, panes, validations and conditional formats. */
export async function xlsxWorkbook(source: string | Uint8Array): Promise<XlsxWorkbook> {
  const data = typeof source === 'string' ? await readFile(source) : Buffer.from(source);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ExcelJS.Buffer);
  const sheets: XlsxSheet[] = [];
  wb.eachSheet((ws) => {
    const cells = new Map<string, XlsxCell>();
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const isFormula = cell.type === ExcelJS.ValueType.Formula;
        const raw = cell.value as unknown;
        const result = isFormula ? (raw as { result?: unknown }).result : raw;
        const { value, isDate } = primitive(result);
        cells.set(cell.address, {
          address: cell.address,
          value,
          formula: isFormula ? cell.formula : undefined,
          hasCachedResult: isFormula && result !== undefined,
          numFmt: cell.numFmt || undefined,
          isDate,
        });
      });
    });
    const view = (ws.views ?? [])[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
    const internals = ws as unknown as ExcelJsInternals;
    const validations = new Map<string, { type: string; formulae: string[] }>();
    for (const [key, dv] of Object.entries(internals.dataValidations?.model ?? {})) {
      for (const address of key.split(/\s+/).flatMap(expandRange)) validations.set(address, { type: String(dv.type), formulae: (dv.formulae ?? []).map(String) });
    }
    sheets.push({
      name: ws.name,
      cells,
      merges: [...((ws.model as unknown as { merges?: string[] }).merges ?? [])],
      frozen: view?.state === 'frozen' ? { xSplit: Number(view.xSplit ?? 0), ySplit: Number(view.ySplit ?? 0) } : undefined,
      dataValidations: validations,
      conditionalFormats: (internals.conditionalFormattings ?? []).map((cf) => ({ ref: cf.ref, types: cf.rules.map((r) => r.type) })),
    });
  });
  const definedNames: Record<string, string[]> = {};
  for (const dn of (wb.definedNames as unknown as { model: { name: string; ranges: string[] }[] }).model) definedNames[dn.name] = dn.ranges;
  const pkg = await openPackage(data);
  const app = await pkg.xml('docProps/app.xml');
  const appName = app?.children.find((c): c is XElement => isElement(c) && c.local === 'Application');
  return {
    sheets,
    sheet(name) {
      const s = sheets.find((x) => x.name === name);
      if (!s) throw new Error(`sheet ${name} not found (have ${sheets.map((x) => x.name).join(', ')})`);
      return s;
    },
    definedNames,
    application: appName ? textContent(appName) : undefined,
  };
}

/** Number equality with a relative tolerance (engines may sum in a different order, e.g. Kahan). */
export function sameNumber(a: number, b: number, rel = 1e-9): boolean {
  return Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Normalises a number format for comparison across writers (escaping/quoting differences only). */
export function normalizeNumFmt(fmt: string | undefined): string {
  if (!fmt) return 'general';
  return fmt
    .replace(/\\(.)/g, '$1')
    .replace(/"([^"]*)"/g, '$1')
    .replace(/;@$/, '')
    .toLowerCase();
}
