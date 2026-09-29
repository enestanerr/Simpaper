/** Document lifecycle actions (open/create/save/export/print/close) and their user feedback. */
import type { DocumentDescriptor, PdfExportOptions, PromptAnswer, SaveOptions, SaveResult } from '@shared/api/documents';
import { isOfficeKind, type ModuleKind } from '@shared/modules';
import {
  closeBackstage,
  getDocument,
  pushMessage,
  removePrompt,
  setActiveDocId,
  upsertDocument,
  useApp,
} from '../state/appStore';
import { allModules } from '../modules/registry';
import { errorKeyOf, errorText } from './engine';
import { hasBridge, invoke } from './ipc';
import { claimKeyboard } from './keyboardFocus';

let lastActivationSent: string | null = null;

/** Longest wait for pending edits to be pushed before a close goes ahead anyway (hung pdf.js save). */
const PRE_CLOSE_FLUSH_TIMEOUT_MS = 10_000;
/** How many closed document ids are remembered (late invoke results and events for them are ignored). */
const CLOSED_MEMORY = 256;
const closedDocIds = new Set<string>();
/** Non-forced closes in flight per document (a second Ctrl+W while the first one flushes/prompts is ignored). */
const closing = new Map<string, Promise<void>>();

/** Adds (or refreshes) a document reported by an `opened` event and makes it the active tab. */
export function showDocument(doc: DocumentDescriptor): void {
  closedDocIds.delete(doc.docId);
  upsertDocument(doc);
  activateDocument(doc.docId);
}

/** Records a document the main process reported `closed`. */
export function noteDocumentClosed(docId: string): void {
  closedDocIds.delete(docId);
  closedDocIds.add(docId);
  if (closedDocIds.size > CLOSED_MEMORY) {
    const oldest = closedDocIds.values().next().value;
    if (oldest !== undefined) closedDocIds.delete(oldest);
  }
}

/** Whether the main process reported this document closed. */
export function wasDocumentClosed(docId: string): boolean {
  return closedDocIds.has(docId);
}

/** Test helper. */
export function resetDocumentTracking(): void {
  closedDocIds.clear();
  closing.clear();
}

/**
 * Shows the document an open/create/restore request returned. Its `opened`/`updated` events have already
 * delivered its current state, which the (older) result must not overwrite, and a document closed meanwhile
 * must not come back as a tab the main process no longer knows. The result is only added when no event
 * delivered the document at all.
 */
function adoptDocument(doc: DocumentDescriptor): void {
  if (!getDocument(doc.docId) && !closedDocIds.has(doc.docId)) upsertDocument(doc);
  activateDocument(doc.docId);
}

export function activateDocument(docId: string): void {
  const doc = getDocument(docId);
  if (!doc) return;
  setActiveDocId(docId);
  closeBackstage();
  // A PDF is shown by Varak itself: its keys must not go to the hidden window of the office document before it.
  if (!isOfficeKind(doc.kind)) void claimKeyboard();
  if (!hasBridge() || lastActivationSent === docId) return;
  lastActivationSent = docId;
  invoke('documents:activate', { docId }).catch(() => {
    lastActivationSent = null;
  });
}

/** Called for `activated` events from the main process (keeps the de-duplication in sync). */
export function noteActivatedByMain(docId: string): void {
  lastActivationSent = docId;
  setActiveDocId(docId);
}

export function cycleDocument(delta: 1 | -1): void {
  const { documents, activeDocId } = useApp.getState();
  if (documents.length < 2) return;
  const i = Math.max(0, documents.findIndex((d) => d.docId === activeDocId));
  const next = documents[(i + delta + documents.length) % documents.length];
  if (next) activateDocument(next.docId);
}

async function guarded<T>(fn: () => Promise<T>, errorKey: string, docId: string | null = null): Promise<T | null> {
  if (!hasBridge()) return null;
  try {
    return await fn();
  } catch (err) {
    const key = errorKeyOf(err);
    pushMessage({ kind: 'error', docId, key: key ?? errorKey, detail: key ? undefined : errorText(err) });
    return null;
  }
}

export async function createDocument(kind: ModuleKind): Promise<void> {
  const doc = await guarded(() => invoke('documents:create', { kind }), 'shell.messages.createFailed');
  if (doc) adoptDocument(doc);
}

export async function openWithDialog(kind?: ModuleKind): Promise<void> {
  const docs = await guarded(() => invoke('documents:openDialog', kind ? { kind } : {}), 'shell.messages.openFailed');
  if (!docs || docs.length === 0) return;
  // Main opens the files one after another and answers at the end with each descriptor as it was when that
  // file finished loading. The opened/updated events already delivered every document with its current state
  // (a file may have been edited or closed meanwhile), so the result only says which document to show.
  const last = docs[docs.length - 1];
  if (last) activateDocument(last.docId);
}

export async function openPath(path: string): Promise<void> {
  const existing = useApp.getState().documents.find((d) => d.path !== null && samePath(d.path, path));
  if (existing) {
    activateDocument(existing.docId);
    return;
  }
  const doc = await guarded(() => invoke('documents:open', { path }), 'shell.messages.openFailed');
  if (doc) adoptDocument(doc);
}

export async function refreshRecent(): Promise<void> {
  if (!hasBridge()) return;
  try {
    useApp.setState({ recent: await invoke('documents:recent', undefined) });
  } catch {
    // Keep the previous list.
  }
}

export async function refreshRecovery(): Promise<void> {
  if (!hasBridge()) return;
  try {
    useApp.setState({ recovery: await invoke('recovery:list', undefined) });
  } catch {
    // Keep the previous list.
  }
}

