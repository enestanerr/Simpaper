// On-screen check (opens windows and sends input: only with the owner's permission, on an idle PC).
// Theme tokens in the real renderer, which jsdom cannot evaluate:
// 1. the accent tokens resolve in every module and theme, also in <body> where dialogs and menus render;
// 2. text in the accent colour keeps 4.5:1 on the surfaces it is used on (ribbon, popups, chips);
// 3. a menu opened from the title bar shows its check marks in the accent colour;
// 4. Options: every checkbox sits beside its label; screenshots in the light and the dark theme.
// Only this script's own Simpaper instance (isolated data folder) is touched.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchSimpaper, repo, requireIdle, settingsPreset, sleep } from '../harness.mjs';

requireIdle(60_000, 'theme');
const out = join(repo, 'test-output/gui/themecheck');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const shots = join(out, 'shots');
const report = { problems: [] };
const s = await launchSimpaper({ out, port: 9395, settings: settingsPreset({ language: 'tr', theme: 'light' }), tag: 'theme' });

/** Renderer helpers: colours resolved by the browser, composited on a canvas, WCAG contrast. */
const HELPERS = `(() => {
  if (window.__themecheck) return;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const cx = canvas.getContext('2d', { willReadFrequently: true });
  const rgb = (layers) => {
    cx.clearRect(0, 0, 1, 1);
    for (const c of layers) {
      cx.fillStyle = '#010203';
      cx.fillStyle = c;
      if (cx.fillStyle === '#010203') throw new Error('the canvas cannot parse ' + c);
      cx.fillRect(0, 0, 1, 1);
    }
    return [...cx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
  /** Computed colour of a token on an element with data-module (resolved like the app resolves it). */
  const resolve = (module, prop, token) => {
    const el = document.createElement('div');
    el.dataset.module = module;
    el.style[prop] = 'var(' + token + ')';
    document.body.append(el);
    const value = getComputedStyle(el)[prop];
    el.remove();
    return value;
  };
  window.__themecheck = { rgb, contrast, resolve };
})()`;

const tokensIn = (selector) => `(() => {
  const cs = getComputedStyle(${selector});
  return Object.fromEntries(['--accent', '--accent-text', '--accent-soft', '--accent-softer'].map((p) => [p, cs.getPropertyValue(p).trim()]));
})()`;

