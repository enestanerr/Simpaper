/**
 * Errors of the PDF service. The key is an i18n key of the renderer's `pdf` namespace; extending
 * DocumentError lets the IPC router pass it to the renderer as the rejection message
 * (errors it does not know are reduced to `errors.generic`).
 */
import { DocumentError } from '../documents/errors';

export type PdfErrorKey =
  | 'pdf.errors.notOpen'
  | 'pdf.errors.noWorkingCopy'
  | 'pdf.errors.invalidBytes'
  | 'pdf.errors.parse'
  | 'pdf.errors.encrypted'
  | 'pdf.errors.mergeEncrypted'
  | 'pdf.errors.mergeParse'
  | 'pdf.errors.invalidPage'
  | 'pdf.errors.invalidOp'
  | 'pdf.errors.lastPage'
  | 'pdf.errors.emptyText'
  | 'pdf.errors.noFont'
  | 'pdf.errors.imageFormat'
  | 'pdf.errors.verifyFailed'
  | 'pdf.errors.saveFailed'
  | 'pdf.errors.extractFailed'
  | 'pdf.errors.extractSameFile'
  | 'pdf.errors.printNothing'
  | 'pdf.errors.printFailed'
  | 'pdf.errors.cancelled';

export class PdfServiceError extends DocumentError {
  readonly key: PdfErrorKey;

  /** `detail` is technical context for logs and error details (never document content). */
  constructor(key: PdfErrorKey, detail?: string) {
    super(key, detail !== undefined ? { detail } : undefined);
    this.key = key;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof PdfServiceError) return err.detail ? `${err.key}: ${err.detail}` : err.key;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Maps any failure to an error key; unknown errors fall back to `fallback`. */
export function errorKeyOf(err: unknown, fallback: PdfErrorKey): PdfErrorKey {
  return err instanceof PdfServiceError ? err.key : fallback;
}
