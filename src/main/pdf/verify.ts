/** Save verification: the bytes written to the temp file must be a PDF that re-opens with the expected pages. */
import { readFile } from 'node:fs/promises';
import { PdfServiceError, errorMessage } from './errors';
import { loadForInspection, looksLikePdf } from './load';

export interface VerifyExpectations {
  /** Exact page count the written file must have. */
  pageCount?: number;
}

export interface VerifiedPdf {
  pageCount: number;
  encrypted: boolean;
}

/** Parses the document (encrypted files structurally, without the password) and walks its page tree. */
export async function verifyPdfBytes(bytes: Uint8Array, expect: VerifyExpectations = {}): Promise<VerifiedPdf> {
  if (!looksLikePdf(bytes)) throw new PdfServiceError('pdf.errors.verifyFailed', `not a PDF (${bytes.length} bytes)`);
  let doc;
  try {
    doc = await loadForInspection(bytes);
  } catch (err) {
    throw new PdfServiceError('pdf.errors.verifyFailed', errorMessage(err));
  }
  let pageCount: number;
  try {
    pageCount = doc.getPages().length;
  } catch (err) {
    throw new PdfServiceError('pdf.errors.verifyFailed', `page tree: ${errorMessage(err)}`);
  }
  if (pageCount < 1) throw new PdfServiceError('pdf.errors.verifyFailed', 'no pages');
  if (expect.pageCount !== undefined && pageCount !== expect.pageCount) {
    throw new PdfServiceError('pdf.errors.verifyFailed', `expected ${expect.pageCount} pages, found ${pageCount}`);
  }
  return { pageCount, encrypted: doc.isEncrypted };
}

export async function verifyPdfFile(path: string, expect: VerifyExpectations = {}): Promise<VerifiedPdf> {
  const buffer = await readFile(path);
  return verifyPdfBytes(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), expect);
}
