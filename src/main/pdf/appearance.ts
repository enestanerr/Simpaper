/**
 * Unicode appearance streams for what pdf.js 6.3 saves without one (vendor/research-raw/pdf.md):
 *  - FreeText annotations whose text Helvetica/WinAnsi cannot encode (Turkish ğ ş ı İ …) get no /AP, so they
 *    are invisible in PDFium-based viewers (Chrome, Edge);
 *  - form fields whose value the field font cannot encode get no /AP and /NeedAppearances true.
 * The fix embeds a Unicode font and appends the appearances as an incremental update.
 */
import fontkit from '@cantoo/fontkit';
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRef,
  PDFStream,
  PDFString,
  PDFTextField,
  type PDFField,
  type PDFFont,
} from '@cantoo/pdf-lib';
import type { Logger } from '../log';
import { errorMessage } from './errors';
import type { FontProvider } from './fonts';
import { containsAscii, isEncryptedError, usesXrefStream } from './load';
import { getAcroForm } from './structure';

/** Key in our appearance streams holding a hash of the inputs, to detect stale appearances. */
const MARKER = PDFName.of('VarakAP');
const FONT_KEY = 'VarakF1';
/** pdf.js FreeText metrics (LINE_FACTOR / LINE_DESCENT_FACTOR in src/core/annotation.js). */
const LINE_FACTOR = 1.35;
const LINE_DESCENT_FACTOR = 0.35;

const N = {
  AP: PDFName.of('AP'),
  Annots: PDFName.of('Annots'),
  Contents: PDFName.of('Contents'),
  DA: PDFName.of('DA'),
  N: PDFName.of('N'),
  NeedAppearances: PDFName.of('NeedAppearances'),
  Rect: PDFName.of('Rect'),
  Rotate: PDFName.of('Rotate'),
  Subtype: PDFName.of('Subtype'),
  FreeText: PDFName.of('FreeText'),
};

export interface AppearanceFixResult {
  bytes: Uint8Array;
  freeTexts: number;
  fields: number;
}

interface FreeTextTarget {
  annot: PDFDict;
  text: string;
  fontSize: number;
  colorOp: string;
  rect: [number, number, number, number];
  rotation: 0 | 90 | 180 | 270;
  hash: string;
}

/** 32-bit FNV-1a, hex. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Font size and fill colour operator from a /DA string such as `/Helv 12 Tf 0 0 1 rg`. */
export function parseDefaultAppearance(da: string): { fontSize: number; colorOp: string } {
  const size = /(-?\d*\.?\d+)\s+Tf\b/.exec(da);
  const fontSize = size?.[1] ? Math.abs(Number(size[1])) : 0;
  const colors = [...da.matchAll(/((?:-?\d*\.?\d+\s+){1,4})(rg|g|k)\b/g)];
  const last = colors.at(-1);
  let colorOp = '0 g';
  if (last?.[1] && last[2]) {
    const operands = last[1].trim().split(/\s+/);
    const expected = last[2] === 'g' ? 1 : last[2] === 'rg' ? 3 : 4;
    if (operands.length >= expected) colorOp = `${operands.slice(-expected).join(' ')} ${last[2]}`;
  }
  return { fontSize: fontSize > 0 ? fontSize : 12, colorOp };
}

function decodeText(obj: unknown): string | undefined {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return undefined;
}

function numberArray(obj: unknown): number[] | undefined {
  if (!(obj instanceof PDFArray)) return undefined;
  const out: number[] = [];
  for (const item of obj.asArray()) {
    if (!(item instanceof PDFNumber)) return undefined;
    out.push(item.asNumber());
  }
  return out;
}

