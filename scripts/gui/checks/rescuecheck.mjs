// On-screen check (opens windows and sends real input: only with the owner's permission, on an idle PC).
// The engine of the active, changed document hangs (soffice.bin suspended) while its view has the keyboard focus,
// which holds back input for the Simpaper window. Expected:
// 1. a message box of its own offers "Motoru yeniden başlat" / "Bekle" (Bekle focused); choosing restart with real
//    keys ends the engine, the document comes back from the autosave, and Simpaper takes input again;
// 2. hanging again, the box closes by itself when the engine answers again (resumed without an answer).
// Only this script's own Simpaper instance (isolated data folder) and its engines are touched.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import koffi from 'koffi';
import * as W from '../win32.mjs';
import { launchSimpaper, repo, requireIdle, settingsPreset, sleep } from '../harness.mjs';

requireIdle(60_000, 'rescue');

const kernel32 = koffi.load('kernel32.dll');
const ntdll = koffi.load('ntdll.dll');
const user32 = koffi.load('user32.dll');
const OpenProcess = kernel32.func('intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr h)');
const GetExitCodeProcess = kernel32.func('bool __stdcall GetExitCodeProcess(intptr h, _Out_ uint32 *code)');
const NtSuspendProcess = ntdll.func('int32 __stdcall NtSuspendProcess(intptr h)');
const NtResumeProcess = ntdll.func('int32 __stdcall NtResumeProcess(intptr h)');
const ChildProc = koffi.proto('bool __stdcall RESCUE_ChildProc(intptr hwnd, intptr lparam)');
const EnumChildWindows = user32.func('bool __stdcall EnumChildWindows(intptr parent, RESCUE_ChildProc *cb, intptr l)');

const suspended = new Set();
function setSuspended(pid, on) {
  const h = OpenProcess(0x0800, false, pid);
  if (!h) throw new Error(`cannot open process ${pid}`);
  try {
    const status = on ? NtSuspendProcess(h) : NtResumeProcess(h);
    if (status !== 0) throw new Error(`${on ? 'suspend' : 'resume'} ${pid}: status ${status >>> 0}`);
  } finally {
    CloseHandle(h);
  }
  if (on) suspended.add(pid);
  else suspended.delete(pid);
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

const out = join(repo, 'test-output/gui/rescuecheck');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'files'), { recursive: true });
const shots = join(out, 'shots');
const docx = join(out, 'files', 'Kilit.docx');
copyFileSync(join(repo, 'tests/corpus/generated/docx-basic.docx'), docx);
const report = {};
const settings = { ...settingsPreset({ language: 'tr', theme: 'light' }), autosaveMinutes: 1 };
const s = await launchSimpaper({ out, port: 9380, settings, tag: 'rescue' });

const images = new Map();
const isEngine = (pid) => {
  if (!images.has(pid)) images.set(pid, W.processImage(pid).toLowerCase().endsWith('soffice.bin'));
  return images.get(pid);
};
function viewPid() {
  const hwnds = [];
  const cb = koffi.register((h) => {
    hwnds.push(h);
    return true;
  }, koffi.pointer(ChildProc));
  EnumChildWindows(s.appHwnd, cb, 0);
  koffi.unregister(cb);
  return hwnds.map((h) => W.windowRef(h)).find((w) => w.pid !== s.app.pid && isEngine(w.pid) && w.visible && w.rect.width > 200)?.pid ?? null;
}
/** The rescue box: a visible dialog window (#32770) of Simpaper's own process without an owner. */
const rescueBox = () => W.topLevelWindows().find((w) => w.pid === s.app.pid && w.visible && w.cls === '#32770' && !w.owner) ?? null;
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
const focusOwner = () => {
  const h = W.keyboardFocus();
  if (!h) return 'none';
  const pid = W.windowInfo(h).pid;
  return pid === s.app.pid ? 'simpaper:' + W.windowInfo(h).cls : W.processImage(pid).toLowerCase().endsWith('soffice.bin') ? 'engine' : 'other';
};
const docState = async (docId) => (await within(s.docs(), 2000, [])).find((d) => d.docId === docId) ?? null;
function shotOf(win, name) {
  mkdirSync(shots, { recursive: true });
  writeFileSync(join(shots, `${name}.png`), W.captureScreen(W.frameRect(win.hwnd)));
  s.log(`screenshot ${name}.png`);
}

