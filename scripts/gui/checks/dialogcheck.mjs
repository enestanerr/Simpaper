// On-screen check: a LibreOffice dialog opened from the ribbon gets the keyboard focus (a real Esc closes it), the
// ribbon is disabled while it is open and usable again afterwards.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as W from '../win32.mjs';
import { launchVarak, repo, requireIdle, settingsPreset, sleep } from '../harness.mjs';

requireIdle(60_000, 'dialog');
const out = join(repo, 'test-output/gui/dialogcheck');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'files'), { recursive: true });
const docx = join(out, 'files', 'Rapor.docx');
copyFileSync(join(repo, 'tests/corpus/generated/docx-basic.docx'), docx);
const visible = (hwnd) => W.isWindow(hwnd) && W.windowInfo(hwnd).visible;
const boldDisabled = (s) => s.cdp.eval(`document.querySelector('[data-control-id="bold"]')?.getAttribute('aria-disabled') === 'true'`);

const report = { attempts: [] };
const s = await launchVarak({ out, port: 9360, settings: settingsPreset({ language: 'tr' }), tag: 'dialog' });
try {
  await s.open(docx, 'writer');
  await sleep(2500);
  for (const group of ['paragraph', 'font']) {
    const before = new Set(W.topLevelWindows().filter((w) => w.visible).map((w) => w.hwnd));
    await s.cdp.click(`[data-group-id="${group}"] .rb-launcher`);
    let dialog = null;
    for (let i = 0; i < 40 && !dialog; i++) {
      await sleep(250);
      dialog = W.topLevelWindows().find((w) => w.visible && !before.has(w.hwnd) && /soffice/i.test(W.processImage(w.pid)) && w.rect.width > 200) ?? null;
    }
    const attempt = { group, shown: Boolean(dialog) };
    if (dialog) {
      await sleep(700);
      attempt.foreground = W.foreground() === dialog.hwnd;
      attempt.ribbonDisabledWhileOpen = await boldDisabled(s);
      await s.shot(join(out, 'shots'), `dialog-${group}`);
      if (attempt.foreground) W.chord([W.VK.ESCAPE]);
      for (let i = 0; i < 20 && visible(dialog.hwnd); i++) await sleep(250);
      attempt.closedByEsc = !visible(dialog.hwnd);
      if (!attempt.closedByEsc) {
        // Leave nothing open for the next attempt: activate the dialog like a click would, then Esc.
        W.bringToFront(dialog.hwnd);
        await sleep(300);
        if (W.foreground() === dialog.hwnd) W.chord([W.VK.ESCAPE]);
        for (let i = 0; i < 20 && visible(dialog.hwnd); i++) await sleep(250);
      }
      await sleep(1000);
      attempt.ribbonEnabledAfter = !(await boldDisabled(s));
    }
    report.attempts.push(attempt);
    s.log('attempt', attempt);
    await s.alive(`dialog ${group}`);
  }
} catch (err) {
  report.error = String(err?.stack ?? err);
  s.log('FAILED', { error: String(err?.message ?? err) });
} finally {
  s.close();
  writeFileSync(join(out, 'report.json'), JSON.stringify({ ...report, steps: s.steps }, null, 2));
}