function normalRect(values: number[]): [number, number, number, number] | undefined {
  if (values.length !== 4 || !values.every(Number.isFinite)) return undefined;
  const [a, b, c, d] = values as [number, number, number, number];
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

function existingMarker(doc: PDFDocument, annot: PDFDict): string | null | undefined {
  const ap = annot.lookupMaybe(N.AP, PDFDict);
  if (!ap) return undefined;
  const normal = ap.get(N.N);
  const stream = normal instanceof PDFRef ? doc.context.lookup(normal) : normal;
  if (!(stream instanceof PDFStream)) return null;
  const marker = stream.dict.get(MARKER);
  return decodeText(marker) ?? null;
}

function collectFreeTexts(doc: PDFDocument): FreeTextTarget[] {
  const targets: FreeTextTarget[] = [];
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(N.Annots, PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookupMaybe(i, PDFDict);
      if (!annot || annot.get(N.Subtype) !== N.FreeText) continue;
      const text = decodeText(annot.get(N.Contents));
      const rect = normalRect(numberArray(annot.lookupMaybe(N.Rect, PDFArray)) ?? []);
      if (!text || !text.trim() || !rect) continue;
      const da = decodeText(annot.get(N.DA)) ?? '';
      const { fontSize, colorOp } = parseDefaultAppearance(da);
      const rotateObj = annot.get(N.Rotate);
      const rotateRaw = rotateObj instanceof PDFNumber ? rotateObj.asNumber() : 0;
      const rotation = ((((Math.round(rotateRaw / 90) % 4) + 4) % 4) * 90) as FreeTextTarget['rotation'];
      const hash = fnv1a(`${text}|${fontSize}|${colorOp}|${rect.join(',')}|${rotation}`);
      const marker = existingMarker(doc, annot);
      // No appearance at all (pdf.js could not encode the text), or one we generated for other inputs.
      if (marker === undefined || (typeof marker === 'string' && marker !== hash)) {
        targets.push({ annot, text, fontSize, colorOp, rect, rotation, hash });
      }
    }
  }
  return targets;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

/** Mirrors pdf.js' FreeTextAnnotation.createNewAppearanceStream, with an embedded Unicode font. */
function writeFreeTextAppearance(doc: PDFDocument, t: FreeTextTarget, font: PDFFont): void {
  const [x1, y1, x2, y2] = t.rect;
  let w = x2 - x1;
  let h = y2 - y1;
  if (t.rotation % 180 !== 0) [w, h] = [h, w];
  const lines = t.text.replace(/\r\n?/g, '\n').split('\n');
  const totalWidth = Math.max(...lines.map((l) => font.widthOfTextAtSize(l, t.fontSize)));
  const lineHeight = LINE_FACTOR * t.fontSize;
  const lineAscent = (LINE_FACTOR - LINE_DESCENT_FACTOR) * t.fontSize;
  const hscale = totalWidth > w && totalWidth > 0 ? w / totalWidth : 1;
  const vscale = lineHeight * lines.length > h ? h / (lineHeight * lines.length) : 1;
  const size = t.fontSize * Math.min(hscale, vscale);
  let matrix: number[];
  let clip: number[];
  let first: [number, number];
  switch (t.rotation) {
    case 90:
      matrix = [0, 1, -1, 0];
      clip = [y1, -x2, w, h];
      first = [y1, -x1 - lineAscent];
      break;
    case 180:
      matrix = [-1, 0, 0, -1];
      clip = [-x2, -y2, w, h];
      first = [-x2, -y1 - lineAscent];
      break;
    case 270:
      matrix = [0, -1, 1, 0];
      clip = [-y2, x1, w, h];
      first = [-y2, x2 - lineAscent];
      break;
    default:
      matrix = [1, 0, 0, 1];
      clip = [x1, y1, w, h];
      first = [x1, y2 - lineAscent];
  }
  const ops = [
    'q',
    `${matrix.map(fmt).join(' ')} 0 0 cm`,
    `${clip.map(fmt).join(' ')} re W n`,
    'BT',
    t.colorOp,
    `0 Tc /${FONT_KEY} ${fmt(size)} Tf`,
    `${fmt(first[0])} ${fmt(first[1])} Td ${font.encodeText(lines[0] ?? '').toString()} Tj`,
  ];
  for (const line of lines.slice(1)) ops.push(`0 -${fmt(lineHeight)} Td ${font.encodeText(line).toString()} Tj`);
  ops.push('ET', 'Q');
  const stream = doc.context.flateStream(ops.join('\n'), {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [x1, y1, x2, y2],
    Matrix: [1, 0, 0, 1, -x1, -y1],
    Resources: { Font: { [FONT_KEY]: font.ref } },
  });
  stream.dict.set(MARKER, PDFString.of(t.hash));
  const ref = doc.context.register(stream);
  t.annot.set(N.AP, doc.context.obj({ N: ref }));
}

function widgetsLackAppearance(field: PDFField): boolean {
  return field.acroField.getWidgets().some((widget) => !widget.dict.lookupMaybe(N.AP, PDFDict)?.get(N.N));
}

type FixableField = PDFTextField | PDFDropdown | PDFOptionList;

function collectFields(doc: PDFDocument): FixableField[] {
  const acroForm = getAcroForm(doc);
  if (!acroForm || acroForm.get(N.NeedAppearances) !== PDFBool.True) return [];
  const fields: FixableField[] = [];
  for (const field of doc.getForm().getFields()) {
    if (field instanceof PDFTextField || field instanceof PDFDropdown || field instanceof PDFOptionList) {
      if (widgetsLackAppearance(field)) fields.push(field);
    }
  }
  return fields;
}

/** pdf-lib's form model can reject unusual AcroForms; the FreeText fix must still run then. */
function collectFieldsSafely(doc: PDFDocument): FixableField[] {
  try {
    return collectFields(doc);
  } catch {
    return [];
  }
}

function fieldText(field: FixableField): string {
  if (field instanceof PDFTextField) return field.getText() ?? '';
  if (field instanceof PDFDropdown) return field.getSelected().join('');
  return field.getOptions().join('');
}

/** Regenerates the field's appearance with `font` but keeps its /DA untouched. */
function updateFieldAppearance(field: FixableField, font: PDFFont): void {
  const holders = [field.acroField.dict, ...field.acroField.getWidgets().map((w) => w.dict)];
  const saved = holders.map((d) => d.get(N.DA));
  field.updateAppearances(font);
  holders.forEach((d, i) => {
    const da = saved[i];
    if (da) d.set(N.DA, da);
    else d.delete(N.DA);
  });
}

async function applyFix(bytes: Uint8Array, fonts: FontProvider, subset: boolean): Promise<AppearanceFixResult> {
  const doc = await PDFDocument.load(bytes, {
    forIncrementalUpdate: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
    preserveXFA: true,
  });
  const freeTexts = collectFreeTexts(doc);
  const fields = collectFieldsSafely(doc);
  if (freeTexts.length === 0 && fields.length === 0) return { bytes, freeTexts: 0, fields: 0 };
  const text = [...freeTexts.map((t) => t.text), ...fields.map(fieldText)].join('');
  const resolved = await fonts.resolve(text);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(resolved.bytes, { subset });
  for (const t of freeTexts) writeFreeTextAppearance(doc, t, font);
  for (const field of fields) updateFieldAppearance(field, font);
  if (fields.length > 0) {
    const stillMissing = doc.getForm().getFields().some((f) => (f instanceof PDFTextField || f instanceof PDFDropdown || f instanceof PDFOptionList) && widgetsLackAppearance(f));
    if (!stillMissing) getAcroForm(doc)?.set(N.NeedAppearances, PDFBool.False);
  }
  const out = await doc.save({ useObjectStreams: usesXrefStream(bytes), updateFieldAppearances: false });
  return { bytes: out, freeTexts: freeTexts.length, fields: fields.length };
}

/**
 * Adds missing Unicode appearances. Never fails the caller: on any problem the input bytes are returned
 * unchanged (pdf.js still renders them; only other viewers are affected).
 */
export async function fixUnicodeAppearances(bytes: Uint8Array, fonts: FontProvider, log: Logger): Promise<AppearanceFixResult> {
  if (!containsAscii(bytes, '/FreeText') && !containsAscii(bytes, '/NeedAppearances')) return { bytes, freeTexts: 0, fields: 0 };
  try {
    return await applyFix(bytes, fonts, true);
  } catch (err) {
    if (isEncryptedError(err)) {
      log.info('appearance fix skipped for an encrypted document');
      return { bytes, freeTexts: 0, fields: 0 };
    }
    try {
      return await applyFix(bytes, fonts, false);
    } catch (again) {
      log.warn('appearance fix failed; keeping pdf.js output', { error: errorMessage(err), retry: errorMessage(again) });
      return { bytes, freeTexts: 0, fields: 0 };
    }
  }
}
