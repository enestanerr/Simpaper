// On-screen check (opens windows and sends real input: only with the owner's permission, on an idle PC).
// After a click into the document (LibreOffice has the keyboard focus), do Simpaper's own controls get the keys?
// 1. real click into the font name box of the ribbon, type a letter: box or document?
// 2. real click on the File tab, real Esc: does the backstage close?
// 3. real click on a ribbon menu's arrow (Underline): do the arrows and Esc reach the menu, and does the document get
//    the keyboard back once it closes?
// 4. a prompt over the document (close with unsaved changes), real Esc: cancelled, keyboard back in the document?
// Only this script's own Simpaper instance (isolated data folder) is touched.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as W from '../win32.mjs';
import { launchSimpaper, repo, requireIdle, settingsPreset, sleep } from '../harness.mjs';

requireIdle(60_000, 'focus');
const out = join(repo, 'test-output/gui/focuscheck');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'files'), { recursive: true });
const shots = join(out, 'shots');
const docx = join(out, 'files', 'Odak.docx');
copyFileSync(join(repo, 'tests/corpus/generated/docx-basic.docx'), docx);
const report = {};
const s = await launchSimpaper({ out, port: 9390, settings: settingsPreset({ language: 'tr', theme: 'light' }), tag: 'focus' });

const focusOwner = () => {
  const h = W.keyboardFocus();
  if (!h) return 'none';
  const pid = W.windowInfo(h).pid;
  return pid === s.app.pid ? 'simpaper' : W.processImage(pid).toLowerCase().endsWith('soffice.bin') ? 'engine' : 'other';
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
  // Giving the keyboard back to the document is asynchronous (view:focus over IPC): measure again once it settled.
  await sleep(1500);
  report.focusAfterEscSettled = focusOwner();
  await s.shot(shots, '3-after-esc');

  // 3. A ribbon menu opened with a real click (Underline) while the document has the keyboard. Clicks on the ribbon
  //    leave the keyboard in the document (keyboardFocus.ts); an open menu holds it (Popup.tsx).
  const menuOpen = () => s.cdp.eval(`Boolean(document.querySelector('.vr-popup [role="menu"]'))`);
  await realClickSelector('.rb-split:has([data-control-id="underline"]) > .rb-split__arrow', 'Underline menu arrow');
  report.menuOpens = Boolean(await waitFor(menuOpen, 3000));
  await sleep(300);
  report.focusWithMenu = focusOwner();
  report.domFocusInMenu = await s.cdp.eval(`Boolean(document.activeElement?.closest('.vr-popup'))`);
  await s.shot(shots, '4-menu');
  s.assertForeground();
  W.chord([W.VK.DOWN]);
  await sleep(300);
  report.arrowMovesInMenu = await s.cdp.eval(`(() => { const items = [...document.querySelectorAll('.vr-popup [role^="menuitem"]')]; return items.indexOf(document.activeElement) === 1; })()`);
  W.chord([W.VK.ESCAPE]);
  report.escClosesMenu = Boolean(await waitFor(async () => !(await menuOpen()), 1500));
  if (!report.escClosesMenu) {
    await s.clickInDocument(0.5, 0.3);
    report.clickInDocumentClosesMenu = Boolean(await waitFor(async () => !(await menuOpen()), 2000));
  }
  report.focusAfterMenu = focusOwner();
  // As after the backstage: the document gets the keyboard back over IPC.
  await sleep(1500);
  report.focusAfterMenuSettled = focusOwner();

  // 4. A prompt over the document (closing it with unsaved changes), answered with a real Esc: the prompt has the
  //    keyboard, and the document gets it back once the prompt and its freeze-frame are gone.
  const promptOpen = () => s.cdp.eval(`Boolean(document.querySelector('[role="alertdialog"]'))`);
  await s.cdp.eval(`void window.simpaperIpc.invoke('documents:close', { docId: ${JSON.stringify(doc.docId)} }).then((r) => (window.__closeOutcome = r)); true`);
  report.promptShown = Boolean(await waitFor(promptOpen, 5000));
  await sleep(500);
  report.focusWithPrompt = focusOwner();
  await s.shot(shots, '5-prompt');
  s.assertForeground();
  W.chord([W.VK.ESCAPE]);
  report.escAnswersPrompt = Boolean(await waitFor(async () => !(await promptOpen()), 3000));
  report.closeOutcome = await waitFor(() => s.cdp.eval('window.__closeOutcome ?? null'), 3000);
  report.documentStillOpen = (await s.docs()).some((d) => d.docId === doc.docId);
  await sleep(1500);
  report.focusAfterPromptSettled = focusOwner();
} catch (err) {
  report.error = String(err?.stack ?? err);
  s.log('FAILED', { error: String(err?.message ?? err) });
} finally {
  s.close();
  writeFileSync(join(out, 'report.json'), JSON.stringify({ ...report, steps: s.steps }, null, 2));
  console.log(JSON.stringify(report));
}
