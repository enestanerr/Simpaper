/**
 * Independent OpenDocument readers (content.xml / styles.xml): text documents, spreadsheets and
 * presentations. Repeated rows/columns are expanded only as far as they carry content.
 */
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { NS, attr, descendants, isElement, kid, kids, parseXml, textContent, type XElement } from './xml';

const T = NS.text;
const TB = NS.table;
const O = NS.office;
const D = NS.draw;

async function openOdf(source: string | Uint8Array): Promise<{ zip: JSZip; mimetype: string; xml(part: string): Promise<XElement | undefined> }> {
  const zip = await JSZip.loadAsync(typeof source === 'string' ? await readFile(source) : source);
  const mimetype = ((await zip.file('mimetype')?.async('string')) ?? '').trim();
  return {
    zip,
    mimetype,
    async xml(part) {
      const s = await zip.file(part)?.async('string');
      return s === undefined ? undefined : parseXml(s);
    },
  };
}

/** Text of one paragraph-like element: text:s, text:tab, text:line-break handled; notes/annotations skipped. */
export function odfParagraphText(el: XElement): string {
  let s = '';
  for (const c of el.children) {
    if (!isElement(c)) {
      s += c.text;
      continue;
    }
    if (c.ns === T && c.local === 's') s += ' '.repeat(Number(attr(c, T, 'c') ?? 1));
    else if (c.ns === T && c.local === 'tab') s += '\t';
    else if (c.ns === T && c.local === 'line-break') s += '\n';
    else if (c.ns === O && c.local === 'annotation') continue;
    else if (c.ns === T && (c.local === 'note' || c.local === 'tracked-changes')) continue;
    else if (c.ns === D) continue; // anchored frames/shapes: their paragraphs are listed separately
    else s += odfParagraphText(c);
  }
  return s;
}

/**
 * Pictures below `root`: frames whose content is an image. A frame counts once even when it offers
 * several alternative images (e.g. SVG + PNG fallback); replacement images of tables, charts and OLE
 * objects (frames that also contain table:table / draw:object / draw:object-ole) are not pictures.
 */
export function countPictures(root: XElement): number {
  return descendants(root, D, 'frame').filter((frame) => {
    const own = frame.children.filter(isElement);
    const hasImage = own.some((c) => c.ns === D && c.local === 'image');
    const hasObject = own.some((c) => (c.ns === D && (c.local === 'object' || c.local === 'object-ole')) || (c.ns === TB && c.local === 'table'));
    return hasImage && !hasObject;
  }).length;
}

/** All paragraphs and headings (text:p, text:h) below `root` in document order, excluding annotations. */
function paragraphs(root: XElement): string[] {
  const out: string[] = [];
  const visit = (el: XElement) => {
    for (const c of el.children) {
      if (!isElement(c)) continue;
      if (c.ns === O && c.local === 'annotation') continue;
      if (c.ns === T && c.local === 'tracked-changes') continue;
      if (c.ns === T && (c.local === 'p' || c.local === 'h')) {
        out.push(odfParagraphText(c));
        // frames inside paragraphs (text boxes) contain further paragraphs
        for (const frame of descendants(c, D, 'text-box')) visit(frame);
        continue;
      }
      visit(c);
    }
  };
  visit(root);
  return out;
}

export interface OdfTextDocument {
  mimetype: string;
  paragraphs: string[];
  text: string;
  headings: { level: number; text: string }[];
  headers: string[];
  footers: string[];
  annotations: { author: string; text: string }[];
  images: number;
  tables: string[][][];
}

/** Text extraction from content.xml (and headers/footers from styles.xml) of any ODF package. */
export async function odfText(source: string | Uint8Array): Promise<OdfTextDocument> {
  const pkg = await openOdf(source);
  const content = await pkg.xml('content.xml');
  if (!content) throw new Error('content.xml missing');
  const body = kid(content, O, 'body') ?? content;
  const paras = paragraphs(body);
  const styles = await pkg.xml('styles.xml');
  const master = styles ? descendants(styles, NS.style, 'master-page') : [];
  const partText = (local: string) =>
    master
      .flatMap((m) => descendants(m, NS.style, local))
      .map((h) => paragraphs(h).join('\n'))
      .filter(Boolean);
  return {
    mimetype: pkg.mimetype,
    paragraphs: paras,
    text: paras.join('\n'),
    headings: descendants(body, T, 'h').map((h) => ({ level: Number(attr(h, T, 'outline-level') ?? 1), text: odfParagraphText(h) })),
    headers: partText('header'),
    footers: partText('footer'),
    annotations: descendants(body, O, 'annotation').map((a) => ({
      author: textContent(descendants(a, 'http://purl.org/dc/elements/1.1/', 'creator')[0] ?? a).trim(),
      text: kids(a, T, 'p')
        .map(odfParagraphText)
        .join('\n'),
    })),
    images: countPictures(body),
    tables: descendants(body, TB, 'table').map((t) =>
      descendants(t, TB, 'table-row').map((r) =>
        kids(r, TB, 'table-cell').map((c) =>
          kids(c, T, 'p')
            .map(odfParagraphText)
            .join('\n'),
        ),
      ),
    ),
  };
}

