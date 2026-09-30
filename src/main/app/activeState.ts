/**
 * `WindowState` updates for the renderer (`app:windowState`), including `active`: in `owned` mode typing in a
 * document activates the LibreOffice window, so the BrowserWindow reports `blur` although the user is still
 * working in Simpaper. `ViewHost.isForeground` tells whether the foreground window is ours (the host, one of its
 * document windows or their dialogs).
 *
 * Windows sends no event to the BrowserWindow when the foreground moves between a document window and another
 * application, so while the window is not focused and document windows exist, the foreground is re-checked
 * on a timer (GetForegroundWindow + GetAncestor: synchronous, no messages sent).
 */
import type { WindowState } from '@shared/api/app';

/** The parts of a BrowserWindow the state is computed from. */
export interface WindowStateSource {
  isDestroyed(): boolean;
  isFocused(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  isMaximized(): boolean;
  isFullScreen(): boolean;
}

/** A window whose events the tracker follows. */
export interface TrackedWindow extends WindowStateSource {
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
}

export interface ActiveStateOptions {
  win: TrackedWindow;
  /** `ViewHost.isForeground` for this window (absent on platforms without native document views). */
  isForeground?: () => boolean;
  /** Whether native document windows are attached (only then can the foreground be ours while blurred). */
  hasNativeViews: () => boolean;
  push: (state: WindowState) => void;
  /** Re-check interval while blurred and still active (default 400 ms). */
  activeIntervalMs?: number;
  /** Re-check interval while inactive with document windows open (default 1000 ms). */
  inactiveIntervalMs?: number;
}

export interface ActiveStateTracker {
  /** Current state (also used for `app:window:state`). */
  state(): WindowState;
  /** Re-evaluates now and pushes the state if it changed. */
  refresh(): void;
  stop(): void;
}

const WINDOW_EVENTS = ['focus', 'blur', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'show', 'hide', 'minimize', 'restore'] as const;

export function computeWindowState(win: WindowStateSource | null, isForeground?: () => boolean): WindowState {
  if (!win || win.isDestroyed()) return { maximized: false, fullScreen: false, focused: false, active: false };
  const focused = win.isFocused();
  let active = focused;
  if (!focused && isForeground && win.isVisible() && !win.isMinimized()) {
    try {
      active = isForeground();
    } catch {
      active = false;
    }
  }
  return { maximized: win.isMaximized(), fullScreen: win.isFullScreen(), focused, active };
}

const same = (a: WindowState | null, b: WindowState) =>
  !!a && a.maximized === b.maximized && a.fullScreen === b.fullScreen && a.focused === b.focused && a.active === b.active;

export function trackActiveState(opts: ActiveStateOptions): ActiveStateTracker {
  const { win } = opts;
  const activeInterval = opts.activeIntervalMs ?? 400;
  const inactiveInterval = opts.inactiveIntervalMs ?? 1_000;
  let last: WindowState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const settle: Array<ReturnType<typeof setTimeout>> = [];
  let stopped = false;

  const current = () => computeWindowState(win, opts.isForeground);

  const schedule = (state: WindowState) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (stopped || win.isDestroyed() || state.focused || !opts.isForeground || !opts.hasNativeViews()) return;
    if (!win.isVisible() || win.isMinimized()) return;
    timer = setTimeout(refresh, state.active ? activeInterval : inactiveInterval);
    timer.unref?.();
  };

  function refresh(): void {
    if (stopped || win.isDestroyed()) return;
    const next = current();
    if (!same(last, next)) {
      last = next;
      opts.push(next);
    }
    schedule(next);
  }

  const onEvent = () => {
    refresh();
    // Activation moves between processes in several steps; look again once it has settled.
    for (const ms of [60, 250]) {
      const t = setTimeout(() => {
        settle.splice(settle.indexOf(t), 1);
        refresh();
      }, ms);
      t.unref?.();
      settle.push(t);
    }
  };
  for (const ev of WINDOW_EVENTS) win.on(ev, onEvent);

  return {
    state: () => {
      const s = current();
      last ??= s;
      return s;
    },
    refresh,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      for (const t of settle.splice(0)) clearTimeout(t);
      if (!win.isDestroyed()) for (const ev of WINDOW_EVENTS) win.removeListener(ev, onEvent);
    },
  };
}
