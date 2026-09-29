/** Start-up: loads settings, app info and open documents, and routes main-process events into the stores. */
import type { DocumentEvent } from '@shared/api/documents';
import { SHELL_ACTIONS } from '../ribbon/types';
import { stopKeyTips } from '../ribbon/keytipStore';
import {
  dismissMessage,
  enqueuePrompt,
  getDocument,
  openBackstage,
  pushMessage,
  removeDocument,
  setBusy,
  setRibbonPeek,
  upsertDocument,
  useApp,
} from '../state/appStore';
import { clearDocumentCommands, setCommandState, setContext } from '../state/commandStore';
import { clearFrozen } from '../state/viewStore';
import { cycleRegion, showKeyTips } from '../shell/keyboard';
import {
  activateDocument,
  answerFlushRequest,
  cycleDocument,
  noteActivatedByMain,
  noteDocumentClosed,
  refreshRecent,
  refreshRecovery,
  restartEngine,
  showDocument,
  wasDocumentClosed,
} from './documents';
import { forgetSubscriptions } from './engine';
import { hasBridge, invoke, on } from './ipc';
import { releaseAllOverlays } from './overlay';
import { emitSelectionChange } from './selection';
import { applySettings } from './settings';
import { runShellAction } from './shellActions';
import { noteDocumentActivity, noteWindowState } from './windowActivity';

/** Engine errors that leave the document `busy` (hung) or `crashed`; the user may restart the engine from the message bar. */
const RESTARTABLE_ERRORS = new Set(['errors.engine.notResponding', 'errors.engine.restartLimit', 'errors.engine.restoreFailed']);
const NOT_RESPONDING = 'errors.engine.notResponding';
/** One "not responding" bar per document; it goes away once the document is no longer hung (`busy`). */
const hangMessageId = (docId: string) => `hang:${docId}`;

export async function loadInitialState(): Promise<void> {
  if (!hasBridge()) {
    useApp.setState({ ready: true });
    return;
  }
  const [settings, appInfo, documents, windowState] = await Promise.all([
    invoke('app:settings:get', undefined).catch(() => null),
    invoke('app:info', undefined).catch(() => null),
    invoke('documents:list', undefined).catch(() => []),
    invoke('app:window:state', undefined).catch(() => null),
  ]);
  if (settings) applySettings(settings);
  useApp.setState({ appInfo, windowState, documents, ready: true });
  if (windowState) noteWindowState(windowState);
  const first = documents[documents.length - 1];
  if (first) activateDocument(first.docId);
  void refreshRecent();
  void refreshRecovery();
}

