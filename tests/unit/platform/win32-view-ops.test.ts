/**
 * Owned-mode conversion on real cross-process windows that are never shown: one child process owns a
 * hidden top-level "host" window, another owns the hidden "LibreOffice frame" (top-level, or a WS_CHILD
 * of the host like a createSystemChild frame). Both pump messages. Nothing here shows or activates a
 * window: visibility is only ever requested as `false`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalHwnd, type Hwnd } from '../../../src/main/platform/hwnd';
import {
  GWL_EXSTYLE,
  GWL_STYLE,
  WS_CAPTION,
  WS_CHILD,
  WS_EX_APPWINDOW,
  WS_EX_TOOLWINDOW,
  WS_MAXIMIZEBOX,
  WS_MINIMIZEBOX,
  WS_POPUP,
  WS_SYSMENU,
  WS_THICKFRAME,
  WS_VISIBLE,
} from '../../../src/main/platform/win32/constants';
import { captureWindow } from '../../../src/main/platform/win32/capture';
import { win32, type Rect32 } from '../../../src/main/platform/win32/ffi';
import { toStyleBits } from '../../../src/main/platform/win32/styles';
import { createWin32ViewOps } from '../../../src/main/platform/win32/view-ops';
import { isAlive, killQuietly, memoryLogger, spawnNodeScript, waitFor } from './helpers';

const api = win32();
const GW_OWNER = 4;
const GA_PARENT = 1;

/** argv: ['top'] → hidden WS_OVERLAPPEDWINDOW frame; ['child', parentHwnd] → hidden WS_CHILD of another process' window. */
const WINDOW_OWNER = `
const koffi = require('koffi');
const fs = require('node:fs');
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const CreateWindowExW = user32.func('__stdcall', 'CreateWindowExW', 'void *', ['uint32', 'str16', 'str16', 'uint32', 'int', 'int', 'int', 'int', 'void *', 'void *', 'void *', 'void *']);
const GetModuleHandleW = kernel32.func('__stdcall', 'GetModuleHandleW', 'void *', ['str16']);
const MSG = koffi.struct({ hwnd: 'void *', message: 'uint32', wParam: 'uintptr_t', lParam: 'intptr_t', time: 'uint32', x: 'int32', y: 'int32', lPrivate: 'uint32' });
const GetMessageW = user32.func('__stdcall', 'GetMessageW', 'int', [koffi.out(koffi.pointer(MSG)), 'void *', 'uint32', 'uint32']);
const DispatchMessageW = user32.func('__stdcall', 'DispatchMessageW', 'intptr_t', [koffi.pointer(MSG)]);
const [kind, parent] = process.argv.slice(1);
// No WS_VISIBLE anywhere: these windows are never shown.
const hwnd = kind === 'child'
  ? CreateWindowExW(0x4 /* WS_EX_NOPARENTNOTIFY */, 'STATIC', '', 0x40000000 | 0x04000000 /* WS_CHILD | WS_CLIPSIBLINGS */, 0, 0, 200, 100, BigInt(parent), null, GetModuleHandleW(null), null)
  : CreateWindowExW(0x40000 /* WS_EX_APPWINDOW */, 'STATIC', 'Varak platform test', 0x00CF0000 | 0x02000000 /* WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN */, 100, 100, 400, 300, null, null, GetModuleHandleW(null), null);
if (!hwnd) { fs.writeSync(1, 'ERROR\\n'); process.exit(1); }
fs.writeSync(1, 'HWND ' + BigInt.asUintN(32, BigInt(hwnd)) + '\\n');
const msg = {};
while (GetMessageW(msg, null, 0, 0) > 0) DispatchMessageW(msg);
`;

const owners: number[] = [];

async function hiddenWindow(...args: string[]): Promise<{ hwnd: Hwnd; pid: number }> {
  const child = spawnNodeScript(WINDOW_OWNER, args);
  if (child.pid) owners.push(child.pid);
  const text = await waitFor(() => /HWND (\d+)/.exec(child.output())?.[1], 20_000, `hidden window (${child.output()})`);
  return { hwnd: BigInt(text), pid: child.pid! };
}

afterEach(() => killQuietly(...owners.splice(0)));

