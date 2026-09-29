/**
 * Publishes PDF view state to the shell's command store, so standard ribbon toggles (tool buttons,
 * thumbnails, layout modes) show their pressed state through ordinary state bindings.
 */
import { clearDocumentCommands, setCommandState } from '@renderer/state/commandStore';
import { usePdfStore, type PdfDocState } from './store';

export const PDF_STATE = {
  tool: 'pdf:tool',
  contentTool: 'pdf:contentTool',
  sidebar: 'pdf:sidebar',
  fieldsHighlighted: 'pdf:fieldsHighlighted',
  scroll: 'pdf:scrollMode',
  spread: 'pdf:spreadMode',
  zoom: 'pdf:zoom',
  page: 'pdf:page',
} as const;

function publish(docId: string, s: PdfDocState): void {
  const enabled = s.status === 'ready';
  setCommandState(docId, PDF_STATE.tool, { enabled, value: s.editorTool });
  setCommandState(docId, PDF_STATE.contentTool, { enabled, value: s.contentTool });
  setCommandState(docId, PDF_STATE.sidebar, { enabled, value: s.sidebarOpen });
  setCommandState(docId, PDF_STATE.fieldsHighlighted, { enabled, value: s.highlightFields });
  setCommandState(docId, PDF_STATE.scroll, { enabled, value: s.scrollMode });
  setCommandState(docId, PDF_STATE.spread, { enabled, value: s.spreadMode });
  setCommandState(docId, PDF_STATE.zoom, { enabled, value: Math.round(s.scale * 100) });
  setCommandState(docId, PDF_STATE.page, { enabled, value: s.currentPage });
}

let started = false;

/** Starts mirroring (idempotent). Removed documents have their command states cleared. */
export function startCommandBridge(): void {
  if (started) return;
  started = true;
  usePdfStore.subscribe((state, previous) => {
    for (const [docId, doc] of Object.entries(state.docs)) {
      if (previous.docs[docId] !== doc) publish(docId, doc);
    }
    for (const docId of Object.keys(previous.docs)) {
      if (!(docId in state.docs)) clearDocumentCommands(docId);
    }
  });
}
