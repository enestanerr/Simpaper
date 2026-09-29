/** pdf.js viewer components (loaded after the core library, see ./lib). */
import './lib';
import { EventBus, FindState, PDFFindController, PDFLinkService, PDFViewer, ScrollMode, SpreadMode } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { withTurkishMatching } from './find';

export const TurkishFindController = withTurkishMatching(PDFFindController);
export { EventBus, FindState, PDFLinkService, PDFViewer, ScrollMode, SpreadMode };
export type { PDFViewerOptions } from 'pdfjs-dist/types/web/pdf_viewer';
