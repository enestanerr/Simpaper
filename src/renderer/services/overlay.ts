/**
 * Airspace manager. HTML can never paint over the native LibreOffice window, so anything that may
 * overlap the document area (menus, galleries, ScreenTips, dialogs) acquires the overlay: the office
 * document whose native view is shown is frozen (view:freeze → snapshot shown by DocumentSurface, native
 * window hidden) and unfrozen when the last holder releases it. Releases are debounced so moving between
 * menus/tooltips does not flicker.
 *
 * The freeze follows the shown document: when another document is activated, the backstage opens or the
 * document stops being shown, the old view is unfrozen at once and — while holders remain — the newly
 * shown view is frozen. Modal dialogs hold the overlay persistently, so a window blur or a LibreOffice
 * dialog (releaseAllOverlays) never uncovers the document behind an open prompt.
 */
import type { DocumentDescriptor } from '@shared/api/documents';
import { isOfficeKind } from '@shared/modules';
import { getActiveDocument, getDocument, useApp } from '../state/appStore';
import { clearFrozen, getSurface, setFrozen } from '../state/viewStore';
import { hasBridge, invoke } from './ipc';

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AcquireOptions {
  /**
   * Long-lived holder (a modal dialog): it survives releaseAllOverlays() (window blur, LibreOffice dialog),
   * which drops only the transient holders — menus, galleries and ScreenTips close themselves then.
   */
  persistent?: boolean;
}

const RELEASE_GRACE_MS = 150;
/** Longest time a popup waits for the freeze-frame before it is painted anyway (hung or slow engine). */
export const REVEAL_TIMEOUT_MS = 250;

interface Holder {
  readonly persistent: boolean;
}

const holders = new Set<Holder>();
/** The document main was asked to freeze (view:freeze sent, view:unfreeze not yet). */
let frozenDocId: string | null = null;
/** The pending view:freeze of `frozenDocId`; settles when the snapshot arrived (or the capture failed). */
let freezing: Promise<void> | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped by resetOverlay(): continuations started before a reset do nothing. */
let generation = 0;

export function rectsIntersect(a: RectLike, b: RectLike): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * The office document whose native view is displayed: the active tab, no backstage, engine `ready` or
 * `busy` (not responding — its window stays on screen), as OfficeWorkspace shows it.
 */
function shownNativeDocument(): DocumentDescriptor | null {
  if (useApp.getState().backstage.open) return null;
  const doc = getActiveDocument();
  if (!doc || !isOfficeKind(doc.kind) || (doc.state !== 'ready' && doc.state !== 'busy')) return null;
  return doc;
}

/** Whether a popup with this rect (viewport CSS pixels) would be hidden behind the native view. */
export function overlapsNativeView(rect: RectLike | null | undefined): boolean {
  // Measure the view that is shown now: the surface of a document that is no longer shown sits in a
  // `hidden` slot whose rect is empty.
  const docId = shownNativeDocument()?.docId ?? frozenDocId;
  if (!docId) return false;
  if (!rect) return true;
  const el = getSurface(docId);
  if (!el) return false;
  return rectsIntersect(rect, el.getBoundingClientRect());
}

/**
 * Acquires the overlay if `rect` overlaps the native view. Without a rect (a dialog scrim covering the
 * window) the overlay is held even while no native view is shown, so a view that appears while the dialog
 * is open (document activated, backstage closed, engine restored) is frozen as well.
 * Returns the release function; calling it more than once is harmless.
 */
export function acquireOverlay(rect?: RectLike | null, options: AcquireOptions = {}): () => void {
  if (!hasBridge() || (rect && !overlapsNativeView(rect))) return () => {};
  const holder: Holder = { persistent: options.persistent === true };
  holders.add(holder);
  cancelRelease();
  retarget();
  return () => {
    if (!holders.delete(holder)) return; // released already, or dropped by releaseAllOverlays()
    if (holders.size === 0) scheduleRelease();
  };
}

