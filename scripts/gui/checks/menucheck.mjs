// On-screen check (opens windows and sends real input: only with the owner's permission, on an idle PC).
// Where Simpaper has the keyboard (start screen), a menu opened with a real click takes it: the arrows move in the
// menu, Esc closes it and the focus returns to its button; opened again with Enter, Tab closes it.
// (Until 2026-09-30 the focus stayed on the button: the keys did nothing and Esc left the menu open.)
// Only this script's own Simpaper instance (isolated data folder) is touched.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as W from '../win32.mjs';
import { launchSimpaper, repo, requireIdle, settingsPreset, sleep } from '../harness.mjs';

requireIdle(60_000, 'menu');
const out = join(repo, 'test-output/gui/menucheck');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const shots = join(out, 'shots');
const report = {};
const s = await launchSimpaper({ out, port: 9396, settings: settingsPreset({ language: 'tr', theme: 'light' }), tag: 'menu' });

const BUTTON = '.vr-qat__more';
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
async function waitFor(pred, ms, step = 150) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await pred();
    if (v) return v;
    await sleep(step);
  }
  return null;
}
const menuOpen = () => s.cdp.eval(`Boolean(document.querySelector('.vr-popup [role="menu"]'))`);
const menuClosed = async () => !(await menuOpen());
const focus = () =>
  s.cdp.eval(`(() => {
    const a = document.activeElement;
    const items = [...document.querySelectorAll('.vr-popup [role^="menuitem"]')];
    return { inMenu: Boolean(a?.closest('.vr-popup')), item: items.indexOf(a), onButton: a?.matches(${JSON.stringify(BUTTON)}) ?? false };
  })()`);
const key = async (vk) => {
  s.assertForeground();
  W.chord([vk]);
  await sleep(250);
};

try {
  await sleep(2500);
  await realClickSelector(BUTTON, 'Quick Access Toolbar menu button');
  report.opened = Boolean(await waitFor(menuOpen, 3000));
  await sleep(300);
  report.atOpen = await focus();
  await key(W.VK.DOWN);
  report.afterDown = await focus();
  await s.shot(shots, '1-menu');
  await key(W.VK.ESCAPE);
  report.escCloses = Boolean(await waitFor(menuClosed, 2000));
  report.afterEsc = await focus();
  await key(W.VK.RETURN);
  report.enterOpens = Boolean(await waitFor(menuOpen, 2000));
  report.atEnterOpen = await focus();
  await key(W.VK.TAB);
  report.tabCloses = Boolean(await waitFor(menuClosed, 2000));
  await s.alive('menu');
} catch (err) {
  report.error = String(err?.stack ?? err);
  s.log('FAILED', { error: String(err?.message ?? err) });
} finally {
  s.close();
  report.ok = Boolean(
    !report.error &&
      report.opened &&
      report.atOpen?.inMenu &&
      report.afterDown?.item === report.atOpen.item + 1 &&
      report.escCloses &&
      report.afterEsc?.onButton &&
      report.enterOpens &&
      report.atEnterOpen?.inMenu &&
      report.tabCloses,
  );
  writeFileSync(join(out, 'report.json'), JSON.stringify({ ...report, steps: s.steps }, null, 2));
  console.log(JSON.stringify(report));
}
