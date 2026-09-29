/**
 * Owned and child views on a real, NON-headless soffice — without ever showing a window:
 *  - the host is a hidden top-level window of a helper process that pumps messages (never shown;
 *    per-monitor DPI aware like Electron's windows);
 *  - every document is loaded with `startHidden` (MediaDescriptor Hidden), and `view.setVisible(true)`
 *    is never called;
 *  - the returned HWNDs are inspected with the platform's Win32 bindings (koffi): the engine owns an owned
 *    view's frame before loading into it (engine/bridge/varak_bridge/owned.py), so the platform's real
 *    owned-mode code (makeOwned) must find nothing left to change.
 * Windows only; skipped without the engine or koffi.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import koffi from 'koffi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocLoadResult } from '@shared/engine-protocol';
import type { EngineInstance, EngineManager } from '../../src/main/engine/types';
import { parseHwnd, sameHwnd, type Hwnd } from '../../src/main/platform/hwnd';
import { GA_PARENT, GW_OWNER, GWL_EXSTYLE, GWL_STYLE, WS_CHILD, WS_EX_APPWINDOW, WS_EX_NOPARENTNOTIFY, WS_EX_TOOLWINDOW, WS_MAXIMIZE, WS_POPUP, WS_VISIBLE } from '../../src/main/platform/win32/constants';
import { win32 } from '../../src/main/platform/win32/ffi';
import { toStyleBits } from '../../src/main/platform/win32/styles';
import { createWin32ViewOps } from '../../src/main/platform/win32/view-ops';
import { engineAvailable, log, makeManager, TURKISH } from './helpers';

const api = process.platform === 'win32' ? win32() : null;

// Bridges started by this file offer the test-only 'debug.viewChrome' (varak_bridge/methods.py).
process.env['VARAK_BRIDGE_TEST_HOOKS'] = '1';
interface ViewChrome {
  layoutVisible: boolean;
  visibleElements: string[];
  leftPane: boolean | null;
}

/** Hidden host window in another process (argv: 'pmv1' → per-monitor v1 DPI awareness like Electron). */
const HOST_SCRIPT = `
const koffi = require('koffi');
const fs = require('node:fs');
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const SetProcessDpiAwarenessContext = user32.func('__stdcall', 'SetProcessDpiAwarenessContext', 'bool', ['intptr_t']);
const CreateWindowExW = user32.func('__stdcall', 'CreateWindowExW', 'void *', ['uint32', 'str16', 'str16', 'uint32', 'int', 'int', 'int', 'int', 'void *', 'void *', 'void *', 'void *']);
const GetModuleHandleW = kernel32.func('__stdcall', 'GetModuleHandleW', 'void *', ['str16']);
const MSG = koffi.struct({ hwnd: 'void *', message: 'uint32', wParam: 'uintptr_t', lParam: 'intptr_t', time: 'uint32', x: 'int32', y: 'int32', lPrivate: 'uint32' });
const GetMessageW = user32.func('__stdcall', 'GetMessageW', 'int', [koffi.out(koffi.pointer(MSG)), 'void *', 'uint32', 'uint32']);
const DispatchMessageW = user32.func('__stdcall', 'DispatchMessageW', 'intptr_t', [koffi.pointer(MSG)]);
if (process.argv[1] === 'pmv1') SetProcessDpiAwarenessContext(-3);
// WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, no WS_VISIBLE: never shown.
const hwnd = CreateWindowExW(0, 'STATIC', 'Varak engine view test host', 0x00CF0000 | 0x02000000, 100, 100, 900, 700, null, null, GetModuleHandleW(null), null);
if (!hwnd) { fs.writeSync(1, 'ERROR\\n'); process.exit(1); }
fs.writeSync(1, 'HWND ' + BigInt.asUintN(32, BigInt(hwnd)) + '\\n');
const msg = {};
while (GetMessageW(msg, null, 0, 0) > 0) DispatchMessageW(msg);
`;

