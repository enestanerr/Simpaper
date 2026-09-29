// On-screen check (opens windows and sends real input: only with the owner's permission, on an idle PC).
// After a click into the document (LibreOffice has the keyboard focus), do Varak's own controls get the keys?
// 1. real click into the font name box of the ribbon, type a letter: box or document?
// 2. real click on the File tab, real Esc: does the backstage close?
// Only this script's own Varak instance (isolated data folder) is touched.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as W from '../win32.mjs';
import { launchVarak, repo, requireIdle, settingsPreset, sleep } from '../harness.mjs';

requireIdle(60_000, 'focus');
const out = join(repo, 'test-output/gui/focuscheck');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'files'), { recursive: true });
const shots = join(out, 'shots');
const docx = join(out, 'files', 'Odak.docx');
copyFileSync(join(repo, 'tests/corpus/generated/docx-basic.docx'), docx);
const report = {};
const s = await launchVarak({ out, port: 9390, settings: settingsPreset({ language: 'tr', theme: 'light' }), tag: 'focus' });

const focusOwner = () => {
  const h = W.keyboardFocus();
  if (!h) return 'none';
  const pid = W.windowInfo(h).pid;
  return pid === s.app.pid ? 'varak' : W.processImage(pid).toLowerCase().endsWith('soffice.bin') ? 'engine' : 'other';
};
async function realClickSelector(selector, what) {
  const r = await s.cdp.rectOf(selector);
  if (!r) throw new Error(`no element for ${what}`);
  const o = W.clientOrigin(s.appHwnd);
  const x = Math.round(o.x + r.x + r.width / 2);
  const y = Math.round(o.y + r.y + r.height / 2);
  const root = W.rootAt(x, y);
  if (root !== s.appHwnd) throw new Error(`${what}: point covered by ${JSON.stringify(W.windowRef(root))}`);
  W.bringToFront(s.appHwnd);
  await sleep(150);
  W.click(x, y);
  s.log(`real click: ${what}`, { x, y });
}
async function waitFor(pred, ms, step = 250) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await pred();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

try {
  const doc = await s.open(docx, 'writer');
  await sleep(2500);
  report.focusAtStart = focusOwner();
  await s.clickInDocument(0.5, 0.3);
  await sleep(500);
  report.focusAfterDocClick = focusOwner();

  // 0. As in Office, switching ribbon tabs leaves the keyboard in the document.
  await realClickSelector('[data-tab-id="insert"]', 'ribbon Insert tab');
  await sleep(500);
  report.focusAfterRibbonTab = focusOwner();
  s.assertForeground();
  W.typeKeys('K', W.foreground());
  report.letterAfterRibbonTabInDocument = Boolean(await waitFor(async () => (await s.docs()).find((d) => d.docId === doc.docId)?.modified, 3000));
  await realClickSelector('[data-tab-id="home"]', 'ribbon Home tab');
  await sleep(500);

  // 1. Font name box of the ribbon.
  const fontBox = 'input[data-control-id="fontName"]';
  report.fontBoxFound = Boolean(await s.cdp.rectOf(fontBox));
  await realClickSelector(fontBox, 'font name box');
  await sleep(500);
  report.focusAfterBoxClick = focusOwner();
  report.domFocusInBox = await s.cdp.eval(`document.activeElement?.matches(${JSON.stringify(fontBox)}) ?? false`);
  const before = await s.cdp.eval(`document.querySelector(${JSON.stringify(fontBox)}).value`);
  const modifiedBefore = (await s.docs()).find((d) => d.docId === doc.docId)?.modified;
  s.assertForeground();
  W.typeKeys('Q', W.foreground());
  await sleep(800);
  const after = await s.cdp.eval(`document.querySelector(${JSON.stringify(fontBox)}).value`);
  report.letterInBox = after !== before && after.includes('Q');
  report.documentChanged = !modifiedBefore && Boolean((await s.docs()).find((d) => d.docId === doc.docId)?.modified);
  await s.shot(shots, '1-font-box');
  W.chord([W.VK.ESCAPE]);
  await sleep(500);

  // 2. File tab, then Esc.
  await realClickSelector('.rb-filetab', 'File tab');
  report.backstageOpens = Boolean(await waitFor(() => s.cdp.eval(`Boolean(document.querySelector('.vr-bs-nav'))`), 5000));
  report.focusInBackstage = focusOwner();
  report.domFocusInBackstage = await s.cdp.eval(`document.activeElement ? document.activeElement.className : null`);
  await s.shot(shots, '2-backstage');
  s.assertForeground();
  W.chord([W.VK.ESCAPE]);
  report.escClosesBackstage = Boolean(await waitFor(async () => !(await s.cdp.eval(`Boolean(document.querySelector('.vr-bs-nav'))`)), 4000));
  report.focusAfterEsc = focusOwner();
  await s.shot(shots, '3-after-esc');
} catch (err) {
  report.error = String(err?.stack ?? err);
  s.log('FAILED', { error: String(err?.message ?? err) });
} finally {
  s.close();
  writeFileSync(join(out, 'report.json'), JSON.stringify({ ...report, steps: s.steps }, null, 2));
  console.log(JSON.stringify(report));
}