export async function saveDocument(docId: string, options?: SaveOptions): Promise<SaveResult | null> {
  const result = await guarded(() => invoke('documents:save', options ? { docId, options } : { docId }), 'shell.messages.saveFailed', docId);
  if (result) reportSaveResult(docId, result, 'save');
  return result;
}

export async function exportPdf(docId: string, options?: PdfExportOptions): Promise<SaveResult | null> {
  const result = await guarded(() => invoke('documents:exportPdf', options ? { docId, options } : { docId }), 'shell.messages.exportFailed', docId);
  if (result) reportSaveResult(docId, result, 'export');
  return result;
}

export function reportSaveResult(docId: string, result: SaveResult, what: 'save' | 'export'): void {
  switch (result.outcome) {
    case 'saved':
      if (what === 'export') pushMessage({ kind: 'success', docId, key: 'shell.messages.exported', values: { path: result.path ?? '' }, timeoutMs: 6000 });
      else pushMessage({ kind: 'success', docId, key: 'shell.messages.saved', timeoutMs: 2500, id: `saved-${docId}` });
      break;
    case 'savedCopy':
      pushMessage({ kind: 'info', docId, key: 'shell.messages.savedCopy', values: { path: result.path ?? '' }, timeoutMs: 8000 });
      break;
    case 'failed':
      pushMessage({
        kind: 'error',
        docId,
        key: result.errorKey ?? (what === 'export' ? 'shell.messages.exportFailed' : 'shell.messages.saveFailed'),
        detail: result.errorDetail,
      });
      break;
    case 'cancelled':
      break;
  }
}

export async function printDocument(docId: string): Promise<void> {
  closeBackstage();
  await guarded(() => invoke('documents:print', { docId }), 'shell.messages.printFailed', docId);
}

/**
 * Closes a document (tab x, middle click, Delete on a tab, Ctrl+W, the File menu). Pending edits that only
 * the renderer holds (PDF annotations and form fields) are pushed to the main process first, so it knows the
 * document is modified and asks to save it. `force` closes without asking (and without pushing edits).
 */
export function closeDocument(docId: string, force = false): Promise<void> {
  if (!hasBridge()) return Promise.resolve();
  if (!force) {
    const pending = closing.get(docId);
    if (pending) return pending;
  }
  const task = (async () => {
    if (!force) await flushDocument(docId, PRE_CLOSE_FLUSH_TIMEOUT_MS);
    try {
      await invoke('documents:close', force ? { docId, force } : { docId });
    } catch (err) {
      pushMessage({ kind: 'error', docId, key: errorKeyOf(err) ?? 'shell.messages.closeFailed', detail: errorText(err) });
    }
  })();
  if (force) return task;
  const tracked = task.finally(() => {
    if (closing.get(docId) === tracked) closing.delete(docId);
  });
  closing.set(docId, tracked);
  return tracked;
}

/**
 * Pushes a document's pending edits to the main process (ModuleDefinition.flush: the PDF module saves pdf.js'
 * annotation storage into the working copy). Resolves when every module is done, at the latest after
 * `timeoutMs`; never rejects (a failed push leaves the working copy as it was).
 */
export async function flushDocument(docId: string, timeoutMs?: number): Promise<void> {
  const flushes = allModules()
    .map((m) => m.flush)
    .filter((flush): flush is NonNullable<typeof flush> => flush !== undefined)
    .map((flush) => Promise.resolve().then(() => flush(docId)));
  if (flushes.length === 0) return;
  const done = Promise.allSettled(flushes).then(() => undefined);
  if (timeoutMs === undefined) return done;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([done, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Answers a `flushRequest` event: the main process is about to save, close or quit and waits until pending
 * edits are in the working copy. The acknowledgement is always sent, also when the push failed, so the main
 * process never waits for its timeout in vain.
 */
export async function answerFlushRequest(docId: string, requestId: string): Promise<void> {
  await flushDocument(docId);
  if (!hasBridge()) return;
  try {
    await invoke('documents:flushDone', { requestId });
  } catch {
    // The main process stopped waiting (timeout) or is shutting down.
  }
}

/**
 * Ends a hung or crashed document engine and reloads the document from its newest recovery snapshot
 * (documents:restartEngine). Only offered for documents in the `busy` (not responding) or `crashed` state.
 */
export async function restartEngine(docId: string): Promise<void> {
  if (!hasBridge()) return;
  try {
    await invoke('documents:restartEngine', { docId });
  } catch (err) {
    pushMessage({ kind: 'error', docId, key: errorKeyOf(err) ?? 'shell.messages.restartFailed', detail: errorText(err) });
  }
}

export async function answerPrompt(promptId: string, answer: PromptAnswer): Promise<void> {
  removePrompt(promptId);
  if (!hasBridge()) return;
  try {
    await invoke('documents:answerPrompt', { promptId, answer });
  } catch (err) {
    pushMessage({ kind: 'error', docId: null, key: 'shell.messages.promptFailed', detail: errorText(err) });
  }
}

export async function restoreRecovery(id: string): Promise<void> {
  const doc = await guarded(() => invoke('recovery:restore', { id }), 'shell.messages.recoverFailed');
  if (doc) adoptDocument(doc);
  await refreshRecovery();
}

export async function discardRecovery(id: string): Promise<void> {
  await guarded(() => invoke('recovery:discard', { id }), 'shell.messages.recoverFailed');
  await refreshRecovery();
}

/** Windows paths are case-insensitive; compare with forward/back slashes normalised. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\//g, '\\').toLocaleLowerCase('en-US');
  return norm(a) === norm(b);
}

export function fileNameOf(path: string): string {
  const m = /[^\\/]+$/.exec(path);
  return m ? m[0] : path;
}
