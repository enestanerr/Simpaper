/**
 * Page operations (rotate, delete, move, insert blank, duplicate), merge and extract.
 * These rewrite the whole file: removed pages must not survive in an older revision of the file.
 */
import { PDFDocument, degrees, type PDFPage } from '@cantoo/pdf-lib';
import type { PdfPageOp } from '@shared/api/pdf';
import { PdfServiceError } from './errors';
import { normalizeRotation } from './layout';
import { loadForEdit } from './load';
import { pruneUnreachable, registerCopiedFields, removePageCompletely } from './structure';

/** A4 portrait in points, used when there is no neighbour page to copy the size from. */
export const A4: [number, number] = [595.28, 841.89];

const PRODUCER = 'Simpaper';

function assertIndex(index: number, count: number, allowEnd = false): void {
  const max = allowEnd ? count : count - 1;
  if (!Number.isInteger(index) || index < 0 || index > max) {
    throw new PdfServiceError('pdf.errors.invalidPage', `index ${index} of ${count}`);
  }
}

async function applyOp(doc: PDFDocument, op: PdfPageOp): Promise<void> {
  const count = doc.getPageCount();
  switch (op.op) {
    case 'rotate': {
      assertIndex(op.pageIndex, count);
      const delta = op.value ?? 90;
      if (!Number.isFinite(delta) || delta % 90 !== 0) throw new PdfServiceError('pdf.errors.invalidOp', `rotate ${delta}`);
      const page = doc.getPage(op.pageIndex);
      page.setRotation(degrees(normalizeRotation(page.getRotation().angle + delta)));
      return;
    }
    case 'delete': {
      assertIndex(op.pageIndex, count);
      if (count <= 1) throw new PdfServiceError('pdf.errors.lastPage');
      removePageCompletely(doc, op.pageIndex);
      return;
    }
    case 'move': {
      assertIndex(op.pageIndex, count);
      const target = op.value;
      if (target === undefined) throw new PdfServiceError('pdf.errors.invalidOp', 'move without target');
      assertIndex(target, count);
      if (target === op.pageIndex) return;
      const page = doc.getPage(op.pageIndex);
      doc.removePage(op.pageIndex);
      // pdf-lib deletes the page object on removal; it is re-registered under the same reference.
      doc.context.assign(page.ref, page.node);
      doc.insertPage(target, page);
      return;
    }
    case 'insertBlank': {
      assertIndex(op.pageIndex, count, true);
      const neighbour: PDFPage | undefined = count > 0 ? doc.getPage(Math.min(op.pageIndex, count - 1)) : undefined;
      const box = neighbour?.getMediaBox();
      const page = doc.insertPage(op.pageIndex, box ? [box.width, box.height] : A4);
      if (neighbour) page.setRotation(degrees(normalizeRotation(neighbour.getRotation().angle)));
      return;
    }
    case 'duplicate': {
      assertIndex(op.pageIndex, count);
      const [copy] = await doc.copyPages(doc, [op.pageIndex]);
      if (!copy) throw new PdfServiceError('pdf.errors.invalidOp', 'copy failed');
      doc.insertPage(op.pageIndex + 1, copy);
      return;
    }
    default:
      throw new PdfServiceError('pdf.errors.invalidOp', `unknown op ${String((op as { op: unknown }).op)}`);
  }
}

async function saveRewritten(doc: PDFDocument): Promise<Uint8Array> {
  pruneUnreachable(doc);
  doc.setModificationDate(new Date());
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false, addDefaultPage: false });
}

/** Applies the ops in order; each op's indices refer to the document after the previous ops. */
export async function applyPageOps(bytes: Uint8Array, ops: PdfPageOp[]): Promise<Uint8Array> {
  if (!Array.isArray(ops) || ops.length === 0) throw new PdfServiceError('pdf.errors.invalidOp', 'no ops');
  const doc = await loadForEdit(bytes);
  for (const op of ops) await applyOp(doc, op);
  return saveRewritten(doc);
}

export interface MergeSource {
  bytes: Uint8Array;
  /** File name, for error details only. */
  name: string;
}

/** Appends all pages of the sources (in order) and keeps their form fields fillable. */
export async function appendDocuments(bytes: Uint8Array, sources: MergeSource[]): Promise<Uint8Array> {
  const doc = await loadForEdit(bytes);
  for (const source of sources) {
    const other = await loadForEdit(source.bytes, {
      parseErrorKey: 'pdf.errors.mergeParse',
      encryptedErrorKey: 'pdf.errors.mergeEncrypted',
    }).catch((err: unknown) => {
      if (err instanceof PdfServiceError) throw new PdfServiceError(err.key, source.name);
      throw err;
    });
    const copied = await doc.copyPages(other, other.getPageIndices());
    for (const page of copied) doc.addPage(page);
    registerCopiedFields(doc, other, copied);
  }
  return saveRewritten(doc);
}

/** Validates page indices for extraction: non-empty, integral, in range, no duplicates. Keeps the given order. */
export function checkExtractIndices(indices: number[], count: number): number[] {
  if (!Array.isArray(indices) || indices.length === 0) throw new PdfServiceError('pdf.errors.invalidPage', 'no pages');
  const seen = new Set<number>();
  for (const i of indices) {
    assertIndex(i, count);
    if (seen.has(i)) throw new PdfServiceError('pdf.errors.invalidPage', `duplicate ${i}`);
    seen.add(i);
  }
  return indices;
}

/** Builds a new PDF from the selected pages (document info and form fields carried over). */
export async function extractDocument(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const source = await loadForEdit(bytes);
  checkExtractIndices(indices, source.getPageCount());
  const out = await PDFDocument.create({ updateMetadata: false });
  const pages = await out.copyPages(source, indices);
  for (const page of pages) out.addPage(page);
  registerCopiedFields(out, source, pages);
  const title = source.getTitle();
  const author = source.getAuthor();
  const subject = source.getSubject();
  const keywords = source.getKeywords();
  if (title) out.setTitle(title);
  if (author) out.setAuthor(author);
  if (subject) out.setSubject(subject);
  if (keywords) out.setKeywords([keywords]);
  out.setProducer(PRODUCER);
  const now = new Date();
  out.setCreationDate(now);
  out.setModificationDate(now);
  return out.save({ useObjectStreams: true, updateFieldAppearances: false, addDefaultPage: false });
}

/** A new, empty PDF with one A4 page (for "new PDF document"). */
export async function createBlankPdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage(A4);
  doc.setProducer(PRODUCER);
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  return doc.save({ useObjectStreams: true });
}
