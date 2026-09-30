// GUI spike (docs/testing/GUI_SPIKE.md): starts the packaged Simpaper on the visible desktop, drives it with real mouse
// and keyboard input plus the renderer's DevTools protocol, and records screenshots and measurements.
// OPENS WINDOWS AND SENDS INPUT — run only with the machine owner's permission, while nobody uses the PC.
//   node scripts/gui/gui-spike.mjs [--exe release/win-unpacked/Simpaper.exe] [--out test-output/gui]
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import JSZip from 'jszip';
import { Cdp } from './cdp.mjs';
import * as W from './win32.mjs';

const repo = resolve(import.meta.dirname, '..', '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const exe = resolve(repo, arg('--exe', 'release/win-unpacked/Simpaper.exe'));
const out = resolve(repo, arg('--out', 'test-output/gui'));
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Never take over a PC that is in use: require a quiet desktop before opening windows (override: --idle-ms <ms>).
const needIdle = Number(arg('--idle-ms', '60000'));
if (W.idleMs() < needIdle) {
  console.error(`[gui] keyboard/mouse were used ${Math.round(W.idleMs() / 1000)} s ago; not starting (needs ${needIdle / 1000} s without input)`);
  process.exit(2);
}

rmSync(out, { recursive: true, force: true });
const files = join(out, 'files');
const shots = join(out, 'shots');
mkdirSync(files, { recursive: true });
mkdirSync(shots, { recursive: true });
const gen = join(repo, 'tests/corpus/generated');
const doc = (name, src) => {
  const p = join(files, name);
  copyFileSync(join(gen, src), p);
  return p;
};
const docx = doc('Belge-Türkçe.docx', 'docx-basic.docx');
const xlsx = doc('Tablo.xlsx', 'xlsx-basic.xlsx');
const pptx = doc('Sunu.pptx', 'pptx-basic.pptx');
const pdfText = doc('Metin.pdf', 'pdf-text.pdf');
const pdfForm = doc('Form.pdf', 'pdf-form.pdf');
/** Typed into Writer with real keys (every character exists on a Turkish Q keyboard). */
const TYPED = 'Simpaper GUI testi: çğıİöşü ÇĞIİÖŞÜ - klavyeyle yazıldı.';

const report = { startedAt: new Date().toISOString(), exe, steps: [] };
const log = (msg, extra) => {
  const line = `[gui] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
  console.log(line);
  report.steps.push({ at: new Date().toISOString(), msg, ...(extra ? { extra } : {}) });
};

const env = { ...process.env, SIMPAPER_DATA_DIR: join(out, 'data'), SIMPAPER_DEBUG: '1' };
delete env.ELECTRON_RUN_AS_NODE;
// Optional hosting mode preset (--view-mode owned|child), written as the isolated profile's settings.
const viewMode = arg('--view-mode', '');
if (viewMode) {
  mkdirSync(join(out, 'data', 'Simpaper'), { recursive: true });
  writeFileSync(
    join(out, 'data', 'Simpaper', 'settings.json'),
    JSON.stringify({
      version: 2,
      language: 'tr',
      theme: 'system',
      autosaveMinutes: 3,
      verifyAfterSave: true,
      recentLimit: 20,
      csv: { importSeparator: 'auto', exportSeparator: 'auto', exportBom: true },
      engine: { programDir: '', viewMode },
      ui: { ribbonCollapsed: false, quickAccess: ['file.save', 'edit.undo', 'edit.redo'], showStatusBar: true },
    }),
  );
  report.viewMode = viewMode;
}
const app = spawn(exe, [`--remote-debugging-port=${PORT}`, docx], { env, stdio: 'ignore' });
log('started', { pid: app.pid });

let appHwnd = 0;
let cdp;
const shot = async (name) => {
  await sleep(350);
  const r = W.frameRect(appHwnd);
  writeFileSync(join(shots, `${name}.png`), W.captureScreen(r));
  log(`screenshot ${name}.png`);
};
/** Simpaper's owned LibreOffice windows (top-level, owner = app window). */
const ownedViews = () => W.topLevelWindows().filter((w) => w.owner === appHwnd && w.visible && w.pid !== app.pid);
const docs = () => cdp.invoke('documents:list');
async function waitDoc(pred, what, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const d = (await docs()).find(pred);
    if (d && d.state === 'ready') return d;
    await sleep(400);
  }
  throw new Error(`timeout waiting for ${what}`);
}
/** Screen rect of the active document surface (CSS px → screen px; this PC runs at 100 %). */
async function surfaceScreenRect() {
  const r = await cdp.rectOf('.vr-surface');
  const o = W.clientOrigin(appHwnd);
  return r && { x: Math.round(o.x + r.x), y: Math.round(o.y + r.y), width: Math.round(r.width), height: Math.round(r.height) };
}
/** Real input only while Simpaper (or one of its document windows) is in the foreground. */
function assertForeground() {
  const fg = W.foreground();
  const owned = ownedViews().map((w) => w.hwnd);
  if (fg !== appHwnd && !owned.includes(fg)) throw new Error(`foreground is not Simpaper (${JSON.stringify(W.windowRef(fg))})`);
}
/** soffice.bin processes that own a top-level window (Simpaper's engines with a view). */
const sofficePids = () => [...new Set(W.topLevelWindows().filter((w) => /soffice\.bin$/i.test(W.processImage(w.pid))).map((w) => w.pid))];
/**
 * Hang watchdog: Windows flags a window whose thread has not pumped messages for 5 s. Waits until Simpaper's
 * window is responsive again; if it stays hung, dumps the native stacks of Simpaper and its engines and throws.
 */
async function alive(step, graceMs = 8000) {
  const until = Date.now() + graceMs;
  while (W.isHung(appHwnd)) {
    if (Date.now() > until) {
      report.hang = { step, stacks: [] };
      for (const pid of [app.pid, ...sofficePids()]) {
        const file = join(out, `stacks-${pid}.txt`);
        try {
          execFileSync(join(repo, 'vendor/libreoffice/program/python.exe'), [join(repo, 'tests/engine/diagnostics/stackdump.py'), String(pid), file], { timeout: 60_000 });
          report.hang.stacks.push(file);
        } catch (e) {
          report.hang.stacks.push(`${pid}: ${e.message}`);
        }
      }
      throw new Error(`Simpaper stopped responding after: ${step}`);
    }
    await sleep(500);
  }
}
/** Characters typed so far in the active Writer document (doc.info). */
const writerChars = async (docId) => (await cdp.invoke('engine:query', { docId, query: 'doc.info' })).characterCount;

async function clickInDocument(fx = 0.5, fy = 0.35) {
  const s = await surfaceScreenRect();
  const x = Math.round(s.x + s.width * fx);
  const y = Math.round(s.y + s.height * fy);
  const root = W.rootAt(x, y);
  const owned = ownedViews().map((w) => w.hwnd);
  if (root !== appHwnd && !owned.includes(root)) throw new Error(`point ${x},${y} is covered by another window ${JSON.stringify(W.windowRef(root))}`);
  W.click(x, y);
  await sleep(300);
}

try {
  // ------------------------------------------------------------------ window
  for (let i = 0; i < 200 && !appHwnd; i++) {
    const w = W.topLevelWindows().find((x) => x.pid === app.pid && x.visible && x.cls.startsWith('Chrome_WidgetWin') && x.rect.width > 400);
    if (w) appHwnd = w.hwnd;
    else await sleep(200);
  }
  if (!appHwnd) throw new Error('main window did not appear');
  W.setWindowRect(appHwnd, 60, 40, 1600, 1000);
  log('main window', W.windowInfo(appHwnd));
  cdp = await Cdp.connect(PORT);
  log('bringToFront', { ok: W.bringToFront(appHwnd) });

  // ------------------------------------------------------------------ Writer
  const w = await waitDoc((d) => d.kind === 'writer', 'writer document');
  log('writer ready', { docId: w.docId, title: w.title, format: w.format });
  await sleep(1500);
  const views = ownedViews();
  const surf = await surfaceScreenRect();
  log('view placement', { surface: surf, owned: views.map((v) => ({ cls: v.cls, rect: v.rect })) });
  report.placement = { surface: surf, views: views.map((v) => v.rect) };
  await shot('01-writer-open');
  await alive('Writer document shown');

  W.bringToFront(appHwnd);
  await clickInDocument(0.5, 0.25);
  assertForeground();
  W.chord([W.VK.CONTROL, W.VK.END]);
  await sleep(300);
  // Typed like a person: real keys of the active keyboard layout (VK_PACKET input is checked separately).
  const chars0 = await writerChars(w.docId);
  // 40 ms per key (faster than people type): keys injected within a few ms right after a document's first
  // modification lose characters inside LibreOffice, which no keyboard produces (docs/dev/platform.md §10).
  const fallback = [];
  for (const ch of `\n${TYPED}`) {
    fallback.push(...W.typeKeys(ch, W.foreground()));
    await sleep(40);
  }
  await sleep(1200);
  const info1 = await cdp.invoke('engine:query', { docId: w.docId, query: 'doc.info' });
  report.typing = { keys: { expected: TYPED.length, got: info1.characterCount - chars0, fallback } };
  log('after typing', { modified: info1.modified, words: info1.wordCount, ...report.typing.keys });
  await shot('02-writer-typed');
  // Diagnostic: Unicode input as VK_PACKET (on-screen keyboards, some input tools) in the same place.
  const chars1 = await writerChars(w.docId);
  W.typeText(' paket');
  await sleep(1200);
  report.typing.packet = { expected: 6, got: (await writerChars(w.docId)) - chars1 };
  log('VK_PACKET input', report.typing.packet);
  await alive('typing in Writer');

  // Ribbon Bold (via DevTools input) on the whole document.
  assertForeground();
  W.chord([W.VK.CONTROL, W.VK.A]);
  await sleep(300);
  await cdp.click('[data-control-id="bold"]');
  await sleep(800);
  const pressed = await cdp.eval(`document.querySelector('[data-control-id="bold"]')?.getAttribute('aria-pressed')`);
  log('bold via ribbon', { ariaPressed: pressed });
  await shot('03-writer-bold');

  // Dropdown over the document (freeze-frame).
  const combo = await cdp.eval(`(() => { const el = [...document.querySelectorAll('[data-control-id]')].find(e => /size/i.test(e.getAttribute('data-control-id')) && e.getBoundingClientRect().width > 0); return el ? el.getAttribute('data-control-id') : null; })()`);
  if (combo) {
    const btn = await cdp.rectOf(`[data-control-id="${combo}"] ~ .rb-combo__arrow, [data-control-id="${combo}"] button, [data-control-id="${combo}"] [aria-haspopup]`);
    if (btn) {
      await cdp.clickAt(btn.x + btn.width - 6, btn.y + btn.height / 2);
      await sleep(700);
      log('dropdown opened', { control: combo, frozen: await cdp.eval(`!!document.querySelector('.vr-surface[data-frozen]')`) });
      await shot('04-writer-dropdown');
      await cdp.key('Escape', 'Escape', 27);
      await sleep(500);
    }
  }

  // Save with Ctrl+S (typed in the document) and verify the file independently.
  await clickInDocument(0.5, 0.25);
  assertForeground();
  const before = readFileSync(docx);
  W.chord([W.VK.CONTROL, W.VK.S]);
  let saved = false;
  for (let i = 0; i < 60 && !saved; i++) {
    await sleep(500);
    const prompt = await cdp.eval(`(() => { const d = document.querySelector('[role="alertdialog"], [role="dialog"][aria-modal="true"]'); return d ? d.textContent.slice(0, 200) : null; })()`);
    if (prompt) {
      log('save prompt shown', { text: prompt });
      await shot('05-writer-save-prompt');
      const anyway = await cdp.eval(`(() => { const b = [...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button')].find(b => /Yine de kaydet|Save anyway/.test(b.textContent)); if (b) { b.click(); return true } return false })()`);
      log('answered save prompt', { anyway });
    }
    const d = (await docs()).find((x) => x.docId === w.docId);
    saved = d && !d.modified && !readFileSync(docx).equals(before);
  }
  const xml = await (await JSZip.loadAsync(readFileSync(docx))).file('word/document.xml').async('string');
  const text = xml.replace(/<[^>]+>/g, '');
  // Writer's AutoCorrect turns ' - ' into an en dash.
  const dashes = (t) => t.replace(/–/g, '-');
  report.writerSave = { saved, containsTyped: dashes(text).includes(TYPED), bold: /<w:b\/>|<w:b w:val="(true|1)"\/>/.test(xml) };
  log('writer save verified', report.writerSave);
  await alive('saving the Writer document');

  // Backstage.
  await cdp.click('.rb-filetab');
  await sleep(700);
  await shot('06-backstage');
  await cdp.key('Escape', 'Escape', 27);
  await sleep(600);

  // ------------------------------------------------------------------ Calc
  await cdp.invoke('documents:open', { path: xlsx });
  const c = await waitDoc((d) => d.kind === 'calc', 'calc document');
  await sleep(1500);
  await shot('07-calc-open');
  await cdp.invoke('engine:query', { docId: c.docId, query: 'calc.gotoCell', params: { reference: 'H2' } });
  await cdp.invoke('view:focus', { docId: c.docId });
  await sleep(400);
  W.bringToFront(appHwnd);
  await sleep(200);
  await cdp.invoke('view:focus', { docId: c.docId });
  await sleep(300);
  assertForeground();
  const calcFallback = W.typeKeys('=TOPLA(1,5;2,25)\n', W.foreground());
  if (calcFallback.length) log('calc typing needed VK_PACKET', { chars: calcFallback });
  await sleep(800);
  await cdp.invoke('engine:query', { docId: c.docId, query: 'calc.gotoCell', params: { reference: 'H2' } });
  await sleep(500);
  const cell = await cdp.invoke('engine:query', { docId: c.docId, query: 'calc.activeCell' });
  report.calc = { address: cell.address, value: cell.value, display: cell.display, localFormula: cell.localFormula };
  log('calc cell after typing', report.calc);
  await alive('typing a formula in Calc');
  await shot('08-calc-formula');

  // ------------------------------------------------------------------ Impress
  await cdp.invoke('documents:open', { path: pptx });
  const p = await waitDoc((d) => d.kind === 'impress', 'impress document');
  await sleep(1500);
  const s1 = await cdp.invoke('engine:query', { docId: p.docId, query: 'impress.slides' });
  const statusText = () => cdp.eval(`document.querySelector('.vr-status__left')?.textContent ?? ''`);
  const status1 = await statusText();
  await shot('09-impress-open');
  await cdp.click('[data-control-id="newSlide"]');
  await sleep(1500);
  const s2 = await cdp.invoke('engine:query', { docId: p.docId, query: 'impress.slides' });
  // The status bar counts slides from 1; the slide pane (LibreOffice's own) must be on screen: see the shots.
  report.impress = { before: s1.slides.length, after: s2.slides.length, statusBefore: status1, statusAfter: await statusText() };
  log('impress new slide', report.impress);
  await alive('Impress new slide');
  await shot('10-impress-newslide');

  // ------------------------------------------------------------------ PDF
  await cdp.invoke('documents:open', { path: pdfText });
  await waitDoc((d) => d.kind === 'pdf' && d.title === basename(pdfText), 'pdf document');
  await sleep(2500);
  await shot('11-pdf-text');
  await cdp.invoke('documents:open', { path: pdfForm });
  await waitDoc((d) => d.kind === 'pdf' && d.title === basename(pdfForm), 'pdf form');
  await sleep(2500);
  await shot('12-pdf-form');
  await alive('opening PDFs');

  // ------------------------------------------------------------------ window follows (owned view)
  await cdp.invoke('documents:activate', { docId: w.docId });
  await sleep(1200);
  const beforeMove = ownedViews().map((v) => v.rect);
  W.setWindowRect(appHwnd, 260, 90, 1600, 1000);
  await sleep(1200);
  const afterMove = ownedViews().map((v) => v.rect);
  report.follow = { beforeMove, afterMove, surface: await surfaceScreenRect() };
  log('after window move', report.follow);
  await alive('moving the window');
  await shot('13-writer-moved');

  // ------------------------------------------------------------------ light theme
  await cdp.invoke('app:settings:update', { theme: 'light' });
  await sleep(1500);
  await shot('14-writer-light');
  await cdp.invoke('documents:activate', { docId: c.docId });
  await sleep(1500);
  await shot('15-calc-light');
  await cdp.invoke('documents:activate', { docId: p.docId });
  await sleep(1500);
  await shot('16-impress-light');
  // Quiet observation: a hang may start seconds after the last action.
  await sleep(10_000);
  await alive('10 s without input at the end');
  report.ok = true;
} catch (err) {
  report.ok = false;
  report.error = String(err?.stack ?? err);
  log('FAILED', { error: String(err?.message ?? err) });
  try {
    if (appHwnd) await shot('99-failure');
  } catch {
    // ignore
  }
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  cdp?.close();
  try {
    execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // already gone
  }
  log('done', { ok: report.ok });
}
