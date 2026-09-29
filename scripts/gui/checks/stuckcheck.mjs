// On-screen check (opens windows and sends real input: only with the owner's permission, on an idle PC).
// C. The engine of a background document is killed: it restarts hidden and the active document stays in front.
// H. The engine of the active, changed document hangs (soffice.bin suspended) while its view has the keyboard focus
//    (the normal state while editing). Measures whether Varak stays usable when the user then
//    1. opens the File tab, 2. clicks "Restart engine" in the message bar, 3. closes the window (title bar ×).
// Only this script's own Varak instance (isolated data folder) and its engines are touched; a suspended engine is
// always resumed or ended before the script exits.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import koffi from 'koffi';
import * as W from '../win32.mjs';
import { launchVarak, repo, requireIdle, settingsPreset, sleep } from '../harness.mjs';

requireIdle(60_000, 'stuck');
const only = process.argv[2] ?? 'all'; // all | c | h

const kernel32 = koffi.load('kernel32.dll');
const ntdll = koffi.load('ntdll.dll');
const user32 = koffi.load('user32.dll');
const OpenProcess = kernel32.func('intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr h)');
const GetExitCodeProcess = kernel32.func('bool __stdcall GetExitCodeProcess(intptr h, _Out_ uint32 *code)');
const NtSuspendProcess = ntdll.func('int32 __stdcall NtSuspendProcess(intptr h)');
const NtResumeProcess = ntdll.func('int32 __stdcall NtResumeProcess(intptr h)');
const ChildProc = koffi.proto('bool __stdcall STUCK_ChildProc(intptr hwnd, intptr lparam)');
const EnumChildWindows = user32.func('bool __stdcall EnumChildWindows(intptr parent, STUCK_ChildProc *cb, intptr l)');

const suspended = new Set();
function setSuspended(pid, on) {
  const h = OpenProcess(0x0800 /* PROCESS_SUSPEND_RESUME */, false, pid);
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
  const h = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
  if (!h) return false;
  try {
    const code = [0];
    return GetExitCodeProcess(h, code) && code[0] === 259; /* STILL_ACTIVE */
  } finally {
    CloseHandle(h);
  }
}

const out = join(repo, 'test-output/gui/stuckcheck');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'files'), { recursive: true });
const shots = join(out, 'shots');
const file = (name, src) => {
  const p = join(out, 'files', name);
  copyFileSync(join(repo, 'tests/corpus/generated', src), p);
  return p;
};
const report = { c: {}, h: {} };
const settings = { ...settingsPreset({ language: 'tr', theme: 'light' }), autosaveMinutes: 1 };
const s = await launchVarak({ out, port: 9360, settings, tag: 'stuck' });

/** LibreOffice windows inside Varak's window (Chromium's GPU process has a child window there too). */
const images = new Map();
const isEngine = (pid) => {
  if (!images.has(pid)) images.set(pid, W.processImage(pid).toLowerCase().endsWith('soffice.bin'));
  return images.get(pid);
};
function engineWindows() {
  const hwnds = [];
  const cb = koffi.register((h) => {
    hwnds.push(h);
    return true;
  }, koffi.pointer(ChildProc));
  EnumChildWindows(s.appHwnd, cb, 0);
  koffi.unregister(cb);
  return hwnds.map((h) => W.windowRef(h)).filter((w) => w.pid !== s.app.pid && isEngine(w.pid));
}
const visibleEnginePids = () => [...new Set(engineWindows().filter((w) => w.visible && w.rect.width > 200).map((w) => w.pid))];
const allEnginePids = () => [...new Set(engineWindows().map((w) => w.pid))];

/** A promise that gives up after `ms` (Varak's main process may be blocked). */
const within = (p, ms, fallback) => Promise.race([p.catch(() => fallback), sleep(ms).then(() => fallback)]);
const mainAnswers = () => within(s.docs().then(() => true), 700, false);

