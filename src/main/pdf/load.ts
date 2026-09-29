/** Loading PDF bytes with @cantoo/pdf-lib and cheap structural checks on raw bytes. */
import { EncryptedPDFError, PDFDocument } from '@cantoo/pdf-lib';
import { PdfServiceError, errorMessage, type PdfErrorKey } from './errors';

const latin1 = new TextDecoder('latin1');

/** Decodes a byte range as Latin-1 (1 byte = 1 char), for keyword scans. */
export function latin1Slice(bytes: Uint8Array, start: number, end: number): string {
  return latin1.decode(bytes.subarray(Math.max(0, start), Math.min(bytes.length, end)));
}

/** `%PDF-` within the first KB and `%%EOF` within the last 2 KB (tolerates leading junk and trailing whitespace). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < 32) return false;
  return latin1Slice(bytes, 0, 1024).includes('%PDF-') && latin1Slice(bytes, bytes.length - 2048, bytes.length).includes('%%EOF');
}

/** True if `needle` (ASCII) occurs anywhere in the bytes. */
export function containsAscii(bytes: Uint8Array, needle: string): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(needle, 0, 'latin1') !== -1;
}

/**
 * Whether the newest cross-reference section is a stream (PDF 1.5+) rather than a classic table.
 * Incremental updates keep the same kind, as pdf.js does.
 */
export function usesXrefStream(bytes: Uint8Array): boolean {
  const tail = latin1Slice(bytes, bytes.length - 2048, bytes.length);
  const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail) ?? /startxref\s+(\d+)/.exec(tail);
  if (!m?.[1]) return false;
  const offset = Number(m[1]);
  if (!Number.isFinite(offset) || offset >= bytes.length) return false;
  return !latin1Slice(bytes, offset, offset + 16).trimStart().startsWith('xref');
}

export function isEncryptedError(err: unknown): boolean {
  return err instanceof EncryptedPDFError || (err instanceof Error && err.name === 'EncryptedPDFError');
}

export interface LoadOptions {
  /** Keep the original bytes and write only changed objects on save. */
  incremental?: boolean;
  /** Error key used when the document cannot be parsed. */
  parseErrorKey?: PdfErrorKey;
  encryptedErrorKey?: PdfErrorKey;
}

/**
 * Loads a PDF for modification. Encrypted documents are refused: pdf-lib would write them back
 * decrypted, silently removing the user's protection.
 */
export async function loadForEdit(bytes: Uint8Array, opts: LoadOptions = {}): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, {
      updateMetadata: false,
      forIncrementalUpdate: opts.incremental ?? false,
      throwOnInvalidObject: false,
    });
  } catch (err) {
    if (isEncryptedError(err)) throw new PdfServiceError(opts.encryptedErrorKey ?? 'pdf.errors.encrypted');
    throw new PdfServiceError(opts.parseErrorKey ?? 'pdf.errors.parse', errorMessage(err));
  }
}

/** Loads a document read-only for inspection; encrypted files are parsed structurally without decrypting. */
export async function loadForInspection(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
}
