/** Contract of the PDF service (implementation: src/main/pdf/*). One method per `pdf:*` IPC channel. */
import type { BrowserWindow } from 'electron';
import type { SaveResult } from '@shared/api/documents';
import type { PdfImageInsert, PdfPageOp, PdfPrintPage, PdfTextInsert } from '@shared/api/pdf';

export interface PdfService {
  read(docId: string): Promise<Uint8Array>;
  update(docId: string, bytes: Uint8Array): Promise<void>;
  save(docId: string, saveAs: boolean, win: BrowserWindow | null): Promise<SaveResult>;
  insertText(docId: string, items: PdfTextInsert[]): Promise<Uint8Array>;
  insertImage(docId: string, item: PdfImageInsert): Promise<Uint8Array>;
  pages(docId: string, ops: PdfPageOp[]): Promise<Uint8Array>;
  merge(docId: string, paths: string[] | undefined, win: BrowserWindow | null): Promise<Uint8Array>;
  extract(docId: string, pageIndices: number[], win: BrowserWindow | null): Promise<SaveResult>;
  /** `pages`: the rendered pages sent with `pdf:print` (required; the main process cannot render PDFs). */
  print(docId: string, win: BrowserWindow | null, pages?: PdfPrintPage[]): Promise<void>;
  /** `pdf:markModified`: the first pdf.js edit after load/save marks the document modified at once. */
  markModified(docId: string): void;
}
