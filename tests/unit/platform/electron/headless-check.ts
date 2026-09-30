/**
 * Headless Electron check of the platform layer, bundled and started by run-headless-check.ts.
 * Creates no BrowserWindow and no WebContentsView: the only window is a message-only window
 * (parent HWND_MESSAGE), which can never be shown. Prints one `RESULT {json}` line and quits.
 *
 * Not collected by Vitest (no .test.ts suffix); type-checked with the rest of tests/.
 */
import { app, nativeImage, screen } from 'electron';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PNG as PngType } from 'pngjs';
import { createPlatform } from '../../../../src/main/platform/index';
import type { Win32ProcessGuard } from '../../../../src/main/platform/win32/process-guard';

type KoffiModule = typeof import('koffi');

// Every Electron/Chromium file stays next to the bundle (test-output), never in %APPDATA%.
const here = dirname(fileURLToPath(import.meta.url));
app.setPath('userData', join(here, 'userdata'));
app.setPath('crashDumps', join(here, 'userdata', 'crashes'));
app.setPath('logs', join(here, 'userdata', 'logs'));

const load = createRequire(import.meta.url);
const koffi = load('koffi') as KoffiModule;
const { PNG } = load('pngjs') as { PNG: typeof PngType };
const out: Record<string, unknown> = {};
const t0 = Date.now();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function finish(err?: unknown): void {
  if (err) out['error'] = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stdout.write(`RESULT ${JSON.stringify(out)}\n`);
  app.quit();
}
setTimeout(() => finish('watchdog: the check took longer than 40 s'), 40_000).unref();

// `self` mode here so that Chromium's own child processes start inside the job (the harder case).
process.env['SIMPAPER_PROCESS_GUARD'] = 'self';
const platform = createPlatform(); // before 'ready': the job exists before Chromium starts helpers
const guard = platform.processGuard as Win32ProcessGuard;
out['platform'] = { viewHost: platform.viewHost.supported, guard: guard.supported, guardMode: guard.mode, shellKeys: Boolean(platform.shellKeys) };
out['selfInJob'] = guard.isInJob(process.pid);

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const GetThreadDpiAwarenessContext = user32.func('__stdcall', 'GetThreadDpiAwarenessContext', 'void *', []);
const GetAwarenessFromDpiAwarenessContext = user32.func('__stdcall', 'GetAwarenessFromDpiAwarenessContext', 'int', ['void *']);

async function run(): Promise<void> {
  out['readyMs'] = Date.now() - t0;

  // DPI awareness of the UI thread and of a koffi worker thread (0 unaware, 1 system, 2 per-monitor).
  out['dpiAwarenessMain'] = GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext());
  out['dpiAwarenessWorker'] = await new Promise((resolve) =>
    GetThreadDpiAwarenessContext.async((err: unknown, ctx: unknown) => resolve(err ? String(err) : GetAwarenessFromDpiAwarenessContext(ctx))),
  );
  out['displays'] = screen.getAllDisplays().map((d) => ({ bounds: d.bounds, scaleFactor: d.scaleFactor }));

  // nativeImage.createFromBitmap byte order (freeze-frame): B,G,R,A red pixel + blue pixel.
  const bitmap = Buffer.from([0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0xff]);
  out['bgraToRgba'] = Array.from(PNG.sync.read(nativeImage.createFromBitmap(bitmap, { width: 2, height: 1 }).toPNG()).data);
  out['dataUrlPrefix'] = nativeImage.createFromBitmap(Buffer.alloc(4, 0xff), { width: 1, height: 1 }).toDataURL().slice(0, 22);

  // A koffi-registered callback invoked from Electron's message loop (the ShellKeys mechanism).
  const WinEventProc = koffi.proto('__stdcall', null, 'void', ['void *', 'uint32', 'void *', 'int32', 'int32', 'uint32', 'uint32']);
  const SetWinEventHook = user32.func('__stdcall', 'SetWinEventHook', 'void *', ['uint32', 'uint32', 'void *', koffi.pointer(WinEventProc), 'uint32', 'uint32', 'uint32']);
  const UnhookWinEvent = user32.func('__stdcall', 'UnhookWinEvent', 'bool', ['void *']);
  const NotifyWinEvent = user32.func('__stdcall', 'NotifyWinEvent', 'void', ['uint32', 'void *', 'int32', 'int32']);
  const CreateWindowExW = user32.func('__stdcall', 'CreateWindowExW', 'void *', ['uint32', 'str16', 'str16', 'uint32', 'int', 'int', 'int', 'int', 'intptr_t', 'void *', 'void *', 'void *']);
  const DestroyWindow = user32.func('__stdcall', 'DestroyWindow', 'bool', ['void *']);
  const GetModuleHandleW = kernel32.func('__stdcall', 'GetModuleHandleW', 'void *', ['str16']);
  const EVENT_OBJECT_NAMECHANGE = 0x800c;
  const HWND_MESSAGE = -3;
  const messageWindow = CreateWindowExW(0, 'STATIC', '', 0, 0, 0, 0, 0, HWND_MESSAGE, null, GetModuleHandleW(null), null) as bigint;
  let hits = 0;
  const callback = koffi.register((_hook: unknown, event: number, hwnd: unknown) => {
    if (event === EVENT_OBJECT_NAMECHANGE && hwnd === messageWindow) hits += 1;
  }, koffi.pointer(WinEventProc));
  const hook = SetWinEventHook(EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE, null, callback, process.pid, 0, 0 /* WINEVENT_OUTOFCONTEXT */);
  NotifyWinEvent(EVENT_OBJECT_NAMECHANGE, messageWindow, 0, 0);
  await sleep(300);
  out['winEventCallbackHits'] = hits;
  UnhookWinEvent(hook);
  koffi.unregister(callback);

  // Hang detector against a window of Electron's own (pumping) UI thread.
  out['hangDetectorOnUiThreadWindow'] = await platform.hangDetector.isResponding(String(BigInt.asUintN(32, messageWindow)), 1000);
  DestroyWindow(messageWindow);

  // Chromium's helper processes (GPU / utility) that started while the app process was in the job.
  await sleep(1500);
  out['children'] = app
    .getAppMetrics()
    .filter((m) => m.pid !== process.pid)
    .map((m) => ({ type: m.type, service: m.serviceName ?? null, sandboxed: m.sandboxed ?? null, inJob: guard.isInJob(m.pid) }));

  // A process started now is in the job; killTree removes it.
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore', windowsHide: true });
  await sleep(700);
  out['spawnedChildInJob'] = child.pid !== undefined && guard.isInJob(child.pid);
  if (child.pid !== undefined) await guard.killTree(child.pid);
  await sleep(100);
  out['spawnedChildExited'] = child.exitCode !== null || child.signalCode !== null;
}

app.whenReady().then(run).then(() => finish(), finish);
