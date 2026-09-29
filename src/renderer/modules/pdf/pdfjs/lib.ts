/**
 * Single entry to pdf.js for the module. `pdfjs-dist` (build/pdf.mjs) must be evaluated before
 * `pdfjs-dist/web/pdf_viewer.mjs`, which reads `globalThis.pdfjsLib` when it loads; importing the viewer
 * only through this file guarantees that order.
 */
import * as pdfjsLib from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';

export const { AnnotationEditorParamsType, AnnotationEditorType, AnnotationMode, PasswordResponses, PixelsPerInch, getDocument } = pdfjsLib;
export type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask } from 'pdfjs-dist';
export { pdfjsLib };
