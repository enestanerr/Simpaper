/**
 * takeFocusFromViews with a scripted user32 (no windows): when the host takes the keyboard back from a LibreOffice
 * child window, and when it must leave the focus alone (a LibreOffice dialog, a window that does not answer).
 */
import { describe, expect, it } from 'vitest';
import { takeFocusFromViews, type FocusApi } from '../../../src/main/platform/win32/focus';

const HOST = 100n;
const OWN_PID = 1;

interface Scene {
  focus: bigint | null;
  owner: Record<string, number>;
  children: bigint[];
  hung?: boolean;
  answers?: boolean;
  /** The focus moves to this window while the probe runs (the user clicked elsewhere). */
  focusDuringProbe?: bigint;
}

function fakeUser32(scene: Scene) {
  const log: string[] = [];
  const fn = <T extends (...args: never[]) => unknown>(impl: T) => Object.assign(impl, { async: undefined as unknown });
  const sendTimeout = Object.assign(() => 0, {
    async: (...args: unknown[]) => {
      log.push(`probe:${String(args[0])}`);
      if (scene.focusDuringProbe !== undefined) scene.focus = scene.focusDuringProbe;
      const done = args[args.length - 1] as (err: unknown, result: number) => void;
      setTimeout(() => done(null, scene.answers === false ? 0 : 1), 1);
    },
  });
  const user32 = {
    GetFocus: fn(() => scene.focus),
    SetFocus: fn((hwnd: bigint) => {
      log.push(`setFocus:${hwnd}`);
      const prev = scene.focus;
      scene.focus = hwnd;
      return prev;
    }),
    GetWindowThreadProcessId: fn((hwnd: bigint, pid: number[]) => {
      pid[0] = scene.owner[String(hwnd)] ?? 0;
      return 1;
    }),
    IsChild: fn((parent: bigint, hwnd: bigint) => parent === HOST && scene.children.includes(hwnd)),
    IsHungAppWindow: fn(() => scene.hung === true),
    SendMessageTimeoutW: sendTimeout,
  } as unknown as FocusApi;
  return { user32, log };
}

describe('takeFocusFromViews (Win32 focus between Simpaper and LibreOffice windows)', () => {
  it('takes the focus from a LibreOffice window inside the host once it answers', async () => {
    const { user32, log } = fakeUser32({ focus: 200n, owner: { '200': 42 }, children: [200n] });
    expect(await takeFocusFromViews(user32, HOST, OWN_PID)).toBe(true);
    expect(log).toEqual(['probe:200', 'setFocus:100']);
  });

  it('leaves the focus in a window of its own process, or gives it to the host when nobody has it', async () => {
    const own = fakeUser32({ focus: 300n, owner: { '300': OWN_PID }, children: [300n] });
    expect(await takeFocusFromViews(own.user32, HOST, OWN_PID)).toBe(false);
    expect(own.log).toEqual([]);
    const none = fakeUser32({ focus: null, owner: {}, children: [] });
    expect(await takeFocusFromViews(none.user32, HOST, OWN_PID)).toBe(false);
    expect(none.log).toEqual(['setFocus:100']);
  });

  it('takes it from our own view container, which gets it when the LibreOffice window that had it is hidden or destroyed', async () => {
    const { user32, log } = fakeUser32({ focus: 150n, owner: { '150': OWN_PID }, children: [150n] });
    // The document had the keyboard: it gets it back when the modal UI or popup closes.
    expect(await takeFocusFromViews(user32, HOST, OWN_PID, [150n])).toBe(true);
    expect(log).toEqual(['setFocus:100']);
  });

  it('never takes it from a LibreOffice dialog (a window outside the host)', async () => {
    const { user32, log } = fakeUser32({ focus: 400n, owner: { '400': 42 }, children: [] });
    expect(await takeFocusFromViews(user32, HOST, OWN_PID)).toBe(false);
    expect(log).toEqual([]);
  });

  it('never from a window that does not answer: WM_KILLFOCUS to it would block the UI thread', async () => {
    const hung = fakeUser32({ focus: 200n, owner: { '200': 42 }, children: [200n], hung: true });
    expect(await takeFocusFromViews(hung.user32, HOST, OWN_PID)).toBe(false);
    expect(hung.log).toEqual([]);
    const slow = fakeUser32({ focus: 200n, owner: { '200': 42 }, children: [200n], answers: false });
    expect(await takeFocusFromViews(slow.user32, HOST, OWN_PID)).toBe(false);
    expect(slow.log).toEqual(['probe:200']);
  });

  it('leaves the focus alone when the user moved it while the window was probed', async () => {
    const { user32, log } = fakeUser32({ focus: 200n, owner: { '200': 42, '201': 42 }, children: [200n, 201n], focusDuringProbe: 201n });
    expect(await takeFocusFromViews(user32, HOST, OWN_PID)).toBe(false);
    expect(log).toEqual(['probe:200']);
  });
});