try {
  await sleep(2500);
  await s.cdp.eval(HELPERS);

  // 1 + 2: tokens and contrast for every module in both themes.
  report.modules = [];
  for (const theme of ['light', 'dark']) {
    await s.cdp.eval(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    await sleep(200);
    for (const module of ['home', 'writer', 'calc', 'impress', 'pdf']) {
      const m = await s.cdp.eval(`(() => {
        const { rgb, contrast, resolve } = window.__themecheck;
        const module = ${JSON.stringify(module)};
        const text = rgb([resolve(module, 'color', '--accent-text')]);
        const on = (surface) => rgb([resolve(module, 'backgroundColor', surface)]);
        const surfaces = { ribbon: on('--bg-ribbon'), ribbonTabs: on('--bg-ribbon-tabs'), surface: on('--bg-surface'), surface2: on('--bg-surface-2') };
        const chip = rgb([resolve(module, 'backgroundColor', '--bg-surface'), resolve(module, 'backgroundColor', '--accent-soft')]);
        const probe = document.createElement('div');
        probe.dataset.module = module;
        document.body.append(probe);
        const cs = getComputedStyle(probe);
        const empty = ['--accent', '--accent-text', '--accent-soft', '--accent-softer'].filter((p) => !cs.getPropertyValue(p).trim());
        probe.remove();
        return {
          empty,
          contrast: { ...Object.fromEntries(Object.entries(surfaces).map(([k, v]) => [k, contrast(text, v)])), chip: contrast(text, chip) },
          chipVisible: contrast(chip, surfaces.surface) > 1.05,
        };
      })()`);
      const entry = { theme, module, ...m };
      report.modules.push(entry);
      if (m.empty.length) report.problems.push(`${theme}/${module}: unresolved ${m.empty.join(', ')}`);
      for (const [surface, ratio] of Object.entries(m.contrast)) if (ratio < 4.5) report.problems.push(`${theme}/${module}: accent text on ${surface} ${ratio}:1`);
      if (!m.chipVisible) report.problems.push(`${theme}/${module}: the chip background does not stand out`);
    }
  }
  await s.cdp.eval(`document.documentElement.dataset.theme = 'light'`);
  report.root = await s.cdp.eval(tokensIn('document.documentElement'));
  report.body = await s.cdp.eval(tokensIn('document.body'));
  report.htmlModule = await s.cdp.eval(`document.documentElement.dataset.module`);
  if (report.htmlModule !== 'home') report.problems.push(`<html data-module> is ${report.htmlModule} on the start screen`);
  if (Object.values(report.body).some((v) => !v)) report.problems.push('accent tokens missing in <body> (dialogs, menus)');

  // 3: a real menu in <body>: the check marks of the Quick Access Toolbar menu.
  await s.cdp.click('.vr-qat__more');
  await sleep(600);
  report.menu = await s.cdp.eval(`(() => {
    const { rgb } = window.__themecheck;
    const check = document.querySelector('.vr-popup .vr-menu__check');
    if (!check) return null;
    return { inBody: check.closest('.vr-app') === null, check: rgb([getComputedStyle(check).color]), accentText: rgb([window.__themecheck.resolve('home', 'color', '--accent-text')]) };
  })()`);
  s.log('menu', report.menu);
  if (!report.menu) report.problems.push('the Quick Access Toolbar menu showed no check mark');
  else if (report.menu.check.join() !== report.menu.accentText.join()) report.problems.push('menu check marks are not in the accent colour');
  await s.cdp.key('Escape', 'Escape', 27);
  await sleep(400);

  // 4: Options — checkbox rows, light and dark.
  await s.cdp.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Seçenekler')?.click()`);
  await sleep(1200);
  const layout = `[...document.querySelectorAll('.vr-options-page label.vr-checkbox')].map((l) => {
    const box = l.querySelector('input').getBoundingClientRect();
    const text = l.querySelector('span')?.getBoundingClientRect();
    const beside = !!text && box.right <= text.left && box.bottom > text.top && box.top < text.bottom;
    return { label: l.textContent.trim().slice(0, 40), beside };
  })`;
  report.checkboxes = await s.cdp.eval(layout);
  for (const c of report.checkboxes.filter((x) => !x.beside)) report.problems.push(`checkbox not beside its label: ${c.label}`);
  if (report.checkboxes.length < 5) report.problems.push(`only ${report.checkboxes.length} checkboxes found on the Options page`);
  await s.shot(shots, 'options-light');
  await s.cdp.eval(`[...document.querySelectorAll('input[name="vr-theme"]')][2]?.click()`);
  await sleep(900);
  report.darkApplied = await s.cdp.eval(`document.documentElement.dataset.theme`);
  if (report.darkApplied !== 'dark') report.problems.push('choosing the dark theme in Options did not apply it');
  await s.shot(shots, 'options-dark');
  await s.cdp.eval(`document.querySelector('.vr-filetypes')?.scrollIntoView({ block: 'center' })`);
  await sleep(500);
  await s.shot(shots, 'options-file-types-dark');
  await s.alive('options');
} catch (err) {
  report.error = String(err?.stack ?? err);
  s.log('FAILED', { error: String(err?.message ?? err) });
} finally {
  s.close();
  report.ok = !report.error && report.problems.length === 0;
  writeFileSync(join(out, 'report.json'), JSON.stringify({ ...report, steps: s.steps }, null, 2));
  console.log(report.ok ? 'themecheck: ok' : `themecheck: ${report.error ? 'error' : report.problems.join('; ')}`);
}
