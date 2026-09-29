/**
 * The window under test is a message-only window (parent HWND_MESSAGE): it can never be visible.
 * It lives in a child process that either pumps messages or blocks its thread (a "hung" engine).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { win32 } from '../../../src/main/platform/win32/ffi';
import { Win32HangDetector } from '../../../src/main/platform/win32/hang-detector';
import { isAlive, killQuietly, spawnNodeScript, waitFor } from './helpers';

const api = win32();

const WINDOW_OWNER = `
const koffi = require('koffi');
const fs = require('node:fs');
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const CreateWindowExW = user32.func('__stdcall', 'CreateWindowExW', 'void *', ['uint32', 'str16', 'str16', 'uint32', 'int', 'int', 'int', 'int', 'intptr_t', 'void *', 'void *', 'void *']);
const GetModuleHandleW = kernel32.func('__stdcall', 'GetModuleHandleW', 'void *', ['str16']);
const MSG = koffi.struct({ hwnd: 'void *', message: 'uint32', wParam: 'uintptr_t', lParam: 'intptr_t', time: 'uint32', x: 'int32', y: 'int32', lPrivate: 'uint32' });
const GetMessageW = user32.func('__stdcall', 'GetMessageW', 'int', [koffi.out(koffi.pointer(MSG)), 'void *', 'uint32', 'uint32']);
const DispatchMessageW = user32.func('__stdcall', 'DispatchMessageW', 'intptr_t', [koffi.pointer(MSG)]);
const HWND_MESSAGE = -3;
const hwnd = CreateWindowExW(0, 'STATIC', '', 0, 0, 0, 0, 0, HWND_MESSAGE, null, GetModuleHandleW(null), null);
if (!hwnd) { fs.writeSync(1, 'ERROR\\n'); process.exit(1); }
fs.writeSync(1, 'HWND ' + BigInt.asUintN(32, BigInt(hwnd)) + '\\n');
if (process.argv[1] === 'hang') {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); // blocks without ever pumping messages
} else {
  const msg = {};
  while (GetMessageW(msg, null, 0, 0) > 0) DispatchMessageW(msg);
}
`;

const children: number[] = [];

async function windowOwner(mode: 'pump' | 'hang') {
  const child = spawnNodeScript(WINDOW_OWNER, [mode]);
  if (child.pid) children.push(child.pid);
  const hwnd = await waitFor(() => /HWND (\d+)/.exec(child.output())?.[1], 20_000, `message-only window (${child.output()})`);
  return { child, hwnd };
}

afterEach(() => killQuietly(...children.splice(0)));

describe.skipIf(!api)('Win32HangDetector (message-only windows, headless)', () => {
  const detector = () => new Win32HangDetector(api!);

  it('reports a window whose thread pumps messages as responding', async () => {
    const { hwnd } = await windowOwner('pump');
    expect(await detector().isResponding(hwnd, 2000)).toBe(true);
  }, 30_000);

  it('reports a blocked thread as not responding within the timeout, without blocking the event loop', async () => {
    const { hwnd } = await windowOwner('hang');
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 10);
    const started = Date.now();
    const responding = await detector().isResponding(hwnd, 500);
    const elapsed = Date.now() - started;
    clearInterval(timer);
    expect(responding).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(5000);
    expect(ticks).toBeGreaterThan(10); // SendMessageTimeout ran on a worker thread
  }, 30_000);

  it('reports a destroyed window as not responding', async () => {
    const { child, hwnd } = await windowOwner('pump');
    child.kill();
    await waitFor(() => !isAlive(child.pid!), 10_000, 'window owner to exit');
    await waitFor(() => !api!.user32.IsWindow(BigInt(hwnd)), 10_000, 'window to be destroyed');
    expect(await detector().isResponding(hwnd, 500)).toBe(false);
  }, 30_000);

  it('rejects malformed handles', async () => {
    await expect(detector().isResponding('not-a-window', 100)).rejects.toThrow(TypeError);
  });
});
