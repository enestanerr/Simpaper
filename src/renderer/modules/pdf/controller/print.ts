/**
 * Renders pages for printing (as pdf.js' print service does: print intent, form values and annotation
 * edits from the annotation storage). The main process only shows the system print dialog.
 */
import type { PdfPrintPage } from '@shared/api/pdf';
import { AnnotationMode, type PDFDocumentProxy } from '../pdfjs/lib';

/** pdf.js prints at 150 DPI by default; 200 keeps small text crisp at a moderate memory cost. */
export const PRINT_DPI = 200;

export async function renderPagesForPrint(
  pdf: PDFDocumentProxy,
  opts: { signal: AbortSignal; onProgress: (done: number, total: number) => void },
): Promise<PdfPrintPage[]> {
  const total = pdf.numPages;
  const pages: PdfPrintPage[] = [];
  const printStorage = pdf.annotationStorage.print;
  const canvas = document.createElement('canvas');
  try {
    for (let n = 1; n <= total; n++) {
      if (opts.signal.aborted) throw new DOMException('Print cancelled', 'AbortError');
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: PRINT_DPI / 72 });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({
        canvas,
        viewport,
        intent: 'print',
        annotationMode: AnnotationMode.ENABLE_STORAGE,
        printAnnotationStorage: printStorage,
      }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('page image encoding failed');
      pages.push({
        data: new Uint8Array(await blob.arrayBuffer()),
        mime: 'image/png',
        widthPt: (viewport.width * 72) / PRINT_DPI,
        heightPt: (viewport.height * 72) / PRINT_DPI,
      });
      page.cleanup();
      opts.onProgress(n, total);
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  return pages;
}
