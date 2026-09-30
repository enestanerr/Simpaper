// On-screen probe (opens windows and sends real input: only with the owner's permission, on an idle PC).
// The engine of the active document hangs (soffice.bin suspended) while its view has the keyboard focus.
// 1. Does a real click on "Motoru yeniden başlat" in the message bar reach Simpaper?
// 2. If not: does detaching the input queues (AttachThreadInput(simpaper UI thread, engine UI thread, FALSE)) help?
// Only this script's own Simpaper instance (isolated data folder) and its engine are touched.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import koffi from 'koffi';
import * as W from '../win32.mjs';
import { launchSimpaper, repo, requireIdle, settingsPreset, sleep } from '../harness.mjs';

requireIdle(60_000, 'probe');
const detachFirst = process.argv.includes('--detach-first');

const kernel32 = koffi.load('kernel32.dll');
const ntdll = koffi.load('ntdll.dll');
const user32 = koffi.load('user32.dll');
const OpenProcess = kernel32.func('intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr h)');
const GetExitCodeProcess = kernel32.func('bool __stdcall GetExitCodeProcess(intptr h, _Out_ uint32 *code)');
const GetLastError = kernel32.func('uint32 __stdcall GetLastError()');
const NtSuspendProcess = ntdll.func('int32 __stdcall NtSuspendProcess(intptr h)');
const NtResumeProcess = ntdll.func('int32 __stdcall NtResumeProcess(intptr h)');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32 *pid)');
const AttachThreadInput = user32.func('bool __stdcall AttachThreadInput(uint32 a, uint32 b, bool attach)');
const ChildProc = koffi.proto('bool __stdcall PROBE_ChildProc(intptr hwnd, intptr lparam)');
const EnumChildWindows = user32.func('bool __stdcall EnumChildWindows(intptr parent, PROBE_ChildProc *cb, intptr l)');

let suspendedPid = 0;
function setSuspended(pid, on) {
  const h = OpenProcess(0x0800, false, pid);
  if (!h) throw new Error(`cannot open process ${pid}`);
  try {
    const status = on ? NtSuspendProcess(h) : NtResumeProcess(h);
    if (status !== 0) throw new Error(`${on ? 'suspend' : 'resume'} ${pid}: status ${status >>> 0}`);
  } finally {
    CloseHandle(h);
  }
  suspendedPid = on ? pid : 0;
}
function processAlive(pid) {
  const h = OpenProcess(0x1000, false, pid);
  if (!h) return false;
  try {
    const code = [0];
    return GetExitCodeProcess(h, code) && code[0] === 259;
  } finally {
    CloseHandle(h);
  }
}

const out = join(repo, 'test-output/gui/hangprobe');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'files'), { recursive: true });
const shots = join(out, 'shots');
const docx = join(out, 'files', 'Kilit.docx');
copyFileSync(join(repo, 'tests/corpus/generated/docx-basic.docx'), docx);
const report = { detachFirst };
const s = await launchSimpaper({ out, port: 9370, settings: settingsPreset({ language: 'tr', theme: 'light' }), tag: 'probe' });