async function realClickAt(x, y, what) {
  const root = W.rootAt(x, y);
  if (root !== s.appHwnd && W.windowInfo(root).owner !== s.appHwnd) throw new Error(`${what}: point covered by ${JSON.stringify(W.windowRef(root))}`);
  W.bringToFront(s.appHwnd);
  await sleep(150);
  W.click(x, y);
  s.log(`real click: ${what}`, { x, y });
}
/** Real mouse click on an element of Varak's UI (only when that point shows Varak). */
async function realClick(rect, what) {
  if (!rect) throw new Error(`no element for ${what}`);
  const o = W.clientOrigin(s.appHwnd);
  await realClickAt(Math.round(o.x + rect.x + rect.width / 2), Math.round(o.y + rect.y + rect.height / 2), what);
}
const rectByText = (selector, text) =>
  s.cdp.eval(`(() => {
    const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)});
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
const dialogText = () =>
  within(s.cdp.eval(`(() => { const d = document.querySelector('[role="alertdialog"], [role="dialog"][aria-modal="true"]'); return d ? d.textContent : null; })()`), 1500, null);
async function waitFor(pred, ms, step = 300) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await pred();
    if (v) return v;
    await sleep(step);
  }
  return null;
}
/** Samples Varak's responsiveness for `ms`: Windows' hung flag of its window and whether main answers IPC. */
async function sample(ms) {
  const t0 = Date.now();
  const points = [];
  while (Date.now() - t0 < ms) {
    points.push({ ms: Date.now() - t0, hung: W.isHung(s.appHwnd), main: await mainAnswers() });
    await sleep(500);
  }
  return { blocked: points.some((p) => !p.main), hungFlag: points.some((p) => p.hung), firstBlockedMs: points.find((p) => !p.main)?.ms ?? null, points: points.length };
}
async function openDoc(path, kind) {
  const doc = await s.open(path, kind);
  await sleep(2500);
  return { doc, pid: visibleEnginePids()[0] };
}
/** Suspends the engine of the active document while its view has the keyboard focus; waits for the hang bar. */
async function hangWithFocusInDocument(pid, docId, text) {
  await s.clickInDocument(0.5, 0.3);
  if (text) await s.typeHuman(text);
  await sleep(600);
  setSuspended(pid, true);
  s.log('engine suspended (focus in its view)', { pid });
  return Boolean(await waitFor(async () => (await within(s.docs(), 2000, [])).find((d) => d.docId === docId && d.state === 'busy'), 25_000, 500));
}
async function resumeAndMeasure(pid) {
  setSuspended(pid, false);
  const t = Date.now();
  const ok = await waitFor(async () => !W.isHung(s.appHwnd) && (await mainAnswers()), 30_000, 300);
  return ok ? Date.now() - t : null;
}

try {
  if (only === 'all' || only === 'c') {
    // ---- C: a background document's engine ends ------------------------------------------------------------
    const a = await openDoc(file('Arka.docx', 'docx-basic.docx'), 'writer');
    const b = await openDoc(file('Tablo.xlsx', 'xlsx-basic.xlsx'), 'calc');
    Object.assign(report.c, { writerPid: a.pid, calcPid: b.pid, visibleBefore: visibleEnginePids() });
    execFileSync('taskkill', ['/PID', String(a.pid), '/F'], { stdio: 'ignore' });
    s.log('background engine killed', { pid: a.pid });
    const restarted = await waitFor(async () => {
      const d = (await s.docs()).find((x) => x.docId === a.doc.docId);
      return d && d.state === 'ready' && allEnginePids().some((p) => p !== a.pid && p !== b.pid) ? d : null;
    }, 60_000, 500);
    report.c.restarted = Boolean(restarted);
    await sleep(1500);
    report.c.visibleAfter = visibleEnginePids();
    report.c.activeStaysInFront = report.c.visibleAfter.length === 1 && report.c.visibleAfter[0] === b.pid;
    await s.shot(shots, 'c1-background-restarted');
    await realClick(await s.cdp.rectOf(`[data-doc-id="${a.doc.docId}"]`), 'tab of the restarted document');
    await sleep(2000);
    report.c.visibleAfterSwitch = visibleEnginePids();
    report.c.restartedShown = report.c.visibleAfterSwitch.length === 1 && ![a.pid, b.pid].includes(report.c.visibleAfterSwitch[0]);
    await s.shot(shots, 'c2-switched');
    for (const d of await s.docs()) await s.cdp.invoke('documents:close', { docId: d.docId, force: true });
    s.log('C done', report.c);
  }

  if (only === 'all' || only === 'h') {
    // ---- H: hung engine, focus in its view --------------------------------------------------------------------
    const k = await openDoc(file('Kilit.docx', 'docx-basic.docx'), 'writer');
    await s.clickInDocument(0.5, 0.3);
    await s.typeHuman('ek');
    s.log('waiting for the 1-minute autosave');
    await sleep(68_000);

    // 1. File tab
    report.h.fileTab = { busy: await hangWithFocusInDocument(k.pid, k.doc.docId, 'x') };
    await s.shot(shots, 'h1-hang-bar');
    await realClick(await s.cdp.rectOf('.rb-filetab'), 'File tab while the engine hangs');
    Object.assign(report.h.fileTab, await sample(12_000));
    await s.shot(shots, 'h1-file-tab');
    report.h.fileTab.recoveredAfterResumeMs = await resumeAndMeasure(k.pid);
    await sleep(1500);
    report.h.fileTab.backstageAfterResume = await s.cdp.eval(`Boolean(document.querySelector('.vr-bs-nav'))`);
    await s.shot(shots, 'h1-after-resume');
    W.chord([W.VK.ESCAPE]);
    await waitFor(async () => (await s.docs()).find((d) => d.docId === k.doc.docId && d.state === 'ready'), 20_000, 500);
    await sleep(1000);

    // 2. "Motoru yeniden başlat" in the message bar
    report.h.restart = { busy: await hangWithFocusInDocument(k.pid, k.doc.docId, 'y') };
    await realClick(await rectByText('.vr-msgbar button', 'Motoru yeniden başlat'), 'Motoru yeniden başlat');
    Object.assign(report.h.restart, await sample(12_000));
    report.h.restart.oldEngineEnded = !processAlive(k.pid);
    if (!report.h.restart.oldEngineEnded) report.h.restart.recoveredAfterResumeMs = await resumeAndMeasure(k.pid);
    else suspended.delete(k.pid);
    const restored = await waitFor(async () => (await s.docs()).find((d) => d.docId === k.doc.docId && d.state === 'ready'), 60_000, 500);
    report.h.restart.restored = restored ? { modified: restored.modified, recoveredAt: restored.recoveredAt ?? null } : null;
    await sleep(2000);
    const pid2 = visibleEnginePids()[0];
    report.h.restart.newPid = pid2 ?? null;
    await s.shot(shots, 'h2-after-restart');

    // 3. Title bar close while the engine hangs
    if (pid2) {
      report.h.quit = { busy: await hangWithFocusInDocument(pid2, k.doc.docId, 'z') };
      const r = W.frameRect(s.appHwnd);
      await realClickAt(r.x + r.width - 24, r.y + 16, 'title bar close');
      const prompt = await waitFor(() => dialogText(), 12_000, 500);
      report.h.quit.prompt = prompt;
      Object.assign(report.h.quit, await sample(4_000));
      await s.shot(shots, 'h3-quit-prompt');
      if (prompt) {
        report.h.quit.focused = await within(s.cdp.eval('document.activeElement ? document.activeElement.textContent.trim() : null'), 1500, null);
        await realClick(await rectByText('[role="alertdialog"] button, [role="dialog"] button', 'Yine de kapat'), 'Yine de kapat');
        const t = Date.now();
        await waitFor(async () => !s.running(), 20_000, 300);
        report.h.quit.appExitedMs = s.running() ? null : Date.now() - t;
        report.h.quit.engineEnded = await waitFor(async () => !processAlive(pid2), 10_000, 300);
        suspended.delete(pid2);
      } else {
        report.h.quit.recoveredAfterResumeMs = await resumeAndMeasure(pid2);
      }
    }
    s.log('H done', report.h);
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
}
