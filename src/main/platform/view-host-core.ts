/**
 * ViewHost logic, independent of Win32 and Electron: state per document view, host-window
 * tracking, coordinate mapping and a serialized "reconcile" queue per view. Native effects go
 * through `NativeViewOps` (win32/view-ops.ts in the app, fakes in tests).
 *
 * Model: the renderer states what it wants (rect, visible, frozen); each view converges to
 *   shown = attached && ready && visible && freezeDepth == 0 && host visible && !minimized && rect non-empty
 * One native operation per view runs at a time; bursts (window drags) coalesce to the latest state.
 */
import type { CssRect } from '@shared/api/engine';
import type { ViewMode, ViewParams } from '@shared/engine-protocol';
import type { Logger } from '../log';
import {
  clientScreenRect,
  cssToClientRect,
  cssToScreenRect,
  isEmptyRect,
  isValidCssRect,
  rectsEqual,
  type HostMetrics,
  type Point,
  type Rect,
  type Size,
} from './geometry';
import { formatHwnd, parseHwnd, sameHwnd, type Hwnd } from './hwnd';

export type HostEvent =
  | 'move'
  | 'resize'
  | 'maximize'
  | 'unmaximize'
  | 'restore'
  | 'minimize'
  | 'show'
  | 'hide'
  | 'enter-full-screen'
  | 'leave-full-screen'
  | 'closed';

/** Host events after which the native views are re-placed. */
export const HOST_SYNC_EVENTS: readonly HostEvent[] = [
  'move',
  'resize',
  'maximize',
  'unmaximize',
  'restore',
  'minimize',
  'show',
  'hide',
  'enter-full-screen',
  'leave-full-screen',
];

/** The parts of a BrowserWindow the view host uses. */
export interface HostWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  nativeHandle(): Hwnd | null;
  /** webContents zoom factor. */
  zoomFactor(): number;
  /** Device scale factor Chromium uses for the window's display. */
  scaleFactor(): number;
  on(event: HostEvent, listener: () => void): void;
  off(event: HostEvent, listener: () => void): void;
  hookMessage(message: number, listener: () => void): void;
  unhookMessage(message: number): void;
}

/** Native operations. Everything that touches a LibreOffice window is async and must not block the caller. */
export interface NativeViewOps {
  /** Physical screen origin and size of the host's client area; null when unavailable. */
  clientArea(host: Hwnd): { origin: Point; size: Size } | null;
  isWindow(hwnd: Hwnd): boolean;
  /** Parent of a WS_CHILD window; null for top-level windows. */
  parentOf(hwnd: Hwnd): Hwnd | null;
  /** Turns a LibreOffice frame into a borderless popup owned by `host` (hidden afterwards). */
  makeOwned(view: Hwnd, host: Hwnd): Promise<void>;
  /**
   * Moves (when `rect` is given) and shows/hides without activating. With `above`, a window that is
   * being shown is also put directly above that window in the z-order (owned popups: setting the owner
   * afterwards does not reorder them, so they could appear behind the host). Resolves false if the
   * window is gone.
   */
  place(view: Hwnd, rect: Rect | null, visible: boolean, above?: Hwnd): Promise<boolean>;
  /** Child mode: our own intermediate container (same thread as the host, synchronous). */
  createContainer(host: Hwnd): Hwnd;
  placeContainer(container: Hwnd, rect: Rect | null, visible: boolean, raise: boolean): void;
  destroyContainer(container: Hwnd): void;
  /** Brings an owned view to the foreground (only called while the app is in the foreground). */
  activate(view: Hwnd): Promise<void>;
  foreground(): Hwnd | null;
  /** GetAncestor(GA_ROOTOWNER). */
  rootOwner(hwnd: Hwnd): Hwnd | null;
  /** PNG data URL of the window's current content, or null. */
  capture(view: Hwnd, timeoutMs: number): Promise<string | null>;
}

/** Thrown by NativeViewOps when the target window is not responding; the operation is retried later. */
export class WindowBusyError extends Error {
  constructor(message = 'window is not responding') {
    super(message);
    this.name = 'WindowBusyError';
  }
}

