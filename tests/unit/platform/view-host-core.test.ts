import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { Rect } from '../../../src/main/platform/geometry';
import { formatHwnd, type Hwnd } from '../../../src/main/platform/hwnd';
import { ViewHostCore, WindowBusyError, type HostEvent, type HostWindow, type NativeViewOps } from '../../../src/main/platform/view-host-core';
import { memoryLogger, settle, sleep } from './helpers';

const HOST = 0x0001_0010n;
const VIEW = 0x0002_0020n;
const VIEW2 = 0x0002_0030n;
const DIALOG = 0x0003_0040n;
const OTHER_APP = 0x0009_0090n;
const WM_DPICHANGED = 0x02e0;

class FakeWindow extends EventEmitter implements HostWindow {
  destroyed = false;
  minimized = false;
  visible = true;
  zoom = 1;
  scale = 1;
  readonly hooks = new Map<number, () => void>();
  isDestroyed = () => this.destroyed;
  isMinimized = () => this.minimized;
  isVisible = () => this.visible;
  nativeHandle = (): Hwnd | null => (this.destroyed ? null : HOST);
  zoomFactor = () => this.zoom;
  scaleFactor = () => this.scale;
  hookMessage = (message: number, listener: () => void) => void this.hooks.set(message, listener);
  unhookMessage = (message: number) => void this.hooks.delete(message);
  fire(event: HostEvent): void {
    this.emit(event);
  }
}

interface Placement {
  hwnd: Hwnd;
  rect: Rect | null;
  visible: boolean;
  above?: Hwnd;
}

class FakeOps implements NativeViewOps {
  readonly log: string[] = [];
  readonly windows = new Set<Hwnd>([HOST, VIEW, VIEW2, DIALOG, OTHER_APP]);
  readonly parents = new Map<Hwnd, Hwnd>();
  readonly owners = new Map<Hwnd, Hwnd>();
  readonly placements: Placement[] = [];
  readonly containerPlacements: { rect: Rect | null; visible: boolean; raise: boolean }[] = [];
  readonly activated: Hwnd[] = [];
  area = { origin: { x: 100, y: 50 }, size: { width: 1600, height: 900 } };
  foregroundWindow: Hwnd | null = HOST;
  containersCreated = 0;
  captures = 0;
  destroyed: Hwnd[] = [];
  makeOwnedFailures = 0;
  placeHook: ((p: Placement) => Promise<boolean> | boolean) | null = null;

  clientArea = () => ({ origin: { ...this.area.origin }, size: { ...this.area.size } });
  isWindow = (h: Hwnd) => this.windows.has(h);
  parentOf = (h: Hwnd) => this.parents.get(h) ?? null;
  makeOwned = async (view: Hwnd, host: Hwnd) => {
    this.log.push(`owned ${view}`);
    if (this.makeOwnedFailures > 0) {
      this.makeOwnedFailures -= 1;
      throw new Error('conversion failed');
    }
    this.owners.set(view, host);
  };
  place = async (hwnd: Hwnd, rect: Rect | null, visible: boolean, above?: Hwnd) => {
    const p: Placement = above === undefined ? { hwnd, rect, visible } : { hwnd, rect, visible, above };
    this.log.push(`place ${hwnd} ${visible ? 'show' : 'hide'}`);
    if (this.placeHook) return this.placeHook(p);
    if (!this.windows.has(hwnd)) return false;
    this.placements.push(p);
    return true;
  };
  createContainer = (host: Hwnd) => {
    this.containersCreated += 1;
    const hwnd = 0x0005_0000n + BigInt(this.containersCreated);
    this.windows.add(hwnd);
    this.parents.set(hwnd, host);
    return hwnd;
  };
  placeContainer = (_c: Hwnd, rect: Rect | null, visible: boolean, raise: boolean) => {
    this.log.push(`container ${visible ? 'show' : 'hide'}`);
    this.containerPlacements.push({ rect, visible, raise });
  };
  destroyContainer = (c: Hwnd) => void this.destroyed.push(c);
  activate = async (view: Hwnd) => void this.activated.push(view);
  foreground = () => this.foregroundWindow;
  rootOwner = (h: Hwnd) => {
    let cur = h;
    while (this.owners.has(cur)) cur = this.owners.get(cur)!;
    return cur;
  };
  capture = async () => {
    this.captures += 1;
    return `data:image/png;base64,capture${this.captures}`;
  };

