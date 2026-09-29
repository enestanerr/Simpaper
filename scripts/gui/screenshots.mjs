// README screenshots (docs/DEMO.md) plus on-screen checks the GUI spike does not cover: PDF annotations saved and
// read back, KeyTips, a LibreOffice dialog over the document, quitting with unsaved changes.
// Packaged app, light theme, window 1600 × 1000, sample documents copied to %PUBLIC%\Documents so that no personal
// data appears in paths. Captures Varak's window only — review every image before committing it.
// OPENS WINDOWS AND SENDS INPUT — run only with the machine owner's permission, while nobody uses the PC.
//   node scripts/gui/screenshots.mjs [--lang tr|en|both] [--out test-output/screenshots] [--idle-ms 60000]
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import * as W from './win32.mjs';
import { launchVarak, repo, requireIdle, settingsPreset, sleep } from './harness.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const langs = arg('--lang', 'both') === 'both' ? ['tr', 'en'] : [arg('--lang')];
const out = resolve(repo, arg('--out', 'test-output/screenshots'));
requireIdle(Number(arg('--idle-ms', '60000')), 'shots');

const CORPUS = join(repo, 'tests/corpus/generated');
const LABELS = {
  tr: {
    folder: 'Varak Örnekleri',
    files: { docx: 'Rapor.docx', xlsx: 'Bütçe.xlsx', pptx: 'Sunum.pptx', pdf: 'Belge.pdf', doc: 'Eski rapor.doc' },
    open: 'Aç',
    note: 'Kontrol edildi – Ayşe',
    discard: 'Kaydetme',
  },
  en: {
    folder: 'Varak Samples',
    files: { docx: 'Report.docx', xlsx: 'Budget.xlsx', pptx: 'Presentation.pptx', pdf: 'Document.pdf', doc: 'Old report.doc' },
    open: 'Open',
    note: 'Checked – Ayşe',
    discard: "Don't save",
  },
};
const SOURCES = { docx: 'docx-basic.docx', xlsx: 'xlsx-basic.xlsx', pptx: 'pptx-basic.pptx', pdf: 'pdf-text.pdf', doc: 'derived/docx-basic.doc' };

/** Annotation subtypes on the first page of a saved PDF (read with pdf-lib, independent of pdf.js). */
async function annotationsOnFirstPage(path) {
  const pdf = await PDFDocument.load(readFileSync(path), { ignoreEncryption: true });
  const annots = pdf.getPage(0).node.Annots();
  if (!annots) return [];
  return annots.asArray().map((ref) => pdf.context.lookup(ref).get(PDFName.of('Subtype'))?.toString() ?? '?');
}

