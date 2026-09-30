/** Engine access for office documents: command dispatch, state subscriptions and allow-listed queries. */
import { isAllowedUnoCommand, isSubscribableUnoCommand } from '@shared/commands';
import type { EngineQueries, EngineQuery } from '@shared/api/engine';
import type { UnoArg } from '@shared/engine-protocol';
import { isOfficeKind } from '@shared/modules';
import { getDocument, pushMessage } from '../state/appStore';
import { setCommandStates } from '../state/commandStore';
import { hasBridge, invoke } from './ipc';
import { noteViewFocusRequested } from './windowActivity';

export interface DispatchOptions {
  /** Give keyboard focus back to the document afterwards (default true, like Office after a ribbon click). */
  focus?: boolean;
}

export async function dispatchUno(docId: string, command: string, args?: Record<string, UnoArg>, opts: DispatchOptions = {}): Promise<boolean> {
  const doc = getDocument(docId);
  if (!doc || !isOfficeKind(doc.kind) || !hasBridge()) return false;
  if (!isAllowedUnoCommand(doc.kind, command)) {
    console.warn(`[simpaper] blocked command not in allow-list: ${command}`);
    return false;
  }
  try {
    await invoke('engine:dispatch', args ? { docId, command, args } : { docId, command });
    if (opts.focus !== false) void focusView(docId);
    return true;
  } catch (err) {
    pushMessage({ kind: 'error', docId, key: errorKeyOf(err) ?? 'shell.messages.commandFailed', detail: command, timeoutMs: 8000 });
    return false;
  }
}

export async function focusView(docId: string): Promise<void> {
  const doc = getDocument(docId);
  if (!doc || !isOfficeKind(doc.kind) || !hasBridge()) return;
  // The BrowserWindow will lose the focus to the native view: keep the title bar active.
  noteViewFocusRequested(docId);
  try {
    await invoke('view:focus', { docId });
  } catch {
    // The view may be gone (closing/crashed); nothing to focus.
  }
}

export async function queryEngine<Q extends EngineQuery>(
  docId: string,
  query: Q,
  params?: EngineQueries[Q]['params'],
): Promise<EngineQueries[Q]['result']> {
  // Pollers (status bar, formula bar) may still fire for a document that is closing, restarting or hung;
  // asking the main process then only produces handler errors or waits for a timeout.
  const doc = getDocument(docId);
  if (!doc || doc.state !== 'ready') throw new Error(`engine query ${query} skipped: document ${docId} is not ready`);
  const req = params ? { docId, query, params: params as Record<string, unknown> } : { docId, query };
  return (await invoke('engine:query', req)) as EngineQueries[Q]['result'];
}

// ------------------------------------------------------------------ subscriptions

const subscribed = new Map<string, Set<string>>();
const pending = new Map<string, Set<string>>();
let flushScheduled = false;

/**
 * Makes sure the engine streams the state of `commands` for `docId`. Calls are batched per tick and
 * de-duplicated; there is no unsubscribe channel, so the set only grows while the document is open.
 */
export function ensureSubscribed(docId: string, commands: Iterable<string>): void {
  const doc = getDocument(docId);
  if (!doc || !isOfficeKind(doc.kind) || !hasBridge()) return;
  if (doc.state !== 'ready' && doc.state !== 'busy') return;
  const have = subscribed.get(docId) ?? new Set<string>();
  subscribed.set(docId, have);
  let queue = pending.get(docId);
  for (const c of commands) {
    if (have.has(c) || !isSubscribableUnoCommand(doc.kind, c)) continue;
    have.add(c);
    if (!queue) {
      queue = new Set();
      pending.set(docId, queue);
    }
    queue.add(c);
  }
  if (queue && queue.size > 0 && !flushScheduled) {
    flushScheduled = true;
    setTimeout(flushSubscriptions, 0);
  }
}

function flushSubscriptions(): void {
  flushScheduled = false;
  const batches = [...pending.entries()];
  pending.clear();
  for (const [docId, set] of batches) {
    const commands = [...set];
    invoke('engine:subscribe', { docId, commands })
      .then((states) => setCommandStates(docId, states))
      .catch(() => {
        // Allow a later retry (e.g. the view was not ready yet).
        const have = subscribed.get(docId);
        if (have) for (const c of commands) have.delete(c);
      });
  }
}

export function forgetSubscriptions(docId: string): void {
  subscribed.delete(docId);
  pending.delete(docId);
}

/** Test helper. */
export function resetSubscriptions(): void {
  subscribed.clear();
  pending.clear();
  flushScheduled = false;
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * The main process rejects IPC calls with an i18n key as the message (e.g. "errors.save.notReady");
 * Electron prefixes it with "Error invoking remote method ...". Returns the key, if any.
 */
export function errorKeyOf(err: unknown): string | null {
  const m = /\b(errors\.[A-Za-z0-9_.]*[A-Za-z0-9])/.exec(errorText(err));
  return m?.[1] ?? null;
}
