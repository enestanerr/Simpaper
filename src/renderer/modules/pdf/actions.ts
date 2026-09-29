/**
 * Shell actions of the PDF module (ribbon `shell` actions, QAT, shortcuts). The generic ids
 * (file.save, edit.undo, view.zoomIn …) override the shell's built-ins for PDF documents.
 */
import type { DocumentDescriptor } from '@shared/api/documents';
import { SHELL_ACTIONS } from '@renderer/ribbon/types';
import { controllerFor } from './controller/registry';
import type { PdfController } from './controller/controller';
import { colorNumberToHex } from './logic/misc';
import { formatPageRanges, planDelete, planDuplicate, planInsertBlank, planNudge, planRotate } from './logic/pages';
import { docState, openFind, patchDoc, pushNotice, type EditorTool } from './state/store';

export const PDF_ACTIONS = {
  copy: 'pdf.edit.copy',
  firstPage: 'pdf.nav.first',
  previousPage: 'pdf.nav.previous',
  nextPage: 'pdf.nav.next',
  lastPage: 'pdf.nav.last',
  goToPage: 'pdf.nav.goTo',
  zoom: 'pdf.view.zoom',
  fitWidth: 'pdf.view.fitWidth',
  fitPage: 'pdf.view.fitPage',
  actualSize: 'pdf.view.actualSize',
  rotateViewCw: 'pdf.view.rotateCw',
  rotateViewCcw: 'pdf.view.rotateCcw',
  thumbnails: 'pdf.view.thumbnails',
  scrollMode: 'pdf.view.scrollMode',
  spreadMode: 'pdf.view.spreadMode',
  tool: 'pdf.annotate.tool',
  highlightSelection: 'pdf.annotate.highlightSelection',
  comment: 'pdf.annotate.comment',
  deleteAnnotation: 'pdf.annotate.delete',
  color: 'pdf.annotate.color',
  textSize: 'pdf.annotate.textSize',
  thickness: 'pdf.annotate.thickness',
  rotatePagesCw: 'pdf.pages.rotateCw',
  rotatePagesCcw: 'pdf.pages.rotateCcw',
  deletePages: 'pdf.pages.delete',
  movePagesUp: 'pdf.pages.moveUp',
  movePagesDown: 'pdf.pages.moveDown',
  duplicatePages: 'pdf.pages.duplicate',
  insertBlank: 'pdf.pages.insertBlank',
  merge: 'pdf.pages.merge',
  extract: 'pdf.pages.extract',
  selectAllPages: 'pdf.pages.selectAll',
  addText: 'pdf.content.addText',
  addImage: 'pdf.content.addImage',
  previousField: 'pdf.forms.previous',
  nextField: 'pdf.forms.next',
  highlightFields: 'pdf.forms.highlight',
} as const;

type Handler = (docId: string, payload?: unknown) => void | Promise<void>;

/** Runs `fn` with the document's controller; reports when the document is still loading. */
function withController(fn: (c: PdfController, docId: string, payload: unknown) => void | Promise<void>): Handler {
  return (docId, payload) => {
    const controller = controllerFor(docId);
    if (!controller) return;
    if (!controller.pdfDocument) {
      pushNotice(docId, { kind: 'info', key: 'pdf.notices.notReady' });
      return;
    }
    return fn(controller, docId, payload);
  };
}

/** Pages the page tools act on: the thumbnail selection, else the current page. */
export function targetPages(docId: string): number[] {
  const s = docState(docId);
  return s.selection.length > 0 ? [...s.selection].sort((a, b) => a - b) : [Math.max(0, s.currentPage - 1)];
}

function asNumber(payload: unknown): number | null {
  const n = typeof payload === 'number' ? payload : typeof payload === 'string' ? Number(payload) : NaN;
  return Number.isFinite(n) ? n : null;
}

const TOOLS: readonly EditorTool[] = ['none', 'highlight', 'freetext', 'ink', 'stamp'];

/** pdf.js' default annotation colours per tool. */
const DEFAULT_COLORS: Record<EditorTool, string> = { none: '#000000', stamp: '#000000', freetext: '#000000', ink: '#000000', highlight: '#FFFF98' };

