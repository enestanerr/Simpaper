/**
 * New page content ("Add text", "Add image") written with @cantoo/pdf-lib as an incremental update,
 * so earlier revisions (and signatures up to them) stay intact.
 */
import fontkit from '@cantoo/fontkit';
import {
  PDFArray,
  PDFContentStream,
  PDFName,
  PDFRef,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
  type RGB,
} from '@cantoo/pdf-lib';
import type { PdfImageInsert, PdfTextInsert } from '@shared/api/pdf';
import { PdfServiceError, errorMessage } from './errors';
import type { FontProvider } from './fonts';
import { firstBaseline, imageOrigin, normalizeRotation } from './layout';
import { loadForEdit, usesXrefStream } from './load';

export const TEXT_LINE_FACTOR = 1.2;
const MAX_FONT_SIZE = 400;

/** `#RRGGBB` / `#RGB` → pdf-lib colour (black for anything else). */
export function parseHexColor(value: string): RGB {
  const hex = value.trim().replace(/^#/, '');
  const full = /^[0-9a-f]{3}$/i.test(hex) ? [...hex].map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return rgb(0, 0, 0);
  const n = Number.parseInt(full, 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

/** Splits user text into lines (CRLF/CR/LF) and drops characters that must not reach a content stream. */
export function textLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  let clean = '';
  for (const ch of normalized) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\n' || (code >= 0x20 && code !== 0x7f)) clean += ch;
  }
  return clean.split('\n');
}

function checkPage(doc: PDFDocument, pageIndex: number): PDFPage {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.getPageCount()) {
    throw new PdfServiceError('pdf.errors.invalidPage', `page ${pageIndex} of ${doc.getPageCount()}`);
  }
  return doc.getPage(pageIndex);
}

function checkFinite(...values: number[]): void {
  if (!values.every((v) => Number.isFinite(v))) throw new PdfServiceError('pdf.errors.invalidOp', 'non-finite coordinate');
}

/**
 * Wraps the page's existing content in q … Q once, so graphics state the original content leaves behind
 * (a scaled CTM, a clip) cannot displace what we append.
 */
export function isolateExistingContent(doc: PDFDocument, page: PDFPage): void {
  const key = PDFName.of('Contents');
  const current = page.node.get(key);
  if (!current) return;
  const resolved = current instanceof PDFRef ? doc.context.lookup(current) : current;
  const items = resolved instanceof PDFArray ? resolved.asArray() : [current];
  if (items.length === 0) return;
  const open = doc.context.register(PDFContentStream.of(doc.context.obj({}), [pushGraphicsState()]));
  const close = doc.context.register(PDFContentStream.of(doc.context.obj({}), [popGraphicsState()]));
  page.node.set(key, doc.context.obj([open, ...items, close]));
}

async function saveIncremental(doc: PDFDocument, original: Uint8Array): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: usesXrefStream(original), updateFieldAppearances: false });
}

function validateTextItem(item: PdfTextInsert): void {
  checkFinite(item.x, item.y, item.fontSize);
  if (typeof item.text !== 'string' || item.text.trim().length === 0) throw new PdfServiceError('pdf.errors.emptyText');
  if (item.fontSize <= 0 || item.fontSize > MAX_FONT_SIZE) throw new PdfServiceError('pdf.errors.invalidOp', 'font size');
}

async function drawTextItems(bytes: Uint8Array, items: PdfTextInsert[], fontBytes: Uint8Array, subset: boolean): Promise<Uint8Array> {
  const doc = await loadForEdit(bytes, { incremental: true });
  doc.registerFontkit(fontkit);
  const font: PDFFont = await doc.embedFont(fontBytes, { subset });
  const isolated = new Set<number>();
  for (const item of items) {
    const page = checkPage(doc, item.pageIndex);
    if (!isolated.has(item.pageIndex)) {
      isolateExistingContent(doc, page);
      isolated.add(item.pageIndex);
    }
    const rotation = normalizeRotation(page.getRotation().angle);
    const size = item.fontSize;
    const ascent = font.heightAtSize(size, { descender: false });
    const origin = firstBaseline({ x: item.x, y: item.y }, rotation, ascent);
    page.drawText(textLines(item.text).join('\n'), {
      x: origin.x,
      y: origin.y,
      size,
      font,
      color: parseHexColor(item.color),
      lineHeight: size * TEXT_LINE_FACTOR,
      rotate: degrees(rotation),
    });
  }
  return saveIncremental(doc, bytes);
}

/** Draws text items as page content with an embedded (subset) Unicode font. */
export async function insertTextItems(bytes: Uint8Array, items: PdfTextInsert[], fonts: FontProvider): Promise<Uint8Array> {
  if (!Array.isArray(items) || items.length === 0) throw new PdfServiceError('pdf.errors.emptyText');
  items.forEach(validateTextItem);
  const font = await fonts.resolve(items.map((i) => i.text).join(''));
  try {
    return await drawTextItems(bytes, items, font.bytes, true);
  } catch (err) {
    if (err instanceof PdfServiceError) throw err;
    // Subsetting fails for some fonts (pdf-lib README); embedding the full font is the safe fallback.
    try {
      return await drawTextItems(bytes, items, font.bytes, false);
    } catch (again) {
      if (again instanceof PdfServiceError) throw again;
      throw new PdfServiceError('pdf.errors.invalidOp', `${errorMessage(err)}; full font: ${errorMessage(again)}`);
    }
  }
}

export function detectImageMime(data: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Draws a PNG/JPEG image as page content; its displayed top-left corner is at (x, y). */
export async function insertImageItem(bytes: Uint8Array, item: PdfImageInsert): Promise<Uint8Array> {
  checkFinite(item.x, item.y, item.width, item.height);
  if (item.width <= 0 || item.height <= 0) throw new PdfServiceError('pdf.errors.invalidOp', 'image size');
  const data = item.data instanceof Uint8Array ? item.data : new Uint8Array(item.data as ArrayLike<number>);
  const detected = detectImageMime(data);
  if (!detected || detected !== item.mime) throw new PdfServiceError('pdf.errors.imageFormat');
  const doc = await loadForEdit(bytes, { incremental: true });
  const page = checkPage(doc, item.pageIndex);
  let image;
  try {
    image = detected === 'image/png' ? await doc.embedPng(data) : await doc.embedJpg(data);
  } catch (err) {
    throw new PdfServiceError('pdf.errors.imageFormat', errorMessage(err));
  }
  isolateExistingContent(doc, page);
  const rotation = normalizeRotation(page.getRotation().angle);
  const origin = imageOrigin({ x: item.x, y: item.y }, rotation, item.height);
  page.drawImage(image, { x: origin.x, y: origin.y, width: item.width, height: item.height, rotate: degrees(rotation) });
  return saveIncremental(doc, bytes);
}
