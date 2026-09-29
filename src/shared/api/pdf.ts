/** `pdf:*` — PDF module file operations. Rendering and annotation editing happen in the renderer (pdf.js). Owner: main/pdf. */
import type { SaveResult } from './documents';

export interface PdfTextInsert {
  pageIndex: number;
  /**
   * PDF user-space coordinates (points, origin bottom-left).
   * The point is the top-left corner of the text block as the page is displayed (its /Rotate applied):
   * lines run to the right and downwards in that orientation, so text is upright on rotated pages too.
   */
  x: number;
  y: number;
  /** May contain `\n` line breaks. */
  text: string;
  fontSize: number;
  /** `#RRGGBB` (or `#RGB`). */
  color: string;
}

export interface PdfImageInsert {
  pageIndex: number;
  /** Top-left corner of the image as the page is displayed, in PDF user space (same convention as PdfTextInsert). */
  x: number;
  y: number;
  /** Size in points along the displayed page's horizontal / vertical axis. */
  width: number;
  height: number;
  /** PNG or JPEG bytes. */
  data: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
}

export interface PdfPageOp {
  op: 'rotate' | 'delete' | 'move' | 'insertBlank' | 'duplicate';
  /**
   * Index in the document as it is when this op runs (ops are applied in order).
   * insertBlank: the new page is inserted at this index (0…pageCount); duplicate: the copy is inserted after it.
   */
  pageIndex: number;
  /** rotate: degrees added clockwise (±90/180/270); move: target index. */
  value?: number;
}

/** One page rendered by the renderer for printing (the main process shows only the system print dialog). */
export interface PdfPrintPage {
  /** PNG or JPEG bytes of the rendered page. */
  data: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  /** Page size as displayed, in points (1/72 in). */
  widthPt: number;
  heightPt: number;
}

export interface PdfChannels {
  /** Returns the current bytes of an open PDF document (working copy). */
  'pdf:read': { req: { docId: string }; res: Uint8Array };
  /** Replaces the working copy with new bytes produced by pdf.js (annotations/forms) and marks the doc modified. */
  'pdf:update': { req: { docId: string; bytes: Uint8Array }; res: void };
  /** Writes the working copy to disk with the safe-save pipeline (qpdf/pdf.js re-open check, atomic replace). */
  'pdf:save': { req: { docId: string; saveAs?: boolean }; res: SaveResult };
  'pdf:insertText': { req: { docId: string; items: PdfTextInsert[] }; res: Uint8Array };
  'pdf:insertImage': { req: { docId: string; item: PdfImageInsert }; res: Uint8Array };
  'pdf:pages': { req: { docId: string; ops: PdfPageOp[] }; res: Uint8Array };
  /**
   * Appends the pages of other PDF files chosen in the open dialog. `paths` is rejected over IPC
   * (errors.ipc.invalidRequest): the renderer never names files to read.
   */
  'pdf:merge': { req: { docId: string; paths?: string[] }; res: Uint8Array };
  /** Writes the selected pages to a new PDF file (split/extract). */
  'pdf:extract': { req: { docId: string; pageIndices: number[] }; res: SaveResult };
  /** Prints pages rendered by the renderer (`pages`); only the system print dialog is shown. */
  'pdf:print': { req: { docId: string; pages?: PdfPrintPage[] }; res: void };
  /**
   * The first pdf.js edit after load or after a save: marks the document modified in the main process at once,
   * before the (debounced) byte sync with pdf:update, so close/quit prompts are never skipped.
   */
  'pdf:markModified': { req: { docId: string }; res: void };
}

/**
 * Errors thrown by `pdf:*` handlers carry an i18n key of the `pdf` namespace in their message
 * (e.g. `pdf.errors.encrypted`), so the renderer can show a translated message.
 */
export const PDF_ERROR_KEY_PATTERN = /pdf\.errors\.[A-Za-z]+/;

export const PDF_CHANNELS = [
  'pdf:read',
  'pdf:update',
  'pdf:save',
  'pdf:insertText',
  'pdf:insertImage',
  'pdf:pages',
  'pdf:merge',
  'pdf:extract',
  'pdf:print',
  'pdf:markModified',
] as const;