const handlers: Record<string, Handler> = {
  [SHELL_ACTIONS.save]: withController((c) => c.save(false)),
  [SHELL_ACTIONS.saveAs]: withController((c) => c.save(true)),
  [SHELL_ACTIONS.print]: withController((c) => c.print()),
  [SHELL_ACTIONS.undo]: withController((c) => c.editingAction('undo')),
  [SHELL_ACTIONS.redo]: withController((c) => c.editingAction('redo')),
  [SHELL_ACTIONS.find]: withController((_c, docId) => openFind(docId)),
  [SHELL_ACTIONS.replace]: withController((_c, docId) => {
    openFind(docId);
    pushNotice(docId, { kind: 'info', key: 'pdf.notices.replaceUnsupported' });
  }),
  [SHELL_ACTIONS.zoomIn]: withController((c) => c.zoomIn()),
  [SHELL_ACTIONS.zoomOut]: withController((c) => c.zoomOut()),

  [PDF_ACTIONS.copy]: withController((c, docId) => {
    if (!c.copySelection()) pushNotice(docId, { kind: 'info', key: 'pdf.notices.selectTextFirst' });
  }),
  [PDF_ACTIONS.firstPage]: withController((c) => c.firstPage()),
  [PDF_ACTIONS.previousPage]: withController((c) => c.previousPage()),
  [PDF_ACTIONS.nextPage]: withController((c) => c.nextPage()),
  [PDF_ACTIONS.lastPage]: withController((c) => c.lastPage()),
  [PDF_ACTIONS.goToPage]: withController((c, docId, payload) => {
    const n = asNumber(payload);
    if (n !== null) c.goToPage(n);
    else patchDoc(docId, { dialog: { kind: 'goToPage' } });
  }),
  [PDF_ACTIONS.zoom]: withController((c, docId, payload) => {
    if (typeof payload !== 'string' || !c.setZoom(payload)) pushNotice(docId, { kind: 'error', key: 'pdf.errors.zoomValue' });
  }),
  [PDF_ACTIONS.fitWidth]: withController((c) => void c.setZoom('page-width')),
  [PDF_ACTIONS.fitPage]: withController((c) => void c.setZoom('page-fit')),
  [PDF_ACTIONS.actualSize]: withController((c) => void c.setZoom('page-actual')),
  [PDF_ACTIONS.rotateViewCw]: withController((c) => c.rotateView(90)),
  [PDF_ACTIONS.rotateViewCcw]: withController((c) => c.rotateView(-90)),
  [PDF_ACTIONS.thumbnails]: withController((_c, docId) => patchDoc(docId, (s) => ({ sidebarOpen: !s.sidebarOpen }))),
  [PDF_ACTIONS.scrollMode]: withController((c, _docId, payload) => {
    if (payload === 'vertical' || payload === 'horizontal' || payload === 'wrapped' || payload === 'page') c.setScrollMode(payload);
  }),
  [PDF_ACTIONS.spreadMode]: withController((c, _docId, payload) => {
    if (payload === 'none' || payload === 'odd' || payload === 'even') c.setSpreadMode(payload);
  }),

  [PDF_ACTIONS.tool]: withController((c, docId, payload) => {
    const tool = TOOLS.find((t) => t === payload) ?? 'none';
    // Choosing the active tool again returns to selection, like toggling a ribbon button off.
    c.setEditorTool(docState(docId).editorTool === tool ? 'none' : tool);
  }),
  [PDF_ACTIONS.highlightSelection]: withController((c, docId) => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) {
      pushNotice(docId, { kind: 'info', key: 'pdf.notices.selectTextFirst' });
      return;
    }
    c.editingAction('highlightSelection');
  }),
  [PDF_ACTIONS.comment]: withController((c, docId) => {
    const current = c.selectedComment();
    if (current === null) pushNotice(docId, { kind: 'info', key: 'pdf.notices.selectAnnotationFirst' });
    else patchDoc(docId, { dialog: { kind: 'comment', initial: current } });
  }),
  [PDF_ACTIONS.deleteAnnotation]: withController((c, docId) => {
    if (!docState(docId).hasSelectedEditor) pushNotice(docId, { kind: 'info', key: 'pdf.notices.selectAnnotationFirst' });
    else c.editingAction('delete');
  }),
  [PDF_ACTIONS.color]: withController((c, docId, payload) => {
    // `null` is the palette's "default" choice: the tool's own default colour.
    const hex = typeof payload === 'number' ? colorNumberToHex(payload) : typeof payload === 'string' ? payload : DEFAULT_COLORS[docState(docId).editorTool];
    c.setAnnotationColor(hex);
  }),
  [PDF_ACTIONS.textSize]: withController((c, _docId, payload) => {
    const n = asNumber(payload);
    if (n !== null) c.setFreeTextSize(n);
  }),
  [PDF_ACTIONS.thickness]: withController((c, _docId, payload) => {
    const n = asNumber(payload);
    if (n !== null) c.setThickness(n);
  }),

  [PDF_ACTIONS.rotatePagesCw]: withController((c, docId) => c.applyPageOps(planRotate(targetPages(docId), 90))),
  [PDF_ACTIONS.rotatePagesCcw]: withController((c, docId) => c.applyPageOps(planRotate(targetPages(docId), -90))),
  [PDF_ACTIONS.deletePages]: withController((_c, docId) => {
    const pages = targetPages(docId);
    if (planDelete(pages, docState(docId).pageCount).length === 0) pushNotice(docId, { kind: 'error', key: 'pdf.errors.lastPage' });
    else patchDoc(docId, { dialog: { kind: 'confirmDelete', pages } });
  }),
  [PDF_ACTIONS.movePagesUp]: withController((c, docId) => {
    const ops = planNudge(targetPages(docId), -1, docState(docId).pageCount);
    if (ops.length > 0) return c.applyPageOps(ops);
    pushNotice(docId, { kind: 'info', key: 'pdf.notices.atStart' });
  }),
  [PDF_ACTIONS.movePagesDown]: withController((c, docId) => {
    const ops = planNudge(targetPages(docId), 1, docState(docId).pageCount);
    if (ops.length > 0) return c.applyPageOps(ops);
    pushNotice(docId, { kind: 'info', key: 'pdf.notices.atEnd' });
  }),
  [PDF_ACTIONS.duplicatePages]: withController((c, docId) => c.applyPageOps(planDuplicate(targetPages(docId)))),
  [PDF_ACTIONS.insertBlank]: withController((c, docId) => {
    const pages = targetPages(docId);
    const after = pages[pages.length - 1]! + 1;
    return c.applyPageOps(planInsertBlank(after), [after]);
  }),
  [PDF_ACTIONS.merge]: withController((c) => c.merge()),
  [PDF_ACTIONS.extract]: withController((_c, docId) => {
    const s = docState(docId);
    const initial = s.selection.length > 0 ? formatPageRanges(s.selection) : String(s.currentPage);
    patchDoc(docId, { dialog: { kind: 'extract', initial } });
  }),
  [PDF_ACTIONS.selectAllPages]: withController((_c, docId) => patchDoc(docId, (s) => ({ selection: Array.from({ length: s.pageCount }, (_, i) => i), sidebarOpen: true }))),
  [PDF_ACTIONS.addText]: withController((c) => c.startAddText()),
  [PDF_ACTIONS.addImage]: withController((c) => c.startAddImage()),
  [PDF_ACTIONS.previousField]: withController((c) => c.focusField(-1)),
  [PDF_ACTIONS.nextField]: withController((c) => c.focusField(1)),
  [PDF_ACTIONS.highlightFields]: withController((c, docId) => c.setFieldHighlight(!docState(docId).highlightFields)),
};

/**
 * ModuleDefinition.flush: writes pending annotation/form edits of an open PDF into the main process' working
 * copy (before the document is closed, saved or the app quits). Nothing to do without a controller.
 */
export function flushPdf(docId: string): Promise<void> {
  return controllerFor(docId)?.flush() ?? Promise.resolve();
}

/** Runs a PDF action for a document (used by the thumbnails' keyboard shortcuts). */
export function runPdfAction(id: string, docId: string, payload?: unknown): void | Promise<void> {
  return handlers[id]?.(docId, payload);
}

/** ModuleDefinition.actions: the shell passes the active document. */
export const pdfActions: Record<string, (doc: DocumentDescriptor | null, payload?: unknown) => void | Promise<void>> = Object.fromEntries(
  Object.entries(handlers).map(([id, handler]) => [id, (doc: DocumentDescriptor | null, payload?: unknown) => (doc ? handler(doc.docId, payload) : undefined)]),
);