describe.skipIf(!engineAvailable || !api)('owned and child views (non-headless engine, nothing shown)', () => {
  let manager: EngineManager;
  let instance: EngineInstance;
  let host: ChildProcess;
  let hostHwnd: Hwnd;
  let dpiApi: { context: (h: Hwnd) => unknown; awareness: (context: unknown) => unknown } | null = null;
  /** DPI_AWARENESS of a window (0 unaware, 1 system, 2 per monitor). */
  const awareness = (h: Hwnd): number => {
    if (!dpiApi) {
      const user32 = koffi.load('user32.dll');
      dpiApi = {
        context: user32.func('__stdcall', 'GetWindowDpiAwarenessContext', 'intptr_t', ['void *']),
        awareness: user32.func('__stdcall', 'GetAwarenessFromDpiAwarenessContext', 'int', ['intptr_t']),
      };
    }
    return dpiApi.awareness(dpiApi.context(h)) as number;
  };
  const report: Record<string, unknown> = {};

  beforeAll(async () => {
    host = spawn(process.execPath, ['-e', HOST_SCRIPT, 'pmv1'], { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
    hostHwnd = await new Promise<Hwnd>((resolvePromise, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`no host window: ${out}`)), 20_000);
      host.stdout!.on('data', (chunk: Buffer) => {
        out += chunk.toString();
        const match = /HWND (\d+)/.exec(out);
        if (match) {
          clearTimeout(timer);
          resolvePromise(BigInt(match[1]!));
        }
      });
    });
    manager = makeManager('views', { headless: false });
    instance = await manager.acquireDocumentInstance('views');
  });

  afterAll(async () => {
    await manager?.dispose();
    host?.kill();
    console.log(`\nView diagnostics ${JSON.stringify(report, null, 1)}`);
  });

  // Unsigned 32-bit style bits (JavaScript's & is signed: WS_POPUP would come out negative).
  const style = (h: Hwnd) => toStyleBits(api!.user32.GetWindowLongPtrW(h, GWL_STYLE));
  const has = (bits: number, flag: number) => ((bits & flag) >>> 0) === flag >>> 0;
  const exStyle = (h: Hwnd) => toStyleBits(api!.user32.GetWindowLongPtrW(h, GWL_EXSTYLE));
  const ownerPid = (h: Hwnd) => {
    const pid = [0];
    api!.user32.GetWindowThreadProcessId(h, pid);
    return pid[0];
  };
  const hwndOf = (result: DocLoadResult): Hwnd => {
    expect(result.hwnd).toMatch(/^\d+$/); // unsigned decimal string
    const h = parseHwnd(result.hwnd!);
    expect(h).not.toBeNull();
    return h!;
  };

  it('owned: a hidden, non-maximized frame of soffice.bin that the engine owned before loading into it', async () => {
    const result = await instance.call('doc.new', {
      docId: 'owned',
      kind: 'writer',
      view: { mode: 'owned', parentHwnd: String(hostHwnd), bounds: { x: 120, y: 140, width: 640, height: 480 }, startHidden: true },
    });
    const h = hwndOf(result);
    expect(api!.user32.IsWindow(h)).toBe(true);
    expect(api!.user32.IsWindowVisible(h)).toBe(false);
    expect(style(h) & WS_VISIBLE).toBe(0);
    expect(style(h) & WS_CHILD).toBe(0);
    expect(style(h) & WS_MAXIMIZE).toBe(0);
    expect(api!.user32.IsZoomed(h)).toBe(false);
    // Owned by the engine before the load could show it: a borderless tool window of the host.
    expect(sameHwnd(api!.user32.GetWindow(h, GW_OWNER), hostHwnd)).toBe(true);
    expect(has(style(h), WS_POPUP)).toBe(true);
    expect(has(exStyle(h), WS_EX_TOOLWINDOW)).toBe(true);
    expect(exStyle(h) & WS_EX_APPWINDOW).toBe(0);
    expect(ownerPid(h)).toBe(instance.info().officePid);
    report['owned'] = { style: `0x${style(h).toString(16)}`, exStyle: `0x${exStyle(h).toString(16)}`, awareness: awareness(h), dpi: api!.user32.GetDpiForWindow(h) };

    // The document works in this view.
    await instance.call('writer.insertText', { docId: 'owned', text: TURKISH });
    expect((await instance.call('writer.getText', { docId: 'owned' })).text).toBe(TURKISH);

    // The platform's owned-mode code finds nothing to change on the real LibreOffice frame (stays hidden).
    expect(api!.user32.IsIconic(h)).toBe(false);
    const styleBefore = style(h);
    await createWin32ViewOps(api!, log.child('views'), () => 'data:image/png;base64,').makeOwned(h, hostHwnd);
    expect(style(h)).toBe(styleBefore);
    expect(sameHwnd(api!.user32.GetWindow(h, GW_OWNER), hostHwnd)).toBe(true);
    expect(has(style(h), WS_POPUP)).toBe(true);
    expect(style(h) & WS_CHILD).toBe(0);
    expect(api!.user32.IsWindowVisible(h)).toBe(false);
    report['ownedAfterConversion'] = { style: `0x${style(h).toString(16)}`, exStyle: `0x${exStyle(h).toString(16)}`, awareness: awareness(h) };

    await instance.call('doc.close', { docId: 'owned' });
    expect(api!.user32.IsWindow(h)).toBe(false);
  });

  it('impress: the slide pane stays available (layout manager visible) while every LibreOffice toolbar stays hidden', async () => {
    await instance.call('doc.new', {
      docId: 'slides',
      kind: 'impress',
      view: { mode: 'child', parentHwnd: String(hostHwnd), bounds: { x: 0, y: 0, width: 800, height: 600 }, startHidden: true },
    });
    const chrome = (): Promise<ViewChrome> =>
      (instance.call as unknown as (method: string, params: object) => Promise<ViewChrome>)('debug.viewChrome', { docId: 'slides' });
    // An invisible layout manager makes sfx2 hide every child window, the slide pane included.
    const initial = await chrome();
    report['impressChrome'] = initial;
    expect(initial).toEqual({ layoutVisible: true, visibleElements: [], leftPane: true });
    // Selecting shapes makes Impress request its object bars itself (sd ToolBarManager): they stay hidden.
    await instance.call('cmd.dispatch', { docId: 'slides', command: '.uno:SelectAll' });
    const selected = await chrome();
    report['impressChromeAfterSelect'] = selected;
    expect(selected.visibleElements).toEqual([]);
    // Switching views (ribbon View tab) swaps Impress' view shells, which request their bars again.
    await instance.call('cmd.dispatch', { docId: 'slides', command: '.uno:OutlineMode' });
    await instance.call('cmd.dispatch', { docId: 'slides', command: '.uno:NormalMultiPaneGUI' });
    expect(await chrome()).toEqual({ layoutVisible: true, visibleElements: [], leftPane: true });
    await instance.call('doc.close', { docId: 'slides' });
  });

  it('child: a WS_CHILD frame inside the host (createSystemChild) with WS_EX_NOPARENTNOTIFY', async () => {
    const result = await instance.call('doc.new', {
      docId: 'child',
      kind: 'calc',
      view: { mode: 'child', parentHwnd: String(hostHwnd), bounds: { x: 0, y: 0, width: 640, height: 480 }, startHidden: true },
    });
    const h = hwndOf(result);
    expect(api!.user32.IsWindow(h)).toBe(true);
    expect(style(h) & WS_CHILD).toBe(WS_CHILD);
    expect(sameHwnd(api!.user32.GetAncestor(h, GA_PARENT), hostHwnd)).toBe(true);
    expect(api!.user32.IsWindowVisible(h)).toBe(false); // the host is hidden and the frame too
    expect(ownerPid(h)).toBe(instance.info().officePid);
    const rect: { left?: number; top?: number; right?: number; bottom?: number } = {};
    api!.user32.GetWindowRect(h, rect);
    expect([rect.right! - rect.left!, rect.bottom! - rect.top!]).toEqual([640, 480]);
    report['child'] = { style: `0x${style(h).toString(16)}`, exStyle: `0x${exStyle(h).toString(16)}`, awareness: awareness(h), hostAwareness: awareness(hostHwnd) };
    // Set by the bridge right after the load job (never inside it).
    await expect.poll(() => has(exStyle(h), WS_EX_NOPARENTNOTIFY), { timeout: 5_000 }).toBe(true);

    await instance.call('calc.setCell', { docId: 'child', address: 'A1', value: 1.5 });
    expect((await instance.call('calc.getCell', { docId: 'child', address: 'A1' })).display).toBe('1,5');
    await instance.call('doc.close', { docId: 'child' });
    expect(api!.user32.IsWindow(h)).toBe(false);
  });

  it('owned after child: soffice still creates owned frames (DPI awareness reported)', async () => {
    const result = await instance.call('doc.new', {
      docId: 'owned-2',
      kind: 'impress',
      view: { mode: 'owned', parentHwnd: String(hostHwnd), startHidden: true },
    });
    const h = hwndOf(result);
    expect(api!.user32.IsWindowVisible(h)).toBe(false);
    expect(style(h) & WS_CHILD).toBe(0);
    report['ownedAfterChild'] = { awareness: awareness(h), dpi: api!.user32.GetDpiForWindow(h) };
    await instance.call('doc.close', { docId: 'owned-2' });
  });
});