/**
 * Keeps the freeze on the office document whose native view is shown. A frozen view that is no longer
 * shown (another document activated, backstage opened, document crashed or closing) is unfrozen at once —
 * not after the grace period — and while holders remain the shown view is frozen. A document whose engine
 * does not respond is not asked for a capture, but a freeze it already has is kept.
 */
function retarget(): void {
  const shown = shownNativeDocument();
  if (frozenDocId !== null && frozenDocId !== shown?.docId) dropFreeze();
  if (frozenDocId === null && holders.size > 0 && shown?.state === 'ready' && hasBridge()) freeze(shown.docId);
}

function freeze(docId: string): void {
  frozenDocId = docId;
  setFrozen(docId, null);
  const gen = generation;
  const capture: Promise<void> = invoke('view:freeze', { docId }).then(
    (snapshot) => {
      if (gen === generation && frozenDocId === docId) setFrozen(docId, snapshot);
    },
    () => {
      // No snapshot: the placeholder stays blank while the popup is open.
    },
  );
  freezing = capture;
  void capture.then(() => {
    if (freezing === capture) freezing = null;
  });
}

/** Unfreezes the frozen view now because it is no longer shown. */
function dropFreeze(): void {
  const docId = frozenDocId;
  if (docId === null) return;
  const capture = freezing;
  frozenDocId = null;
  freezing = null;
  cancelRelease();
  clearFrozen(docId);
  void sendUnfreeze(docId, capture, true);
}

/** Unfreezes after the grace period, unless a popup was opened again meanwhile. */
async function unfreeze(): Promise<void> {
  const docId = frozenDocId;
  if (!docId) return;
  const capture = freezing;
  if (capture) await capture;
  if (holders.size > 0 || frozenDocId !== docId) return; // held again, or the freeze moved to another view
  frozenDocId = null;
  if (freezing === capture) freezing = null;
  clearFrozen(docId);
  await sendUnfreeze(docId, null, false);
}

async function sendUnfreeze(docId: string, capture: Promise<void> | null, hidden: boolean): Promise<void> {
  const gen = generation;
  // The view host counts freezes per view: an unfreeze must not overtake the freeze it balances.
  if (capture) await capture;
  // A view that stopped being shown: let its hide (view:setVisible, documents:activate) reach the main
  // process first, so the view does not flash up for a moment.
  if (hidden) await new Promise((resolve) => setTimeout(resolve, 0));
  if (gen !== generation || !hasBridge() || !getDocument(docId)) return;
  try {
    await invoke('view:unfreeze', { docId });
  } catch {
    // The document may have been closed meanwhile.
  }
}

function scheduleRelease(): void {
  cancelRelease();
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (holders.size === 0) void unfreeze();
  }, RELEASE_GRACE_MS);
}

function cancelRelease(): void {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
}

/** True while a freeze-frame is being captured (the native view may still cover the document area). */
export function overlayPending(): boolean {
  return freezing !== null;
}

/**
 * Resolves once the pending freeze-frame is in place (the native view is hidden), immediately when none
 * is pending, and at the latest after `maxWaitMs`: popups wait for it before they are painted, so they
 * never appear half hidden behind the document window.
 */
export function whenOverlayReady(maxWaitMs = REVEAL_TIMEOUT_MS): Promise<void> {
  const pending = freezing;
  if (!pending) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, maxWaitMs);
    void pending.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Drops the transient holders at once (window blur, LibreOffice dialog) and unfreezes unless a persistent
 * holder — an open dialog — still covers the document.
 */
export function releaseAllOverlays(): void {
  for (const holder of holders) if (!holder.persistent) holders.delete(holder);
  cancelRelease();
  if (holders.size === 0) void unfreeze();
}

export function isOverlayHeld(): boolean {
  return holders.size > 0;
}

/** Test helper. */
export function resetOverlay(): void {
  generation += 1;
  holders.clear();
  frozenDocId = null;
  freezing = null;
  cancelRelease();
}

// The freeze follows the shown document (activation, backstage, document state). retarget() only acts
// when the shown document differs from the frozen one, or holders wait for a freeze.
const unsubscribe = useApp.subscribe(() => retarget());
import.meta.hot?.dispose(unsubscribe);