describe.skipIf(!api)('Win32 view operations on hidden cross-process windows', () => {
  const ops = () => createWin32ViewOps(api!, memoryLogger(), () => 'data:image/png;base64,');
  const style = (h: Hwnd) => toStyleBits(api!.user32.GetWindowLongPtrW(h, GWL_STYLE));
  const exStyle = (h: Hwnd) => toStyleBits(api!.user32.GetWindowLongPtrW(h, GWL_EXSTYLE));
  const rectOf = (h: Hwnd) => {
    const r: Partial<Rect32> = {};
    api!.user32.GetWindowRect(h, r);
    return r;
  };

  it('turns a top-level frame of another process into a hidden borderless popup owned by the host', async () => {
    const host = await hiddenWindow('top');
    const view = await hiddenWindow('top');
    const o = ops();
    expect(style(view.hwnd) & WS_CAPTION).toBe(WS_CAPTION);

    await o.makeOwned(view.hwnd, host.hwnd);

    const s = style(view.hwnd);
    expect((s & WS_POPUP) >>> 0).toBe(WS_POPUP);
    expect(s & (WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_CHILD | WS_VISIBLE)).toBe(0);
    expect(exStyle(view.hwnd) & WS_EX_TOOLWINDOW).toBe(WS_EX_TOOLWINDOW);
    expect(exStyle(view.hwnd) & WS_EX_APPWINDOW).toBe(0);
    expect(canonicalHwnd(api!.user32.GetWindow(view.hwnd, GW_OWNER))).toBe(host.hwnd);
    expect(o.rootOwner(view.hwnd)).toBe(host.hwnd);
    expect(o.parentOf(view.hwnd)).toBeNull();

    // Positioned in physical screen coordinates while staying hidden.
    expect(await o.place(view.hwnd, { x: 50, y: 60, width: 320, height: 200 }, false)).toBe(true);
    expect(rectOf(view.hwnd)).toEqual({ left: 50, top: 60, right: 370, bottom: 260 });
    expect(api!.user32.IsWindowVisible(view.hwnd)).toBe(false);

    const area = o.clientArea(host.hwnd);
    expect(area?.size.width).toBeGreaterThan(0);
    expect(area?.origin.x).toBeGreaterThanOrEqual(100); // inside the frame at (100,100)

    // Freeze-frame capture refuses hidden windows.
    expect(await captureWindow(api!, view.hwnd, 500, () => 'x', memoryLogger())).toBeNull();

    killQuietly(view.pid);
    await waitFor(() => !isAlive(view.pid) && !o.isWindow(view.hwnd), 10_000, 'the view window to disappear');
    expect(await o.place(view.hwnd, { x: 0, y: 0, width: 10, height: 10 }, false)).toBe(false);
  }, 60_000);

  it('leaves a frame the engine already owned untouched: no hide, restyle or re-own from the worker', async () => {
    const host = await hiddenWindow('top');
    const view = await hiddenWindow('top');
    await ops().makeOwned(view.hwnd, host.hwnd); // what the engine bridge does before it loads (owned.py)
    const before = { style: style(view.hwnd), exStyle: exStyle(view.hwnd) };

    // Record every call that could hide, restyle, re-own or move the (possibly shown and active) frame.
    const calls: string[] = [];
    const spy = <F extends object>(name: string, f: F): F =>
      new Proxy(f, {
        apply: (target, self, args: unknown[]) => {
          calls.push(name);
          return Reflect.apply(target as (...a: unknown[]) => unknown, self, args);
        },
        get: (target, prop, receiver) => {
          const value: unknown = Reflect.get(target, prop, receiver);
          if (prop !== 'async' || typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            calls.push(`${name}.async`);
            return Reflect.apply(value as (...a: unknown[]) => unknown, target, args);
          };
        },
      });
    const user32 = { ...api!.user32 };
    user32.ShowWindow = spy('ShowWindow', user32.ShowWindow);
    user32.SetWindowLongPtrW = spy('SetWindowLongPtrW', user32.SetWindowLongPtrW);
    user32.SetWindowPos = spy('SetWindowPos', user32.SetWindowPos);
    user32.SetParent = spy('SetParent', user32.SetParent);
    const log = memoryLogger();
    await createWin32ViewOps({ ...api!, user32 }, log, () => 'data:image/png;base64,').makeOwned(view.hwnd, host.hwnd);

    expect(calls).toEqual([]);
    expect({ style: style(view.hwnd), exStyle: exStyle(view.hwnd) }).toEqual(before);
    expect(canonicalHwnd(api!.user32.GetWindow(view.hwnd, GW_OWNER))).toBe(host.hwnd);
    expect(log.entries.map((e) => e.message)).toContain('Owned view ready (owned by the engine)');

    // A frame owned by another window is still converted (fallback path).
    const other = await hiddenWindow('top');
    await ops().makeOwned(view.hwnd, other.hwnd);
    expect(canonicalHwnd(api!.user32.GetWindow(view.hwnd, GW_OWNER))).toBe(other.hwnd);
    expect(api!.user32.IsWindowVisible(view.hwnd)).toBe(false);
  }, 60_000);

  it('detaches a createSystemChild-style WS_CHILD frame from the host and makes it an owned popup', async () => {
    const host = await hiddenWindow('top');
    const frame = await hiddenWindow('child', String(host.hwnd));
    const o = ops();
    expect(o.parentOf(frame.hwnd)).toBe(host.hwnd);

    await o.makeOwned(frame.hwnd, host.hwnd);

    expect(style(frame.hwnd) & WS_CHILD).toBe(0);
    expect((style(frame.hwnd) & WS_POPUP) >>> 0).toBe(WS_POPUP);
    expect(o.parentOf(frame.hwnd)).toBeNull();
    const desktop = canonicalHwnd(api!.user32.GetAncestor(frame.hwnd, GA_PARENT));
    expect(desktop).not.toBe(host.hwnd);
    expect(canonicalHwnd(api!.user32.GetWindow(frame.hwnd, GW_OWNER))).toBe(host.hwnd);
    expect(api!.user32.IsWindowVisible(frame.hwnd)).toBe(false);
  }, 60_000);
});