/** Handles one documents:event. Exported for tests. */
export function handleDocumentEvent(ev: DocumentEvent): void {
  switch (ev.type) {
    case 'opened':
      showDocument(ev.doc);
      break;
    case 'updated': {
      const prev = getDocument(ev.doc.docId);
      // A late update of a document that is gone must not bring its tab back.
      if (!prev && wasDocumentClosed(ev.doc.docId)) break;
      upsertDocument(ev.doc);
      if (prev?.state === 'busy' && ev.doc.state !== 'busy') dismissMessage(hangMessageId(ev.doc.docId));
      if (prev && prev.state !== ev.doc.state && (ev.doc.state === 'crashed' || ev.doc.state === 'closed')) {
        clearFrozen(ev.doc.docId);
        forgetSubscriptions(ev.doc.docId);
        // The command states belong to the engine that ended; the restored engine reports its own.
        if (ev.doc.state === 'crashed') clearDocumentCommands(ev.doc.docId);
        void refreshRecovery();
      }
      break;
    }
    case 'closed': {
      noteDocumentClosed(ev.docId);
      const next = removeDocument(ev.docId);
      clearDocumentCommands(ev.docId);
      clearFrozen(ev.docId);
      forgetSubscriptions(ev.docId);
      if (next) activateDocument(next);
      void refreshRecent();
      break;
    }
    case 'activated':
      if (getDocument(ev.docId)) noteActivatedByMain(ev.docId);
      break;
    case 'state':
      setCommandState(ev.docId, ev.command, { enabled: ev.enabled, value: ev.value });
      noteDocumentActivity(ev.docId);
      break;
    case 'context':
      setContext(ev.docId, ev.context);
      noteDocumentActivity(ev.docId);
      break;
    case 'busy':
      setBusy(ev.docId, ev.busy ? { busy: true, reason: ev.reason } : { busy: false });
      // A LibreOffice dialog took over the keyboard: close our popups and KeyTips. The dialog belongs to the
      // document window, so the application stays active (title bar look).
      if (ev.busy && ev.reason === 'dialog') {
        stopKeyTips();
        releaseTransientOverlays();
        if (ev.docId) noteDocumentActivity(ev.docId);
      }
      break;
    case 'error': {
      const docId = ev.docId;
      const action = docId !== null && RESTARTABLE_ERRORS.has(ev.errorKey) ? { labelKey: 'shell.messages.restartEngine', run: () => void restartEngine(docId) } : undefined;
      const id = docId !== null && ev.errorKey === NOT_RESPONDING ? hangMessageId(docId) : undefined;
      pushMessage({ kind: 'error', docId, key: ev.errorKey, detail: ev.detail, ...(action ? { action } : {}), ...(id ? { id } : {}) });
      break;
    }
    case 'notice':
      pushMessage({ kind: 'info', docId: ev.docId, key: ev.noticeKey, detail: ev.detail, timeoutMs: 10_000 });
      break;
    case 'prompt':
      enqueuePrompt(ev.prompt);
      break;
    case 'shellKey':
      noteDocumentActivity(ev.docId);
      handleShellKey(ev.key);
      break;
    case 'intercept':
      handleIntercept(ev.command);
      break;
    case 'flushRequest':
      // Main is about to save/close/quit: push pending PDF edits, then always acknowledge.
      void answerFlushRequest(ev.docId, ev.requestId);
      break;
    default: {
      // Forward-compatible: `selection` is emitted by the engine but not (yet) part of DocumentEvent.
      const loose = ev as { type: string; docId?: string };
      if (loose.type === 'selection' && loose.docId) {
        noteDocumentActivity(loose.docId);
        emitSelectionChange(loose.docId);
      }
    }
  }
}

/**
 * The keyboard left the shell (window blur) or a LibreOffice dialog took over: drops the transient overlay
 * holders and closes the peeking ribbon, whose panel would otherwise stay open under the uncovered document
 * window. Open dialogs keep the document frozen (persistent holders).
 */
function releaseTransientOverlays(): void {
  releaseAllOverlays();
  setRibbonPeek(false);
}

/** Keys pressed while the native document view had focus (forwarded by the engine / keyboard hook). */
export function handleShellKey(key: Extract<DocumentEvent, { type: 'shellKey' }>['key']): void {
  switch (key) {
    case 'Alt':
    case 'F10':
      showKeyTips();
      break;
    case 'F6':
      cycleRegion(1, 'workspace');
      break;
    case 'ShiftF6':
      cycleRegion(-1, 'workspace');
      break;
    case 'CtrlF1':
      void runShellAction(SHELL_ACTIONS.toggleRibbon);
      break;
    case 'CtrlTab':
      cycleDocument(1);
      break;
    case 'CtrlShiftTab':
      cycleDocument(-1);
      break;
  }
}

/**
 * Commands intercepted in the engine that the main process leaves to the shell. File commands are
 * handled in the main process; these open the matching shell UI.
 */
export function handleIntercept(command: string): void {
  switch (command) {
    case '.uno:OptionsTreeDialog':
      openBackstage('options');
      break;
    case '.uno:About':
      openBackstage('about');
      break;
    case '.uno:ExportToPDF':
      openBackstage('exportPdf');
      break;
    case '.uno:SaveAs':
      void runShellAction(SHELL_ACTIONS.saveAs);
      break;
    default:
      break;
  }
}

/** Subscribes to main-process events; returns the unsubscribe function. */
export function wireEvents(): () => void {
  if (!hasBridge()) return () => {};
  const offs = [
    on('documents:event', handleDocumentEvent),
    on('app:settingsChanged', applySettings),
    on('app:windowState', (windowState) => {
      useApp.setState({ windowState });
      noteWindowState(windowState);
      if (!windowState.focused) releaseTransientOverlays();
    }),
  ];
  return () => offs.forEach((off) => off());
}

