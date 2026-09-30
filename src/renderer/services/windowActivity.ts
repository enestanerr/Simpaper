/**
 * Active/inactive look of the title bar.
 *
 * In the default `owned` hosting mode LibreOffice's editing view is a separate top-level window, so the
 * BrowserWindow reports `blur` while the user works in a document (docs/dev/platform.md, "Active look").
 *
 * - When the main process reports `WindowState.active` (focused, or the foreground window is one of its
 *   native document windows — `viewHost.isForeground`), that value decides.
 * - Otherwise the shell keeps the title bar active while the window itself is focused, or while a native
 *   document view of the active office document most likely has the focus: the shell handed the keyboard
 *   to it (`view:focus`) shortly before the window lost the focus, or the document reported activity
 *   (command state, context, selection, keys) while the window was blurred. Returning to the window resets
 *   the guess. Known gap of this fallback: switching from a document view straight to another application
 *   is not observable, so the title bar stays active until Simpaper regains and loses the focus.
 */
import { create } from 'zustand';
import type { WindowState } from '@shared/api/app';
import { isOfficeKind } from '@shared/modules';
import { getActiveDocument, useApp } from '../state/appStore';

/** A window blur this soon after the shell handed the keyboard to a document view is the view taking it. */
export const VIEW_FOCUS_GRACE_MS = 1500;

export interface WindowActivityState {
  /** The BrowserWindow has the focus (HTML UI). */
  windowFocused: boolean;
  /** Fallback guess: a native document view of this window has the focus. */
  viewFocused: boolean;
  /** `WindowState.active` as last reported by the main process; null while it reports none. */
  reportedActive: boolean | null;
}

const INITIAL: WindowActivityState = { windowFocused: true, viewFocused: false, reportedActive: null };

export const useWindowActivity = create<WindowActivityState>()(() => ({ ...INITIAL }));

let viewFocusRequestedAt = Number.NEGATIVE_INFINITY;
let clock: () => number = () => Date.now();

/** The office document whose native view is shown in this window, if any. */
function liveOfficeDocId(): string | null {
  if (useApp.getState().backstage.open) return null;
  const doc = getActiveDocument();
  if (!doc || !isOfficeKind(doc.kind) || (doc.state !== 'ready' && doc.state !== 'busy')) return null;
  return doc.docId;
}

/** The shell asked the main process to focus the native view of `docId` (ribbon command, Esc, F6, click). */
export function noteViewFocusRequested(docId: string): void {
  if (liveOfficeDocId() !== docId) return;
  viewFocusRequestedAt = clock();
  const s = useWindowActivity.getState();
  if (!s.windowFocused && !s.viewFocused) useWindowActivity.setState({ viewFocused: true });
}

/** Focus changes of the BrowserWindow itself (DOM focus/blur events, `app:windowState.focused`). */
export function noteWindowFocus(focused: boolean): void {
  const s = useWindowActivity.getState();
  if (focused) {
    // A focused window is always active, whatever the main process reported before.
    if (!s.windowFocused || s.viewFocused || s.reportedActive === false) {
      useWindowActivity.setState({ windowFocused: true, viewFocused: false, reportedActive: s.reportedActive === null ? null : true });
    }
    return;
  }
  // A second report of the same blur (DOM event, then IPC) keeps what is known about the view.
  if (!s.windowFocused) return;
  const handedToView = clock() - viewFocusRequestedAt <= VIEW_FOCUS_GRACE_MS && liveOfficeDocId() !== null;
  useWindowActivity.setState({ windowFocused: false, viewFocused: handedToView });
}

/** A window state reported by the main process (initial `app:window:state`, `app:windowState` events). */
export function noteWindowState(state: WindowState): void {
  noteWindowFocus(state.focused);
  if (typeof state.active === 'boolean') useWindowActivity.setState({ reportedActive: state.active || state.focused });
}

/** Engine activity of a document (state/context/selection events, keys pressed in the view). */
export function noteDocumentActivity(docId: string): void {
  const s = useWindowActivity.getState();
  if (s.windowFocused || s.viewFocused) return;
  if (liveOfficeDocId() === docId) useWindowActivity.setState({ viewFocused: true });
}

export function isAppActive(s: WindowActivityState = useWindowActivity.getState()): boolean {
  return s.reportedActive ?? (s.windowFocused || s.viewFocused);
}

/** True while the title bar should look active. */
export function useAppActive(): boolean {
  return useWindowActivity(isAppActive);
}

/** Follows the DOM focus/blur events of the window (immediate; `app:windowState` confirms them later). */
export function trackWindowFocus(target: Window = window): () => void {
  const onFocus = () => noteWindowFocus(true);
  const onBlur = () => noteWindowFocus(false);
  target.addEventListener('focus', onFocus);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('focus', onFocus);
    target.removeEventListener('blur', onBlur);
  };
}

/** Test helper: resets the state and optionally replaces the clock. */
export function resetWindowActivity(options: { windowFocused?: boolean; clock?: () => number } = {}): void {
  viewFocusRequestedAt = Number.NEGATIVE_INFINITY;
  clock = options.clock ?? (() => Date.now());
  useWindowActivity.setState({ ...INITIAL, windowFocused: options.windowFocused ?? true }, true);
}