export interface ViewHostCoreOptions<W> {
  ops: NativeViewOps;
  adapt: (win: W) => HostWindow;
  log: Logger;
  /** Window messages that trigger a re-sync, e.g. WM_DPICHANGED and WM_WINDOWPOSCHANGED. */
  syncMessages?: readonly number[];
  /** Retry delay for busy windows and failed owned-mode conversions (default 500 ms). */
  retryDelayMs?: number;
  /** PrintWindow budget for freeze() (default 1500 ms). */
  captureTimeoutMs?: number;
  /** How long freeze() waits for the hide to be issued (default 1000 ms). */
  hideWaitMs?: number;
  /** Trailing z-order re-assert of child containers after resize bursts (default 150 ms). */
  zOrderSettleMs?: number;
}

interface PlacedState {
  rect: Rect | null;
  shown: boolean;
}

interface HostRecord<W> {
  win: W;
  window: HostWindow;
  hwnd: Hwnd;
  views: Map<string, ViewRecord<W>>;
  container: Hwnd | null;
  containerApplied: PlacedState | null;
  /** Child view whose rect the container follows (last one given bounds or made visible). */
  activeChild: ViewRecord<W> | null;
  unsubscribe: (() => void) | null;
  zTimer: ReturnType<typeof setTimeout> | null;
}