async function run(lang, port) {
  const L = LABELS[lang];
  const dir = join(out, lang);
  const shots = join(dir, 'shots');
  rmSync(dir, { recursive: true, force: true });
  const samples = join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Documents', L.folder);
  rmSync(samples, { recursive: true, force: true });
  mkdirSync(samples, { recursive: true });
  const path = {};
  for (const [key, name] of Object.entries(L.files)) {
    path[key] = join(samples, name);
    copyFileSync(join(CORPUS, SOURCES[key]), path[key]);
  }
  const report = { lang, checks: {} };
  const s = await launchVarak({ out: dir, port, settings: settingsPreset({ language: lang, theme: 'light' }), tag: `shots:${lang}` });
  try {
    // ------------------------------------------------------------ Writer
    const writer = await s.open(path.docx, 'writer');
    await sleep(2500);
    await s.alive('Writer opened');
    await s.shot(shots, `writer-home-${lang}`);

    // ------------------------------------------------------------ Calc: a lookup formula on the second sheet
    const calc = await s.open(path.xlsx, 'calc');
    await sleep(2000);
    await s.cdp.invoke('engine:query', { docId: calc.docId, query: 'calc.gotoCell', params: { reference: 'Hesaplar.B5' } });
    await sleep(1200);
    report.checks.calcCell = await s.cdp.invoke('engine:query', { docId: calc.docId, query: 'calc.activeCell' });
    await s.alive('Calc opened');
    await s.shot(shots, `calc-formulas-${lang}`);

    // ------------------------------------------------------------ Impress: slide pane with the second slide selected
    const impress = await s.open(path.pptx, 'impress');
    await sleep(2000);
    await s.cdp.invoke('engine:query', { docId: impress.docId, query: 'impress.gotoSlide', params: { index: 1 } });
    await sleep(1500);
    await s.alive('Impress opened');
    await s.shot(shots, `impress-slides-${lang}`);

    // ------------------------------------------------------------ PDF: highlight + free text, save, read back
    const pdf = await s.open(path.pdf, 'pdf');
    await sleep(2500);
    await s.cdp.click('[data-tab-id="annotate"]');
    await sleep(500);
    // Highlight the first line the way a person does: Highlight tool, drag across the text.
    await s.cdp.click('[data-control-id="aHighlight"]');
    await sleep(500);
    const line = await s.cdp.eval(`(() => {
      const e = [...document.querySelectorAll('.textLayer span')].find((x) => x.textContent.includes('Pijamalı hasta'));
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`);
    if (line) await s.cdp.drag(line.x + 2, line.y + line.height / 2, line.x + line.width - 2, line.y + line.height / 2);
    await sleep(900);
    const highlighted = await s.cdp.eval(`document.querySelectorAll('.highlightEditor').length`);
    await s.cdp.click('[data-control-id="aFreeText"]');
    await sleep(400);
    const page = await s.cdp.rectOf('.page[data-page-number="1"]');
    await s.cdp.clickAt(page.x + page.width * 0.52, page.y + page.height * 0.47);
    await sleep(500);
    await s.cdp.send('Input.insertText', { text: L.note });
    await sleep(400);
    await s.cdp.click('[data-control-id="aSelect"]');
    await sleep(1200);
    await s.alive('PDF annotated');
    await s.shot(shots, `pdf-annotate-${lang}`);
    await s.cdp.click('[data-tab-id="home"]');
    await sleep(300);
    const before = readFileSync(path.pdf);
    await s.cdp.click('[data-control-id="save"]');
    let saved = false;
    for (let i = 0; i < 60 && !saved; i++) {
      await sleep(500);
      const d = (await s.docs()).find((x) => x.docId === pdf.docId);
      saved = Boolean(d && !d.modified && !readFileSync(path.pdf).equals(before));
    }
    report.checks.pdf = { highlighted, saved, annotations: saved ? await annotationsOnFirstPage(path.pdf) : [] };
    s.log('pdf saved', report.checks.pdf);

    // ------------------------------------------------------------ File backstage, Open page with the recent files
    await s.cdp.click('.rb-filetab');
    await sleep(600);
    await s.cdp.eval(`[...document.querySelectorAll('.vr-bs-nav__item')].find((b) => b.textContent.trim() === ${JSON.stringify(L.open)})?.click()`);
    await sleep(900);
    await s.shot(shots, `backstage-open-${lang}`);
    await s.cdp.key('Escape', 'Escape', 27);
    await sleep(700);

    // ------------------------------------------------------------ loss warning: Ctrl+S on a legacy .doc
    const doc = await s.open(path.doc, 'writer');
    await sleep(2500);
    await s.clickInDocument(0.5, 0.3);
    await s.typeHuman(' ');
    await sleep(600);
    s.assertForeground();
    W.chord([W.VK.CONTROL, W.VK.S]);
    let prompt = null;
    for (let i = 0; i < 40 && !prompt; i++) {
      await sleep(250);
      prompt = await s.cdp.eval(`document.querySelector('[role="alertdialog"], [role="dialog"][aria-modal="true"]')?.textContent?.slice(0, 160) ?? null`);
    }
    report.checks.lossWarning = { shown: Boolean(prompt), docId: doc.docId };
    if (prompt) {
      await s.shot(shots, `loss-warning-${lang}`);
      await s.cdp.key('Escape', 'Escape', 27);
      await sleep(700);
    }

    if (lang === 'tr') {
      // ---------------------------------------------------------- KeyTips (Alt on the ribbon)
      await s.cdp.invoke('documents:activate', { docId: writer.docId });
      await sleep(1500);
      await s.cdp.click('[data-tab-id="home"]');
      await sleep(300);
      await s.cdp.key('Alt', 'AltLeft', 18);
      await sleep(600);
      report.checks.keytips = await s.cdp.eval(`document.querySelectorAll('.rb-keytip').length`);
      await s.shot(join(dir, 'checks'), 'keytips');
      await s.cdp.key('Escape', 'Escape', 27);
      await s.cdp.key('Escape', 'Escape', 27);
      await sleep(500);

      // ---------------------------------------------------------- a LibreOffice dialog over the document
      const visibleBefore = new Set(W.topLevelWindows().filter((w) => w.visible).map((w) => w.hwnd));
      await s.cdp.click('[data-group-id="paragraph"] .rb-launcher');
      let dialog = null;
      for (let i = 0; i < 40 && !dialog; i++) {
        await sleep(250);
        dialog = W.topLevelWindows().find((w) => w.visible && !visibleBefore.has(w.hwnd) && /soffice/i.test(W.processImage(w.pid)) && w.rect.width > 200) ?? null;
      }
      report.checks.loDialog = { shown: Boolean(dialog), rect: dialog?.rect };
      if (dialog) {
        await sleep(800);
        writeFileSync(join(dir, 'checks', 'lo-dialog.png'), W.captureScreen(W.frameRect(s.appHwnd)));
        W.bringToFront(dialog.hwnd);
        await sleep(300);
        if (W.foreground() === dialog.hwnd) W.chord([W.VK.ESCAPE]);
        for (let i = 0; i < 20 && W.isWindow(dialog.hwnd) && W.windowInfo(dialog.hwnd).visible; i++) await sleep(250);
        await sleep(800);
        report.checks.loDialog.closed = !W.topLevelWindows().some((w) => w.hwnd === dialog.hwnd && w.visible);
      }
      await s.alive('LibreOffice dialog');
    }

    // ------------------------------------------------------------ quit with unsaved changes (PDF + .doc)
    await s.cdp.invoke('documents:activate', { docId: pdf.docId });
    await sleep(1200);
    await s.cdp.click('[data-tab-id="annotate"]');
    await sleep(300);
    await s.cdp.click('[data-control-id="aFreeText"]');
    await sleep(300);
    const page2 = await s.cdp.rectOf('.page[data-page-number="1"]');
    await s.cdp.clickAt(page2.x + page2.width * 0.52, page2.y + page2.height * 0.57);
    await sleep(400);
    await s.cdp.send('Input.insertText', { text: '2' });
    await s.cdp.click('[data-control-id="aSelect"]');
    await sleep(1500);
    const quit = { prompts: 0, exited: false };
    s.cdp.invoke('app:window', { action: 'close' }).catch(() => undefined);
    const until = Date.now() + 45_000;
    while (Date.now() < until && s.running()) {
      await sleep(400);
      const answered = await s.cdp
        .eval(`(() => { const b = [...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button')].find((e) => e.textContent.trim() === ${JSON.stringify(L.discard)}); if (!b) return false; b.click(); return true; })()`)
        .catch(() => false);
      if (answered) quit.prompts += 1;
    }
    quit.exited = !s.running();
    report.checks.quit = quit;
    s.log('quit', quit);
  } catch (err) {
    report.error = String(err?.stack ?? err);
    s.log('FAILED', { error: String(err?.message ?? err) });
    try {
      await s.shot(join(dir, 'checks'), 'failure');
    } catch {
      // the window may be gone
    }
  } finally {
    s.close();
    report.steps = s.steps;
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
    await sleep(1500);
    try {
      rmSync(samples, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[shots] could not remove ${samples}: ${err.message}`);
    }
  }
  return report;
}

/** The dark theme from the start, so LibreOffice's document view is dark as well (it follows the engine profile). */
async function darkRun(port) {
  const dir = join(out, 'dark');
  rmSync(dir, { recursive: true, force: true });
  const samples = join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Documents', LABELS.en.folder);
  mkdirSync(samples, { recursive: true });
  const docx = join(samples, LABELS.en.files.docx);
  copyFileSync(join(CORPUS, SOURCES.docx), docx);
  const s = await launchVarak({ out: dir, port, settings: settingsPreset({ language: 'en', theme: 'dark' }), tag: 'shots:dark' });
  try {
    await s.open(docx, 'writer');
    await sleep(3000);
    await s.alive('Writer opened (dark)');
    await s.shot(join(dir, 'shots'), 'theme-dark-en');
  } finally {
    s.close();
    await sleep(1500);
    rmSync(samples, { recursive: true, force: true });
  }
}

let port = 9340;
if (arg('--dark-only', null) !== null || process.argv.includes('--dark-only')) {
  await darkRun(port);
  process.exit(0);
}
for (const lang of langs) {
  const r = await run(lang, port++);
  console.log(`[shots] ${lang}: ${r.error ? 'FAILED' : 'done'} ${JSON.stringify(r.checks)}`);
  await sleep(3000);
}
await darkRun(port);