// ---------------------------------------------------------------------------------------------- spreadsheets
export interface OdsCell {
  address: string;
  valueType?: string;
  /** Numeric value for float/percentage/currency, ISO string for dates, boolean, or text. */
  value: number | string | boolean | null;
  /** Formula as stored (e.g. `of:=SUM([.A1:.A3])`). */
  formula?: string;
  text: string;
}

export interface OdsSheet {
  name: string;
  cells: Map<string, OdsCell>;
}

const colName = (n: number) => {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Sheets with their non-empty cells (A1 addresses). */
export async function odsSheets(source: string | Uint8Array, maxRepeat = 1000): Promise<OdsSheet[]> {
  const pkg = await openOdf(source);
  const content = await pkg.xml('content.xml');
  if (!content) throw new Error('content.xml missing');
  return descendants(content, TB, 'table').map((table) => {
    const cells = new Map<string, OdsCell>();
    let row = 0;
    for (const r of descendants(table, TB, 'table-row')) {
      const rowRepeat = Number(attr(r, TB, 'number-rows-repeated') ?? 1);
      const rowCells = r.children.filter((c): c is XElement => isElement(c) && c.ns === TB && (c.local === 'table-cell' || c.local === 'covered-table-cell'));
      const hasContent = rowCells.some((c) => attr(c, O, 'value-type') !== undefined || attr(c, TB, 'formula') !== undefined || kids(c, T, 'p').length > 0);
      if (!hasContent) {
        row += rowRepeat; // empty (often huge) repeated rows only advance the counter
        continue;
      }
      for (let rr = 0; rr < Math.min(rowRepeat, maxRepeat); rr++) {
        row++;
        let col = 0;
        for (const c of rowCells) {
          const repeat = Number(attr(c, TB, 'number-columns-repeated') ?? 1);
          const valueType = attr(c, O, 'value-type');
          const formula = attr(c, TB, 'formula');
          const text = kids(c, T, 'p')
            .map(odfParagraphText)
            .join('\n');
          if (!valueType && !formula && !text) {
            col += repeat; // empty repeated columns only advance the counter
            continue;
          }
          for (let k = 0; k < Math.min(repeat, maxRepeat); k++) {
            col++;
            let value: OdsCell['value'] = text || null;
            if (valueType === 'float' || valueType === 'percentage' || valueType === 'currency') value = Number(attr(c, O, 'value'));
            else if (valueType === 'date') value = attr(c, O, 'date-value') ?? null;
            else if (valueType === 'time') value = attr(c, O, 'time-value') ?? null;
            else if (valueType === 'boolean') value = attr(c, O, 'boolean-value') === 'true';
            else if (valueType === 'string') value = attr(c, O, 'string-value') ?? text;
            const address = `${colName(col)}${row}`;
            cells.set(address, { address, valueType, value, formula, text });
          }
        }
      }
    }
    return { name: attr(table, TB, 'name') ?? '', cells };
  });
}

// ---------------------------------------------------------------------------------------------- presentations
export interface OdpPage {
  name: string;
  texts: string[];
  notes: string;
  images: number;
  tables: string[][][];
}

/** Pages (slides) with shape texts, speaker notes, picture count and tables. */
export async function odpPages(source: string | Uint8Array): Promise<OdpPage[]> {
  const pkg = await openOdf(source);
  const content = await pkg.xml('content.xml');
  if (!content) throw new Error('content.xml missing');
  return descendants(content, D, 'page').map((page) => {
    const notesEl = kid(page, NS.presentation, 'notes');
    const texts: string[] = [];
    const tables: string[][][] = [];
    const visit = (el: XElement) => {
      for (const c of el.children) {
        if (!isElement(c)) continue;
        if (c === notesEl) continue;
        if (c.ns === TB && c.local === 'table') {
          tables.push(descendants(c, TB, 'table-row').map((r) => kids(r, TB, 'table-cell').map((cell) => paragraphs(cell).join('\n'))));
          continue;
        }
        if (c.ns === T && (c.local === 'p' || c.local === 'h')) {
          const t = odfParagraphText(c);
          if (t.trim()) texts.push(t);
          continue;
        }
        visit(c);
      }
    };
    visit(page);
    const images = countPictures({ ...page, children: page.children.filter((c) => c !== notesEl) });
    const notes = notesEl
      ? descendants(notesEl, D, 'frame')
          .filter((f) => attr(f, NS.presentation, 'class') === 'notes')
          .flatMap((f) => paragraphs(f))
          .join('\n')
          .trim()
      : '';
    return { name: attr(page, D, 'name') ?? '', texts, notes, images, tables };
  });
}
