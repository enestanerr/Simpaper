/**
 * Shell actions (ribbon `shell` actions, QAT items, keyboard shortcuts). A module can override any id
 * through ModuleDefinition.actions (e.g. the PDF module implements its own undo/save).
 */
import type { DocumentDescriptor } from '@shared/api/documents';
import { isOfficeKind } from '@shared/modules';
import { SHELL_ACTIONS } from '../ribbon/types';
import { getModule } from '../modules/registry';
import { getActiveDocument, openBackstage, useApp } from '../state/appStore';
import { getCommandState } from '../state/commandStore';
import { closeDocument, createDocument, openWithDialog, printDocument, saveDocument } from './documents';
import { dispatchUno } from './engine';
import { updateSettings } from './settings';
import { setOfficeZoom, stepZoom } from './zoom';
import { zoomFromState } from './unoValues';

type Handler = (doc: DocumentDescriptor | null, payload?: unknown) => unknown;

interface Builtin {
  run: Handler;
  /** Whether the action can run for this document (drives enabled state of QAT/ribbon controls). */
  available: (doc: DocumentDescriptor | null) => boolean;
  /** UNO command whose enabled state gates the action for office documents. */
  unoGate?: string;
}

const officeDoc = (doc: DocumentDescriptor | null): doc is DocumentDescriptor => !!doc && isOfficeKind(doc.kind) && doc.state === 'ready';
const anyDoc = (doc: DocumentDescriptor | null): doc is DocumentDescriptor => !!doc && doc.state !== 'closed';

function zoomBy(doc: DocumentDescriptor | null, direction: 1 | -1): void {
  if (!officeDoc(doc)) return;
  const current = zoomFromState(getCommandState(doc.docId, '.uno:Zoom')?.value) ?? 100;
  void setOfficeZoom(doc.docId, stepZoom(current, direction));
}

const BUILTINS: Record<string, Builtin> = {
  [SHELL_ACTIONS.save]: { run: (d) => d && saveDocument(d.docId), available: anyDoc },
  [SHELL_ACTIONS.saveAs]: { run: (d) => d && saveDocument(d.docId, { saveAs: true }), available: anyDoc },
  [SHELL_ACTIONS.exportPdf]: { run: () => openBackstage('exportPdf'), available: (d) => officeDoc(d) },
  [SHELL_ACTIONS.print]: { run: (d) => d && printDocument(d.docId), available: anyDoc },
  [SHELL_ACTIONS.openBackstage]: { run: (d) => openBackstage(d ? 'info' : 'new'), available: () => true },
  [SHELL_ACTIONS.newDocument]: {
    run: (d) => (d && isOfficeKind(d.kind) ? createDocument(d.kind) : openBackstage('new')),
    available: () => true,
  },
  [SHELL_ACTIONS.open]: { run: () => openWithDialog(), available: () => true },
  [SHELL_ACTIONS.close]: { run: (d) => d && closeDocument(d.docId), available: anyDoc },
  [SHELL_ACTIONS.undo]: { run: (d) => officeDoc(d) && dispatchUno(d.docId, '.uno:Undo'), available: officeDoc, unoGate: '.uno:Undo' },
  [SHELL_ACTIONS.redo]: { run: (d) => officeDoc(d) && dispatchUno(d.docId, '.uno:Redo'), available: officeDoc, unoGate: '.uno:Redo' },
  [SHELL_ACTIONS.find]: { run: (d) => officeDoc(d) && dispatchUno(d.docId, '.uno:SearchDialog'), available: officeDoc },
  [SHELL_ACTIONS.replace]: { run: (d) => officeDoc(d) && dispatchUno(d.docId, '.uno:SearchDialog'), available: officeDoc },
  [SHELL_ACTIONS.toggleRibbon]: {
    run: () => updateSettings({ ui: { ribbonCollapsed: !useApp.getState().settings.ui.ribbonCollapsed } }),
    available: () => true,
  },
  [SHELL_ACTIONS.zoomIn]: { run: (d) => zoomBy(d, 1), available: officeDoc },
  [SHELL_ACTIONS.zoomOut]: { run: (d) => zoomBy(d, -1), available: officeDoc },
};

export function isBuiltinShellAction(id: string): boolean {
  return id in BUILTINS;
}

/** Whether `id` can run for `doc` right now (module override, or built-in with its UNO gate). */
export function isShellActionEnabled(id: string, doc: DocumentDescriptor | null): boolean {
  const override = doc ? getModule(doc.kind)?.actions?.[id] : undefined;
  if (override) return doc?.state !== 'loading' && doc?.state !== 'crashed';
  const b = BUILTINS[id];
  if (!b || !b.available(doc)) return false;
  if (b.unoGate && doc && isOfficeKind(doc.kind)) {
    const st = getCommandState(doc.docId, b.unoGate);
    return st ? st.enabled : true;
  }
  return true;
}

export function shellActionGate(id: string): string | undefined {
  return BUILTINS[id]?.unoGate;
}

export async function runShellAction(id: string, payload?: unknown, doc: DocumentDescriptor | null = getActiveDocument()): Promise<void> {
  const override = doc ? getModule(doc.kind)?.actions?.[id] : undefined;
  if (override) {
    await override(doc, payload);
    return;
  }
  const b = BUILTINS[id];
  if (!b) {
    console.warn(`[simpaper] unknown shell action ${id}`);
    return;
  }
  if (!b.available(doc)) return;
  await b.run(doc, payload);
}