  last(hwnd: Hwnd = VIEW): Placement | undefined {
    return [...this.placements].reverse().find((p) => p.hwnd === hwnd);
  }
}

function setup(opts: { scale?: number; zoom?: number; retryDelayMs?: number; captureTimeoutMs?: number } = {}) {
  const ops = new FakeOps();
  const win = new FakeWindow();
  win.scale = opts.scale ?? 1;
  win.zoom = opts.zoom ?? 1;
  const log = memoryLogger();
  const core = new ViewHostCore<FakeWindow>({
    ops,
    adapt: (w) => w,
    log,
    syncMessages: [WM_DPICHANGED],
    retryDelayMs: opts.retryDelayMs ?? 5,
    hideWaitMs: 50,
    zOrderSettleMs: 5,
    ...(opts.captureTimeoutMs !== undefined ? { captureTimeoutMs: opts.captureTimeoutMs } : {}),
  });
  return { ops, win, core, log };
}

const DOC = { x: 0, y: 100, width: 800, height: 600 };

describe('ViewHostCore — owned mode', () => {
  it('converts the frame, then places it at client origin + CSS rect × zoom × scale', async () => {
    const { core, ops, win } = setup({ scale: 1.25 });
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    expect(ops.owners.get(VIEW)).toBe(HOST);
    expect(ops.log[0]).toBe(`owned ${VIEW}`);
    // Appearing: also put directly above the host in the z-order.
    expect(ops.last()).toEqual({ hwnd: VIEW, rect: { x: 100, y: 175, width: 1000, height: 750 }, visible: true, above: HOST });
  });

  it('raises an owned view above its host only when it appears, not on moves', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    ops.area.origin = { x: 300, y: 300 };
    win.fire('move');
    await settle();
    expect(ops.last()).toEqual({ hwnd: VIEW, rect: { x: 300, y: 400, width: 800, height: 600 }, visible: true });
    core.setVisible('d1', false);
    core.setVisible('d1', true); // coalesced with the hide: nothing to do
    await settle();
    expect(ops.last()).toEqual({ hwnd: VIEW, rect: { x: 300, y: 400, width: 800, height: 600 }, visible: true });
    core.setVisible('d1', false);
    await settle();
    core.setVisible('d1', true);
    await settle();
    expect(ops.last()?.above).toBe(HOST);
  });

  it('applies bounds and visibility that arrived before attach', async () => {
    const { core, ops, win } = setup();
    core.setBounds('d1', DOC);
    core.setVisible('d1', false);
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    await settle();
    expect(ops.last()).toEqual({ hwnd: VIEW, rect: null, visible: false });
    core.setVisible('d1', true);
    await settle();
    expect(ops.last()).toEqual({ hwnd: VIEW, rect: { x: 100, y: 150, width: 800, height: 600 }, visible: true, above: HOST });
  });

  it('keeps the requested visibility when a document view is re-attached (engine restart)', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    core.setVisible('d1', false); // a background tab
    await settle();
    core.detach('d1');
    await settle();
    // The restarted engine's window: the renderer's visibility did not change, so it does not repeat it.
    core.attach('d1', win, formatHwnd(VIEW2), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    expect(ops.placements.filter((p) => p.hwnd === VIEW2 && p.visible)).toEqual([]);
    core.setVisible('d1', true);
    await settle();
    expect(ops.last(VIEW2)?.visible).toBe(true);

    // A shown view stays shown after a re-attach, directly or after a detach.
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    expect(ops.last(VIEW)?.visible).toBe(true);
    core.setVisible('d1', false);
    await settle();
    // Replacing a hidden view directly keeps it hidden too.
    core.attach('d1', win, formatHwnd(VIEW2), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    expect(ops.last(VIEW2)?.visible).toBe(false);
  });

  it('keeps a view without bounds hidden (the bridge may have created it visible)', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    await settle();
    expect(ops.placements).toEqual([{ hwnd: VIEW, rect: null, visible: false }]);
  });

  it('combines zoom and display scale', async () => {
    const { core, ops, win } = setup({ scale: 2, zoom: 1.5 });
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', { x: 10, y: 10, width: 100, height: 50 });
    await settle();
    expect(ops.last()?.rect).toEqual({ x: 130, y: 80, width: 300, height: 150 });
  });

  it('follows the host: move, minimize/restore, hide/show, DPI message', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    ops.area.origin = { x: 400, y: 300 };
    win.fire('move');
    await settle();
    expect(ops.last()?.rect).toEqual({ x: 400, y: 400, width: 800, height: 600 });

    win.minimized = true;
    win.fire('minimize');
    await settle();
    expect(ops.last()).toMatchObject({ rect: null, visible: false });
    win.minimized = false;
    win.fire('restore');
    await settle();
    expect(ops.last()).toMatchObject({ visible: true });

    win.visible = false;
    win.fire('hide');
    await settle();
    expect(ops.last()?.visible).toBe(false);
    win.visible = true;
    win.fire('show');
    await settle();
    expect(ops.last()?.visible).toBe(true);

    win.scale = 1.5;
    ops.area.size = { width: 2400, height: 1350 };
    win.hooks.get(WM_DPICHANGED)?.();
    await settle();
    expect(ops.last()?.rect).toEqual({ x: 400, y: 450, width: 1200, height: 900 });
  });

  it('does not re-issue identical placements', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    const count = ops.placements.length;
    for (let i = 0; i < 5; i++) win.fire('move');
    core.setBounds('d1', { ...DOC });
    core.syncAll(win);
    await settle();
    expect(ops.placements.length).toBe(count);
  });

  it('coalesces bursts while a placement is in flight (latest state wins)', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    await settle();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let inFlight = 0;
    let maxInFlight = 0;
    ops.placeHook = async (p) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate;
      ops.placements.push(p);
      inFlight -= 1;
      return true;
    };
    core.setBounds('d1', { x: 1, y: 0, width: 100, height: 100 });
    await settle(); // the first placement is now in flight (engine busy)
    for (let i = 2; i <= 20; i++) core.setBounds('d1', { x: i, y: 0, width: 100, height: 100 });
    win.fire('move');
    await settle();
    release();
    await settle();
    expect(maxInFlight).toBe(1); // strictly one native call per view at a time
    expect(ops.placements.filter((p) => p.visible).map((p) => p.rect?.x)).toEqual([101, 120]);
  });

  it('freeze captures, hides and nests; unfreeze shows again at depth 0', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    const image = await core.freeze('d1');
    expect(image).toBe('data:image/png;base64,capture1');
    expect(ops.last()?.visible).toBe(false);
    expect(await core.freeze('d1')).toBe(image); // nested popup: same image, no second capture
    expect(ops.captures).toBe(1);
    core.unfreeze('d1');
    await settle();
    expect(ops.last()?.visible).toBe(false);
    core.unfreeze('d1');
    await settle();
    expect(ops.last()?.visible).toBe(true);
    core.unfreeze('d1'); // extra unfreeze is harmless
    await settle();
    expect(ops.last()?.visible).toBe(true);
  });

  it('freeze settles even while a native call of the view blocks (an engine that stopped pumping messages)', async () => {
    const { core, ops, win, log } = setup({ captureTimeoutMs: 40 });
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    // SetWindowPos into a window whose thread does not pump: the call does not return (IsHungAppWindow is
    // still false during the first seconds, so nothing refuses it up front).
    ops.placeHook = () => new Promise<boolean>(() => undefined);
    core.setBounds('d1', { ...DOC, width: 500 });
    await settle();
    const started = Date.now();
    expect(await core.freeze('d1')).toBeNull();
    // captureTimeoutMs + hideWaitMs for the capture, hideWaitMs for the hide at most.
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(ops.captures).toBe(0);
    expect(log.entries.some((e) => e.level === 'warn' && e.message.startsWith('freeze:'))).toBe(true);
    // Nested and later freezes settle as well; unfreezing is balanced.
    expect(await core.freeze('d1')).toBeNull();
    core.unfreeze('d1');
    core.unfreeze('d1');
  });

  it('freeze returns null when nothing is shown, and for unknown documents', async () => {
    const { core, ops, win } = setup();
    expect(await core.freeze('nope')).toBeNull();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    core.setVisible('d1', false);
    await settle();
    expect(await core.freeze('d1')).toBeNull();
    expect(ops.captures).toBe(0);
    core.setVisible('d1', true); // still frozen: stays hidden
    await settle();
    expect(ops.last()?.visible).toBe(false);
    core.unfreeze('d1');
    await settle();
    expect(ops.last()?.visible).toBe(true);
  });

  it('retries a conversion that failed while the window still exists', async () => {
    const { core, ops, win } = setup({ retryDelayMs: 40 });
    ops.makeOwnedFailures = 1;
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    expect(ops.placements).toHaveLength(0);
    await sleep(80);
    await settle();
    expect(ops.log.filter((l) => l.startsWith('owned'))).toHaveLength(2);
    expect(ops.last()?.visible).toBe(true);
  });

  it('retries after a busy (hung) window and stops touching a window that is gone', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    await settle();
    let busy = true;
    ops.placeHook = (p) => {
      if (busy) {
        busy = false;
        throw new WindowBusyError();
      }
      ops.placements.push(p);
      return true;
    };
    core.setBounds('d1', DOC);
    await settle();
    await sleep(20);
    await settle();
    expect(ops.last()?.visible).toBe(true);

    ops.placeHook = null;
    ops.windows.delete(VIEW);
    core.setBounds('d1', { ...DOC, width: 500 });
    await settle();
    const before = ops.log.length;
    core.setBounds('d1', { ...DOC, width: 400 });
    win.fire('resize');
    await settle();
    expect(ops.log.length).toBe(before);
  });

  it('activates the view only while the app is in the foreground', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    ops.foregroundWindow = OTHER_APP;
    core.focus('d1');
    await settle();
    expect(ops.activated).toEqual([]);
    ops.foregroundWindow = HOST;
    core.focus('d1');
    await settle();
    expect(ops.activated).toEqual([VIEW]);
  });

  it('reports the foreground state of the host, its views and their dialogs', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    await settle();
    ops.owners.set(DIALOG, VIEW); // a LibreOffice dialog owned by the frame
    for (const [fg, foreground, owns] of [
      [HOST, true, true],
      [VIEW, true, true],
      [DIALOG, true, false],
      [OTHER_APP, false, false],
    ] as const) {
      ops.foregroundWindow = fg;
      expect(core.isForeground(win), `isForeground ${fg}`).toBe(foreground);
      expect(core.ownsForeground(win, fg), `ownsForeground ${fg}`).toBe(owns);
    }
    ops.foregroundWindow = null;
    expect(core.isForeground(win)).toBe(false);
  });

  it('hides views and releases listeners when the host window closes', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    expect(win.listenerCount('move')).toBe(1);
    expect(win.hooks.has(WM_DPICHANGED)).toBe(true);
    win.fire('closed');
    await settle();
    expect(ops.last()?.visible).toBe(false);
    expect(win.listenerCount('move')).toBe(0);
    expect(win.listenerCount('closed')).toBe(0);
    expect(win.hooks.has(WM_DPICHANGED)).toBe(false);
  });

  it('detach hides the view; later calls for that document are queued, not errors', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    core.detach('d1');
    await settle();
    expect(ops.last()?.visible).toBe(false);
    const count = ops.placements.length;
    core.setBounds('d1', DOC);
    core.focus('d1');
    core.unfreeze('d1');
    await settle();
    expect(ops.placements.length).toBe(count);
  });

  it('validates input', async () => {
    const { core, win, log, ops } = setup();
    expect(() => core.attach('d1', win, 'not-a-handle', 'owned')).toThrow(TypeError);
    expect(() => core.attach('d1', win, '12345', 'owned')).toThrow(/does not exist/);
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', { x: Number.NaN, y: 0, width: 10, height: 10 });
    core.setVisible('d1', 'yes' as unknown as boolean);
    await settle();
    expect(log.entries.filter((e) => e.level === 'warn').map((e) => e.message)).toEqual(['setBounds: invalid rect ignored', 'setVisible: invalid value ignored']);
    expect(ops.placements.every((p) => !p.visible)).toBe(true);
  });

  it('hides a view whose document area is empty or outside the client area', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    core.setBounds('d1', { x: 0, y: 0, width: 0, height: 0 });
    await settle();
    expect(ops.last()?.visible).toBe(false);
    core.setBounds('d1', { x: 5000, y: 0, width: 100, height: 100 });
    await settle();
    expect(ops.last()?.visible).toBe(false);
    core.setBounds('d1', { x: 1500, y: 800, width: 400, height: 400 });
    await settle();
    expect(ops.last()?.rect).toEqual({ x: 1600, y: 850, width: 100, height: 100 });
  });

  it('returns view parameters for the bridge', () => {
    const { core, win } = setup({ scale: 1.5 });
    expect(core.viewParamsFor(win, 'hidden')).toEqual({ mode: 'hidden' });
    // 150 %: document area y 150…1050 physical, clipped to the 900 px client height.
    expect(core.viewParamsFor(win, 'owned', DOC)).toEqual({
      mode: 'owned',
      parentHwnd: formatHwnd(HOST),
      bounds: { x: 100, y: 200, width: 1200, height: 750 },
    });
    expect(core.viewParamsFor(win, 'owned').bounds).toEqual({ x: 100, y: 50, width: 1600, height: 900 });
    expect(() => core.viewParamsFor(win, 'owned', { x: 0, y: 0, width: -1, height: 1 })).toThrow(TypeError);
  });

  it('dispose hides views, releases the host and refuses further attaches', async () => {
    const { core, ops, win } = setup();
    core.attach('d1', win, formatHwnd(VIEW), 'owned');
    core.setBounds('d1', DOC);
    await settle();
    core.dispose();
    await settle();
    expect(ops.last()?.visible).toBe(false);
    expect(win.listenerCount('resize')).toBe(0);
    expect(() => core.attach('d2', win, formatHwnd(VIEW2), 'owned')).toThrow(/disposed/);
    core.dispose(); // idempotent
  });
});