interface ViewRecord<W> {
  docId: string;
  host: HostRecord<W>;
  hwnd: Hwnd;
  mode: 'owned' | 'child';
  /** Child mode: the LibreOffice window is a child of our container (otherwise of the host itself). */
  inContainer: boolean;
  css: CssRect | null;
  visible: boolean;
  freezeDepth: number;
  frozenImage: string | null;
  /** Owned mode: the popup conversion finished. */
  ready: boolean;
  /** Detached or the window disappeared. */
  dead: boolean;
  applied: PlacedState | null;
  tail: Promise<void>;
  drainQueued: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const MAX_PENDING = 64;
const MAX_CONVERT_ATTEMPTS = 3;
const noop = (): void => undefined;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Waits for `promise`, but at most `ms`; the timer is cleared either way. */
async function waitAtMost(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const TIMED_OUT = Symbol('timed out');

/** The value of `promise`, or TIMED_OUT after `ms` (the promise keeps running; its late result is dropped). */
async function valueWithin<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<typeof TIMED_OUT>((resolve) => (timer = setTimeout(() => resolve(TIMED_OUT), ms)))]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class ViewHostCore<W extends object> {
  readonly supported = true;
  private readonly hosts = new Map<W, HostRecord<W>>();
  private readonly views = new Map<string, ViewRecord<W>>();
  /** setBounds/setVisible received before attach (the renderer may measure before the load finishes). */
  private readonly pending = new Map<string, { css?: CssRect; visible?: boolean }>();
  /**
   * Visibility of detached views: an engine restart re-attaches a document's new window while the renderer's
   * visibility for it did not change (and is not sent again), e.g. a background tab stays hidden.
   */
  private readonly lastVisible = new Map<string, boolean>();
  private readonly ops: NativeViewOps;
  private readonly log: Logger;
  private readonly retryDelayMs: number;
  private readonly captureTimeoutMs: number;
  private readonly hideWaitMs: number;
  private readonly zOrderSettleMs: number;
  private disposed = false;

  constructor(private readonly options: ViewHostCoreOptions<W>) {
    this.ops = options.ops;
    this.log = options.log;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.captureTimeoutMs = options.captureTimeoutMs ?? 1500;
    this.hideWaitMs = options.hideWaitMs ?? 1000;
    this.zOrderSettleMs = options.zOrderSettleMs ?? 150;
  }

  viewParamsFor(win: W, mode: ViewMode, cssRect?: CssRect): ViewParams {
    this.assertAlive();
    if (mode === 'hidden') return { mode: 'hidden' };
    if (cssRect !== undefined && !isValidCssRect(cssRect)) throw new TypeError('viewParamsFor: invalid rect');
    if (mode === 'owned') {
      const window = this.hosts.get(win)?.window ?? this.adapt(win);
      const hwnd = this.requireHandle(window);
      const m = this.metricsOf(window, hwnd);
      const bounds = m ? (cssRect ? cssToScreenRect(cssRect, m) : clientScreenRect(m)) : null;
      // `bounds` is a hint: the frame should be created hidden; attach() positions it.
      return bounds && !isEmptyRect(bounds) ? { mode, parentHwnd: formatHwnd(hwnd), bounds } : { mode, parentHwnd: formatHwnd(hwnd) };
    }
    const host = this.ensureHost(win);
    if (!host.container || !this.ops.isWindow(host.container)) {
      host.container = this.ops.createContainer(host.hwnd);
      host.containerApplied = null;
    }
    const m = this.metrics(host);
    const client = m ? (cssRect ? cssToClientRect(cssRect, m) : { x: 0, y: 0, ...m.clientSize }) : { x: 0, y: 0, width: 0, height: 0 };
    if (!host.containerApplied?.shown) {
      // Pre-size the hidden container so LibreOffice lays out at the final size.
      this.ops.placeContainer(host.container, client, false, false);
      host.containerApplied = { rect: client, shown: false };
    }
    return { mode, parentHwnd: formatHwnd(host.container), bounds: { x: 0, y: 0, width: client.width, height: client.height } };
  }

  attach(docId: string, win: W, nativeHwnd: string, mode: ViewMode): void {
    this.assertAlive();
    if (mode === 'hidden') {
      this.detach(docId);
      return;
    }
    const hwnd = parseHwnd(nativeHwnd);
    if (hwnd === null) throw new TypeError(`attach: invalid window handle "${nativeHwnd}"`);
    if (!this.ops.isWindow(hwnd)) throw new Error(`attach: window ${formatHwnd(hwnd)} does not exist`);
    const host = this.ensureHost(win);
    const pending = this.pending.get(docId);
    const previous = this.views.get(docId)?.visible;
    this.detach(docId); // re-attach replaces the previous record
    // Last requested visibility: before attach, of the replaced view, or of the view detached earlier.
    const visible = pending?.visible ?? previous ?? this.lastVisible.get(docId) ?? true;
    this.lastVisible.delete(docId);
    let inContainer = false;
    if (mode === 'child') {
      const parent = this.ops.parentOf(hwnd);
      inContainer = host.container !== null && sameHwnd(parent, host.container);
      if (!inContainer && !sameHwnd(parent, host.hwnd)) {
        this.log.warn('Child view is not parented to the host window or its container', { docId, hwnd: formatHwnd(hwnd) });
      }
    }
    const view: ViewRecord<W> = {
      docId,
      host,
      hwnd,
      mode,
      inContainer,
      css: pending?.css ?? null,
      visible,
      freezeDepth: 0,
      frozenImage: null,
      ready: mode === 'child',
      dead: false,
      applied: null,
      tail: Promise.resolve(),
      drainQueued: false,
      timer: null,
    };
    host.views.set(docId, view);
    this.views.set(docId, view);
    this.log.debug('View attached', { docId, mode, hwnd: formatHwnd(hwnd) });
    if (mode === 'child') {
      if (view.css) host.activeChild = view;
      this.schedule(view);
    } else {
      this.convert(view, 1);
    }
  }

  setBounds(docId: string, cssRect: CssRect): void {
    if (this.disposed) return;
    if (!isValidCssRect(cssRect)) {
      this.log.warn('setBounds: invalid rect ignored', { docId });
      return;
    }
    const css = { x: cssRect.x, y: cssRect.y, width: cssRect.width, height: cssRect.height };
    const view = this.views.get(docId);
    if (!view) {
      this.remember(docId, { css });
      return;
    }
    view.css = css;
    if (view.mode === 'child') view.host.activeChild = view;
    this.schedule(view);
  }

  setVisible(docId: string, visible: boolean): void {
    if (this.disposed) return;
    if (typeof visible !== 'boolean') {
      this.log.warn('setVisible: invalid value ignored', { docId });
      return;
    }
    const view = this.views.get(docId);
    if (!view) {
      this.remember(docId, { visible });
      return;
    }
    view.visible = visible;
    if (visible && view.mode === 'child') view.host.activeChild = view;
    this.schedule(view);
  }

  /**
   * Owned mode: activates the LibreOffice window, but only while the app is in the foreground
   * (Windows' foreground lock; we never steal focus from another app). Child mode: nothing native
   * to do; keyboard focus inside LibreOffice is set by the engine (`view.focus`).
   */
  focus(docId: string): void {
    const view = this.views.get(docId);
    if (!view || view.dead || view.mode !== 'owned' || view.applied?.shown !== true) return;
    if (!this.isForeground(view.host.win)) return;
    void this.enqueue(view, () => this.ops.activate(view.hwnd)).catch((err: unknown) => {
      this.log.debug('focus: activation failed', { docId, error: message(err) });
    });
  }

  async freeze(docId: string): Promise<string | null> {
    const view = this.views.get(docId);
    if (!view || view.dead) return null;
    view.freezeDepth += 1;
    if (view.freezeDepth > 1) return view.frozenImage;
    let image: string | null = null;
    if (view.applied?.shown) {
      const captured = this.enqueue(view, () => this.ops.capture(view.hwnd, this.captureTimeoutMs)).catch((err: unknown) => {
        this.log.warn('freeze: capture failed', { docId, error: message(err) });
        return null;
      });
      // The capture queues behind the view's native operations; one that blocks (an engine that stopped pumping
      // messages but is not "hung" yet) must not keep the renderer's view:freeze waiting: no image then.
      const result = await valueWithin(captured, this.captureTimeoutMs + this.hideWaitMs);
      if (result === TIMED_OUT) this.log.warn('freeze: the view is busy; frozen without an image', { docId });
      else image = result;
    }
    if (view.freezeDepth > 0) view.frozenImage = image;
    this.schedule(view);
    // Resolve once the hide has been issued, but never hang the renderer on a busy engine.
    await waitAtMost(view.tail, this.hideWaitMs);
    return image;
  }

  unfreeze(docId: string): void {
    const view = this.views.get(docId);
    if (!view || view.freezeDepth === 0) return;
    view.freezeDepth -= 1;
    if (view.freezeDepth === 0) {
      view.frozenImage = null;
      this.schedule(view);
    }
  }

  detach(docId: string): void {
    this.pending.delete(docId);
    const view = this.views.get(docId);
    if (!view) return;
    this.rememberVisibility(docId, view.visible);
    this.views.delete(docId);
    view.host.views.delete(docId);
    view.dead = true;
    if (view.timer) clearTimeout(view.timer);
    view.timer = null;
    const host = view.host;
    if (host.activeChild === view) host.activeChild = null;
    if (view.mode === 'child' && view.inContainer) this.syncContainer(host, false);
    // Hide it (the engine closes the window later); queued behind any operation still in flight.
    if (view.applied?.shown !== false) {
      void this.enqueue(view, () => this.ops.place(view.hwnd, null, false)).catch(noop);
    }
    this.log.debug('View detached', { docId });
  }

  syncAll(win: W): void {
    const host = this.hosts.get(win);
    if (host) this.syncHost(host, true);
  }

  dispose(): void {
    if (this.disposed) return;
    for (const host of [...this.hosts.values()]) {
      for (const view of [...host.views.values()]) this.detach(view.docId);
      this.releaseHost(host);
      if (host.container && !host.window.isDestroyed()) this.ops.destroyContainer(host.container);
    }
    this.hosts.clear();
    this.views.clear();
    this.pending.clear();
    this.lastVisible.clear();
    this.disposed = true;
  }

  isForeground(win: W): boolean {
    const hwnd = this.hostHandle(win);
    const fg = this.ops.foreground();
    if (hwnd === null || fg === null) return false;
    return this.ownsForeground(win, fg) || sameHwnd(this.ops.rootOwner(fg), hwnd);
  }

  /** True when `hwnd` is `win` itself or one of the native views attached to it (not their dialogs). */
  ownsForeground(win: W, hwnd: Hwnd): boolean {
    const host = this.hosts.get(win);
    if (host) return sameHwnd(host.hwnd, hwnd) || [...host.views.values()].some((v) => sameHwnd(v.hwnd, hwnd));
    return sameHwnd(this.hostHandle(win), hwnd);
  }

  // ---------------------------------------------------------------------------------------------

  private adapt(win: W): HostWindow {
    return this.options.adapt(win);
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('ViewHost has been disposed');
  }

  private requireHandle(window: HostWindow): Hwnd {
    if (window.isDestroyed()) throw new Error('ViewHost: the window has been destroyed');
    const hwnd = window.nativeHandle();
    if (hwnd === null) throw new Error('ViewHost: the window has no native handle');
    return hwnd;
  }

  private hostHandle(win: W): Hwnd | null {
    const host = this.hosts.get(win);
    if (host) return host.window.isDestroyed() ? null : host.hwnd;
    const window = this.adapt(win);
    return window.isDestroyed() ? null : window.nativeHandle();
  }

  private remember(docId: string, patch: { css?: CssRect; visible?: boolean }): void {
    this.pending.set(docId, { ...this.pending.get(docId), ...patch });
    if (this.pending.size > MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
  }

  private rememberVisibility(docId: string, visible: boolean): void {
    this.lastVisible.delete(docId);
    this.lastVisible.set(docId, visible);
    if (this.lastVisible.size > MAX_PENDING) {
      const oldest = this.lastVisible.keys().next().value;
      if (oldest !== undefined) this.lastVisible.delete(oldest);
    }
  }

  private ensureHost(win: W): HostRecord<W> {
    const existing = this.hosts.get(win);
    if (existing) return existing;
    const window = this.adapt(win);
    const hwnd = this.requireHandle(window);
    const host: HostRecord<W> = {
      win,
      window,
      hwnd,
      views: new Map(),
      container: null,
      containerApplied: null,
      activeChild: null,
      unsubscribe: null,
      zTimer: null,
    };
    this.hosts.set(win, host);
    this.subscribe(host);
    return host;
  }

  private subscribe(host: HostRecord<W>): void {
    const sync = (): void => this.syncHost(host, true);
    // A plain move never resizes Chromium's legacy window, so no z-order re-assert is needed.
    const move = (): void => this.syncHost(host, false);
    const closed = (): void => this.dropHost(host);
    const listeners = HOST_SYNC_EVENTS.map((event) => [event, event === 'move' ? move : sync] as const);
    for (const [event, listener] of listeners) host.window.on(event, listener);
    host.window.on('closed', closed);
    const messages = this.options.syncMessages ?? [];
    for (const msg of messages) host.window.hookMessage(msg, sync);
    host.unsubscribe = () => {
      for (const [event, listener] of listeners) host.window.off(event, listener);
      host.window.off('closed', closed);
      if (!host.window.isDestroyed()) for (const msg of messages) host.window.unhookMessage(msg);
    };
  }

  private releaseHost(host: HostRecord<W>): void {
    host.unsubscribe?.();
    host.unsubscribe = null;
    if (host.zTimer) clearTimeout(host.zTimer);
    host.zTimer = null;
  }

  /** The window was destroyed: Windows un-owns (does not destroy) cross-process owned windows, so hide them. */
  private dropHost(host: HostRecord<W>): void {
    host.container = null; // already destroyed together with the host window
    for (const view of [...host.views.values()]) this.detach(view.docId);
    this.releaseHost(host);
    this.hosts.delete(host.win);
  }

  private syncHost(host: HostRecord<W>, raise: boolean): void {
    if (host.window.isDestroyed()) return;
    if (host.container && host.containerApplied?.shown) {
      // Chromium re-raises its legacy window whenever it is resized; re-assert our z-order now and
      // once more after the burst settles.
      this.syncContainer(host, raise);
      if (raise) this.scheduleZOrder(host);
    }
    for (const view of host.views.values()) this.schedule(view);
  }

  private scheduleZOrder(host: HostRecord<W>): void {
    if (host.zTimer) clearTimeout(host.zTimer);
    host.zTimer = setTimeout(() => {
      host.zTimer = null;
      if (!host.window.isDestroyed()) this.syncContainer(host, true);
    }, this.zOrderSettleMs);
  }

  private metricsOf(window: HostWindow, hwnd: Hwnd): HostMetrics | null {
    if (window.isDestroyed()) return null;
    const area = this.ops.clientArea(hwnd);
    if (!area) return null;
    return { clientOrigin: area.origin, clientSize: area.size, scaleFactor: window.scaleFactor(), zoomFactor: window.zoomFactor() };
  }

  private metrics(host: HostRecord<W>): HostMetrics | null {
    return this.metricsOf(host.window, host.hwnd);
  }

  private hostShown(host: HostRecord<W>): boolean {
    const w = host.window;
    return !w.isDestroyed() && w.isVisible() && !w.isMinimized();
  }

  /** Desired native state of a view; `rect` is null whenever the view is hidden. */
  private target(view: ViewRecord<W>): PlacedState {
    if (view.dead || !view.ready || !view.visible || view.freezeDepth > 0 || !view.css) return { rect: null, shown: false };
    const m = this.hostShown(view.host) ? this.metrics(view.host) : null;
    if (!m) return { rect: null, shown: false };
    let rect: Rect;
    if (view.mode === 'owned') {
      rect = cssToScreenRect(view.css, m);
    } else {
      const client = cssToClientRect(view.css, m);
      rect = view.inContainer ? { x: 0, y: 0, width: client.width, height: client.height } : client;
    }
    return isEmptyRect(rect) ? { rect: null, shown: false } : { rect, shown: true };
  }

  private containerTarget(host: HostRecord<W>): PlacedState {
    const candidates = [...host.views.values()].filter((v) => v.mode === 'child' && v.inContainer && v.css);
    const active = host.activeChild && candidates.includes(host.activeChild) ? host.activeChild : null;
    const shownView = [active, ...candidates].find((v): v is ViewRecord<W> => v !== null && this.target(v).shown);
    if (!shownView?.css) return { rect: null, shown: false };
    const m = this.metrics(host);
    return m ? { rect: cssToClientRect(shownView.css, m), shown: true } : { rect: null, shown: false };
  }

  private syncContainer(host: HostRecord<W>, raise: boolean): void {
    if (!host.container) return;
    const t = this.containerTarget(host);
    const a = host.containerApplied;
    const unchanged = a !== null && a.shown === t.shown && (!t.shown || rectsEqual(a.rect, t.rect));
    if (unchanged && !(raise && t.shown)) return;
    try {
      this.ops.placeContainer(host.container, t.rect, t.shown, t.shown);
      host.containerApplied = t.shown ? t : { rect: a?.rect ?? null, shown: false };
    } catch (err) {
      this.log.warn('Could not place the view container', { error: message(err) });
      host.containerApplied = null;
    }
  }

  private enqueue<T>(view: ViewRecord<W>, op: () => Promise<T>): Promise<T> {
    const run = view.tail.then(op);
    view.tail = run.then(noop, noop);
    return run;
  }

  private schedule(view: ViewRecord<W>): void {
    if (view.dead || view.drainQueued) return;
    view.drainQueued = true;
    this.enqueue(view, async () => {
      view.drainQueued = false;
      await this.reconcile(view);
    }).catch((err: unknown) => {
      view.applied = null;
      this.log.error('Native view update failed', { docId: view.docId, error: message(err) });
    });
  }

  private async reconcile(view: ViewRecord<W>): Promise<void> {
    if (view.dead || !view.ready) return;
    const t = this.target(view);
    const a = view.applied;
    const inContainer = view.mode === 'child' && view.inContainer;
    if (a && a.shown === t.shown && (!t.shown || rectsEqual(a.rect, t.rect))) {
      if (inContainer) this.syncContainer(view.host, false);
      return;
    }
    // Container before the LibreOffice child when hiding/resizing (no background flash, instant
    // hide), after it when the child is about to appear.
    const appearing = t.shown && a?.shown !== true;
    if (inContainer && !appearing) this.syncContainer(view.host, false);
    try {
      const above = view.mode === 'owned' && appearing ? view.host.hwnd : undefined;
      const alive = await this.ops.place(view.hwnd, t.rect, t.shown, above);
      if (!alive) {
        this.markDead(view);
        return;
      }
      view.applied = t;
    } catch (err) {
      view.applied = null;
      if (err instanceof WindowBusyError) this.retryLater(view);
      else this.log.warn('Could not place native view', { docId: view.docId, error: message(err) });
      return;
    }
    if (inContainer && appearing) this.syncContainer(view.host, false);
  }

  private convert(view: ViewRecord<W>, attempt: number): void {
    void this.enqueue(view, () => this.ops.makeOwned(view.hwnd, view.host.hwnd)).then(
      () => {
        if (view.dead) return;
        view.ready = true;
        this.schedule(view);
      },
      (err: unknown) => {
        if (view.dead) return;
        if (!this.ops.isWindow(view.hwnd)) {
          this.markDead(view);
          return;
        }
        if (attempt >= MAX_CONVERT_ATTEMPTS) {
          this.log.error('Could not attach the native view as an owned window', { docId: view.docId, error: message(err) });
          return;
        }
        view.timer = setTimeout(() => {
          view.timer = null;
          if (!view.dead) this.convert(view, attempt + 1);
        }, this.retryDelayMs);
      },
    );
  }

  private retryLater(view: ViewRecord<W>): void {
    if (view.timer || view.dead) return;
    view.timer = setTimeout(() => {
      view.timer = null;
      this.schedule(view);
    }, this.retryDelayMs);
  }

  private markDead(view: ViewRecord<W>): void {
    if (view.dead) return;
    view.dead = true;
    this.log.warn('Native view window is gone', { docId: view.docId });
    if (view.mode === 'child' && view.inContainer) this.syncContainer(view.host, false);
  }
}