try {
  const doc = await s.open(docx, 'writer');
  await sleep(2500);
  const pid1 = viewPid();
  if (!pid1) throw new Error('no visible engine view');
  await s.clickInDocument(0.5, 0.3);
  await s.typeHuman('ek');
  s.log('waiting for the 1-minute autosave');
  await sleep(68_000);
  await s.clickInDocument(0.5, 0.3);
  await s.typeHuman('x');
  await sleep(500);

  // ---- 1. restart through the box --------------------------------------------------------------------------
  setSuspended(pid1, true);
  const t0 = Date.now();
  s.log('engine suspended (focus in its view)', { pid: pid1 });
  const box = await waitFor(() => rescueBox(), 40_000, 250);
  report.boxAfterMs = box ? Date.now() - t0 : null;
  if (!box) throw new Error('no rescue box within 40 s');
  await sleep(600);
  shotOf(box, '1-rescue-box');
  report.boxForeground = W.foreground() === box.hwnd;
  if (!report.boxForeground) W.bringToFront(box.hwnd);
  await sleep(300);
  if (W.foreground() !== box.hwnd) throw new Error(`the rescue box is not in front: ${JSON.stringify(W.windowRef(W.foreground()))}`);
  // "Bekle" has the focus: Shift+Tab to "Motoru yeniden başlat", Enter.
  W.chord([W.VK.SHIFT, W.VK.TAB]);
  await sleep(250);
  if (W.foreground() !== box.hwnd) throw new Error('the rescue box lost the foreground');
  W.chord([W.VK.RETURN]);
  s.log('real keys in the box: Shift+Tab, Enter');
  report.engineEnded = Boolean(await waitFor(() => !processAlive(pid1), 10_000, 250));
  if (report.engineEnded) suspended.delete(pid1);
  report.boxClosed = Boolean(await waitFor(() => !rescueBox(), 5000, 250));
  const restored = await waitFor(async () => {
    const d = await docState(doc.docId);
    return d && d.state === 'ready' ? d : null;
  }, 60_000, 500);
  report.restored = restored ? { modified: restored.modified, recoveredAt: restored.recoveredAt ?? null } : null;
  await sleep(1500);
  const pid2 = viewPid();
  report.newEnginePid = pid2;
  report.focusAfterRestore = focusOwner();
  report.foregroundAfterRestore = W.foreground() === s.appHwnd ? 'simpaper' : 'other';
  await s.shot(shots, '2-restored');
  // Simpaper takes input again: the File tab opens the backstage, Esc goes back.
  const fileTab = await s.cdp.rectOf('.rb-filetab');
  const o = W.clientOrigin(s.appHwnd);
  W.bringToFront(s.appHwnd);
  await sleep(200);
  W.click(Math.round(o.x + fileTab.x + fileTab.width / 2), Math.round(o.y + fileTab.y + fileTab.height / 2));
  report.backstageOpens = Boolean(await waitFor(() => s.cdp.eval(`Boolean(document.querySelector('.vr-bs-nav'))`), 5000, 250));
  await sleep(700);
  report.focusInBackstage = focusOwner();
  report.pageHasFocus = await s.cdp.eval('document.hasFocus()');
  await s.shot(shots, '3-backstage');
  s.assertForeground();
  W.chord([W.VK.ESCAPE]);
  report.backstageCloses = Boolean(await waitFor(async () => !(await s.cdp.eval(`Boolean(document.querySelector('.vr-bs-nav'))`)), 5000, 250));
  s.log('part 1', report);

  // ---- 2. the box withdraws itself when the engine answers again -------------------------------------------
  if (pid2) {
    await sleep(1000);
    await s.clickInDocument(0.5, 0.3);
    await s.typeHuman('y');
    await sleep(500);
    setSuspended(pid2, true);
    const box2 = await waitFor(() => rescueBox(), 40_000, 250);
    report.secondBox = Boolean(box2);
    setSuspended(pid2, false);
    report.secondBoxWithdrawn = Boolean(await waitFor(() => !rescueBox(), 15_000, 250));
    const back = await waitFor(async () => {
      const d = await docState(doc.docId);
      return d && d.state === 'ready' ? d : null;
    }, 20_000, 500);
    report.readyAgain = Boolean(back);
    report.sameEngine = processAlive(pid2) && viewPid() === pid2;
    await s.shot(shots, '4-responding-again');
    s.log('part 2', { secondBox: report.secondBox, secondBoxWithdrawn: report.secondBoxWithdrawn, readyAgain: report.readyAgain, sameEngine: report.sameEngine });
  }
} catch (err) {
  report.error = String(err?.stack ?? err);
  s.log('FAILED', { error: String(err?.message ?? err) });
} finally {
  for (const pid of suspended) {
    try {
      setSuspended(pid, false);
    } catch {
      // gone
    }
  }
  s.close();
  writeFileSync(join(out, 'report.json'), JSON.stringify({ ...report, steps: s.steps }, null, 2));
  console.log(JSON.stringify(report));
}
