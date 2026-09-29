/**
 * PDF module: pdf.js viewer/annotation editor in the renderer, file operations through `pdf:*` IPC
 * (src/main/pdf). See docs/dev/pdf.md.
 */
import type { ModuleDefinition } from '../types';
import { flushPdf, pdfActions } from './actions';
import { PdfStatusBar } from './components/StatusBar';
import { PdfWorkspace } from './components/Workspace';
import { pdfRibbon } from './ribbon';
import { startCommandBridge } from './state/commandBridge';
import './pdf.css';

startCommandBridge();

export const pdfModule: ModuleDefinition = {
  kind: 'pdf',
  ribbon: pdfRibbon,
  Workspace: PdfWorkspace,
  StatusBar: PdfStatusBar,
  actions: pdfActions,
  flush: flushPdf,
};

export { PDF_ACTIONS } from './actions';