const images = new Map();
const isEngine = (pid) => {
  if (!images.has(pid)) images.set(pid, W.processImage(pid).toLowerCase().endsWith('soffice.bin'));
  return images.get(pid);
};
function engineViews() {
  const hwnds = [];
  const cb = koffi.register((h) => {
    hwnds.push(h);
    return true;
  }, koffi.pointer(ChildProc));
  EnumChildWindows(s.appHwnd, cb, 0);
  koffi.unregister(cb);
  return hwnds.map((h) => W.windowRef(h)).filter((w) => w.pid !== s.app.pid && isEngine(w.pid) && w.visible && w.rect.width > 200);
}
const within = (p, ms, fallback) => Promise.race([p.catch(() => fallback), sleep(ms).then(() => fallback)]);
async function waitFor(pred, ms, step = 300) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await pred();
    if (v) return v;
    await sleep(step);
  }
  return null;
}
async function clickRestart(what) {
  const r = await s.cdp.eval(`(() => {
    const b = [...document.querySelectorAll('.vr-msgbar button')].find((e) => e.textContent.trim() === 'Motoru yeniden başlat');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  if (!r) throw new Error('no "Motoru yeniden başlat" button');
  const o = W.clientOrigin(s.appHwnd);
  const x = Math.round(o.x + r.x + r.width / 2);
  const y = Math.round(o.y + r.y + r.height / 2);
  const root = W.rootAt(x, y);
  if (root !== s.appHwnd) throw new Error(`point covered by ${JSON.stringify(W.windowRef(root))}`);
  W.bringToFront(s.appHwnd);
  await sleep(150);
  W.click(x, y);
  s.log(`real click: ${what}`, { x, y });
}

try {
  const doc = await s.open(docx, 'writer');
  await sleep(2500);
  const [view] = engineViews();
  if (!view) throw new Error('no visible engine view');
  const pid = view.pid;
  const engineTid = GetWindowThreadProcessId(view.hwnd, [0]);
  const simpaperTid = GetWindowThreadProcessId(s.appHwnd, [0]);
  Object.assign(report, { pid, engineTid, simpaperTid });
  await s.clickInDocument(0.5, 0.3);
  await s.typeHuman('ab');
  await sleep(600);
  setSuspended(pid, true);
  s.log('engine suspended (focus in its view)', { pid });
  report.busy = Boolean(await waitFor(async () => (await within(s.docs(), 2000, [])).find((d) => d.docId === doc.docId && d.state === 'busy'), 25_000, 500));
  await s.shot(shots, '1-hang-bar');
  if (detachFirst) {
    report.detach = { ok: AttachThreadInput(simpaperTid, engineTid, false), error: GetLastError() };
    s.log('detached input queues', report.detach);
    await sleep(300);
  }
  await clickRestart('Motoru yeniden başlat (1)');
  report.firstClick = { engineEnded: Boolean(await waitFor(() => !processAlive(pid), 8000, 250)) };
  s.log('first click', report.firstClick);
  if (!report.firstClick.engineEnded && !detachFirst) {
    report.detach = { ok: AttachThreadInput(simpaperTid, engineTid, false), error: GetLastError() };
    s.log('detached input queues', report.detach);
    await sleep(500);
    report.afterDetach = { engineEnded: Boolean(await waitFor(() => !processAlive(pid), 4000, 250)) };
    if (!report.afterDetach.engineEnded) {
      await clickRestart('Motoru yeniden başlat (2, after detaching)');
      report.afterDetach.secondClickEngineEnded = Boolean(await waitFor(() => !processAlive(pid), 8000, 250));
    }
    s.log('after detach', report.afterDetach);
  }
  if (!processAlive(pid)) suspendedPid = 0;
  const restored = await waitFor(async () => (await within(s.docs(), 2000, [])).find((d) => d.docId === doc.docId && d.state === 'ready'), 60_000, 500);
  report.restored = restored ? { modified: restored.modified, recoveredAt: restored.recoveredAt ?? null } : null;
  await sleep(1500);
  report.newView = engineViews().map((v) => v.pid);
  await s.shot(shots, '2-after');
  // Typing into the restored document works again?
  if (report.newView.length) {
    await s.clickInDocument(0.5, 0.3);
    await s.typeHuman('cd');
    await sleep(800);
    report.typedAfter = (await s.docs()).find((d) => d.docId === doc.docId)?.modified ?? null;
  }
} catch (err) {
  report.error = String(err?.stack ?? err);
  s.log('FAILED', { error: String(err?.message ?? err) });
} finally {
  if (suspendedPid) {
    try {
      setSuspended(suspendedPid, false);
      report.resumedAtEnd = true;
    } catch {
      // gone
    }
  }
  s.close();
  writeFileSync(join(out, 'report.json'), JSON.stringify({ ...report, steps: s.steps }, null, 2));
  console.log(JSON.stringify(report));
}