describe('ViewHostCore — child mode', () => {
  function childSetup() {
    const s = setup({ scale: 1.25 });
    const params = s.core.viewParamsFor(s.win, 'child', DOC);
    const container = BigInt(params.parentHwnd!);
    s.ops.parents.set(VIEW, container);
    s.ops.parents.set(VIEW2, container);
    return { ...s, params, container };
  }

  it('creates one hidden, pre-sized container per window and hands it out as the parent', () => {
    const { core, ops, win, params, container } = childSetup();
    expect(params).toEqual({ mode: 'child', parentHwnd: formatHwnd(container), bounds: { x: 0, y: 0, width: 1000, height: 750 } });
    expect(ops.containerPlacements).toEqual([{ rect: { x: 0, y: 125, width: 1000, height: 750 }, visible: false, raise: false }]);
    expect(core.viewParamsFor(win, 'child', DOC).parentHwnd).toBe(formatHwnd(container));
    expect(ops.containersCreated).toBe(1);
  });

  it('fills the container with the LibreOffice child and keeps the container on top', async () => {
    const { core, ops, win } = childSetup();
    core.attach('d1', win, formatHwnd(VIEW), 'child');
    core.setBounds('d1', DOC);
    await settle();
    expect(ops.last()).toEqual({ hwnd: VIEW, rect: { x: 0, y: 0, width: 1000, height: 750 }, visible: true });
    expect(ops.containerPlacements.at(-1)).toEqual({ rect: { x: 0, y: 125, width: 1000, height: 750 }, visible: true, raise: true });
    // Showing: child first, then the container (no empty container flash).
    const i = ops.log.lastIndexOf(`place ${VIEW} show`);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ops.log.indexOf('container show')).toBeGreaterThan(i);

    ops.log.length = 0;
    core.setVisible('d1', false);
    await settle();
    // Hiding: container first (instant), then the child.
    expect(ops.log.indexOf('container hide')).toBeLessThan(ops.log.indexOf(`place ${VIEW} hide`));
  });

  it('re-asserts the container z-order after resizes (Chromium re-raises its legacy window)', async () => {
    const { core, ops, win } = childSetup();
    core.attach('d1', win, formatHwnd(VIEW), 'child');
    core.setBounds('d1', DOC);
    await settle();
    const before = ops.containerPlacements.length;
    win.fire('resize');
    await settle();
    await sleep(20);
    const raises = ops.containerPlacements.slice(before).filter((c) => c.raise && c.visible);
    expect(raises.length).toBeGreaterThanOrEqual(2); // immediately and after the burst settled
  });

  it('switches between documents that share the container', async () => {
    const { core, ops, win } = childSetup();
    core.attach('d1', win, formatHwnd(VIEW), 'child');
    core.attach('d2', win, formatHwnd(VIEW2), 'child');
    core.setBounds('d1', DOC);
    core.setBounds('d2', { ...DOC, height: 400 });
    core.setVisible('d1', false);
    await settle();
    expect(ops.last(VIEW)?.visible).toBe(false);
    expect(ops.last(VIEW2)).toEqual({ hwnd: VIEW2, rect: { x: 0, y: 0, width: 1000, height: 500 }, visible: true });
    expect(ops.containerPlacements.at(-1)).toMatchObject({ rect: { x: 0, y: 125, width: 1000, height: 500 }, visible: true });
    core.detach('d2');
    await settle();
    expect(ops.containerPlacements.at(-1)?.visible).toBe(false);
  });

  it('freezes by hiding the container at once', async () => {
    const { core, ops, win } = childSetup();
    core.attach('d1', win, formatHwnd(VIEW), 'child');
    core.setBounds('d1', DOC);
    await settle();
    const image = await core.freeze('d1');
    expect(image).toMatch(/^data:image\/png/);
    expect(ops.containerPlacements.at(-1)?.visible).toBe(false);
    core.unfreeze('d1');
    await settle();
    expect(ops.containerPlacements.at(-1)?.visible).toBe(true);
  });

  it('closing the host hides the child without touching the already destroyed container', async () => {
    const { core, ops, win, log } = childSetup();
    core.attach('d1', win, formatHwnd(VIEW), 'child');
    core.setBounds('d1', DOC);
    await settle();
    const containerCalls = ops.containerPlacements.length;
    win.destroyed = true;
    win.fire('closed');
    await settle();
    expect(ops.containerPlacements.length).toBe(containerCalls);
    expect(ops.last()?.visible).toBe(false);
    expect(log.entries.filter((e) => e.level === 'warn' || e.level === 'error')).toEqual([]);
    expect(() => core.attach('d2', win, formatHwnd(VIEW2), 'child')).toThrow(/destroyed/);
  });

  it('never activates child views natively and keeps a container with children on dispose', async () => {
    const { core, ops, win, container } = childSetup();
    core.attach('d1', win, formatHwnd(VIEW), 'child');
    core.setBounds('d1', DOC);
    await settle();
    core.focus('d1');
    await settle();
    expect(ops.activated).toEqual([]);
    core.dispose();
    expect(ops.destroyed).toEqual([container]);
  });

  it('manages a child that was parented to the host directly (client coordinates)', async () => {
    const s = setup({ scale: 1.25 });
    s.ops.parents.set(VIEW, HOST);
    s.core.attach('d1', s.win, formatHwnd(VIEW), 'child');
    s.core.setBounds('d1', DOC);
    await settle();
    expect(s.ops.last()).toEqual({ hwnd: VIEW, rect: { x: 0, y: 125, width: 1000, height: 750 }, visible: true });
    expect(s.log.entries.some((e) => e.level === 'warn')).toBe(false);
  });
});
