// On-screen check: PDF highlight by dragging with the Highlight tool (saved and read back), then closing the window
// with unsaved changes in a PDF and a Writer document — does Simpaper ask before discarding them?
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { launchSimpaper, repo, requireIdle, settingsPreset, sleep } from '../harness.mjs';

requireIdle(60_000, 'quit');
const out = join(repo, 'test-output/gui/quitcheck');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'files'), { recursive: true });
const shots = join(out, 'shots');
const pdfPath = join(out, 'files', 'Belge.pdf');
const docxPath = join(out, 'files', 'Rapor.docx');
copyFileSync(join(repo, 'tests/corpus/generated/pdf-text.pdf'), pdfPath);
copyFileSync(join(repo, 'tests/corpus/generated/docx-basic.docx'), docxPath);

const subtypes = async (path) => {
  const pdf = await PDFDocument.load(readFileSync(path), { ignoreEncryption: true });
  const annots = pdf.getPage(0).node.Annots();
  return annots ? annots.asArray().map((ref) => pdf.context.lookup(ref).get(PDFName.of('Subtype'))?.toString()) : [];
};
const report = {};
const s = await launchSimpaper({ out, port: 9350, settings: settingsPreset({ language: 'tr', theme: 'light' }), tag: 'quit' });
try {
  const pdf = await s.open(pdfPath, 'pdf');
  await sleep(2500);
  await s.cdp.click('[data-tab-id="annotate"]');
  await sleep(400);
  await s.cdp.click('[data-control-id="aHighlight"]');
  await sleep(500);
  const span = await s.cdp.eval(`(() => {
    const e = [...document.querySelectorAll('.textLayer span')].find((x) => x.textContent.includes('Pijamalı hasta'));
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  s.log('span', span);
  await s.cdp.drag(span.x + 2, span.y + span.height / 2, span.x + span.width - 2, span.y + span.height / 2);
  await sleep(900);
  report.highlightEditors = await s.cdp.eval(`document.querySelectorAll('.highlightEditor').length`);
  await s.cdp.click('[data-control-id="aSelect"]');
  await sleep(1200);
  await s.shot(shots, 'pdf-highlight');
  await s.cdp.click('[data-tab-id="home"]');
  await sleep(300);
  const before = readFileSync(pdfPath);
  await s.cdp.click('[data-control-id="save"]');
  let saved = false;
  for (let i = 0; i < 60 && !saved; i++) {
    await sleep(500);
    const d = (await s.docs()).find((x) => x.docId === pdf.docId);
    saved = Boolean(d && !d.modified && !readFileSync(pdfPath).equals(before));
  }
  report.saved = { saved, annotations: saved ? await subtypes(pdfPath) : [] };
  s.log('saved', report.saved);

  // Unsaved changes: a second highlight in the PDF, typed text in Writer.
  await s.cdp.click('[data-tab-id="annotate"]');
  await s.cdp.click('[data-control-id="aHighlight"]');
  await sleep(400);
  const span2 = await s.cdp.eval(`(() => {
    const e = [...document.querySelectorAll('.textLayer span')].find((x) => x.textContent.includes('Noktalı ve noktasız'));
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  await s.cdp.drag(span2.x + 2, span2.y + span2.height / 2, span2.x + span2.width - 2, span2.y + span2.height / 2);
  await sleep(900);
  await s.cdp.click('[data-control-id="aSelect"]');
  await sleep(1500);
  const writer = await s.open(docxPath, 'writer');
  await sleep(2500);
  await s.clickInDocument(0.5, 0.3);
  await s.typeHuman('ek');
  await sleep(1500);
  report.beforeClose = (await s.docs()).map((d) => ({ kind: d.kind, title: d.title, modified: d.modified, state: d.state }));
  s.log('documents before closing the window', report.beforeClose);

  s.cdp.invoke('app:window', { action: 'close' }).catch(() => undefined);
  report.dialogs = [];
  const until = Date.now() + 45_000;
  while (Date.now() < until && s.running()) {
    await sleep(300);
    const text = await s.cdp.eval(`(() => { const d = document.querySelector('[role="alertdialog"], [role="dialog"][aria-modal="true"]'); return d ? d.textContent.slice(0, 200) : null; })()`).catch(() => null);
    if (!text) continue;
    report.dialogs.push(text);
    s.log('dialog', { text });
    await s.shot(shots, `quit-dialog-${report.dialogs.length}`).catch(() => undefined);
    await s.cdp.eval(`(() => { const b = [...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button')].find((e) => e.textContent.trim() === 'Kaydetme'); if (b) { b.click(); return true; } return false; })()`).catch(() => false);
    await sleep(600);
  }
  report.exited = !s.running();
  report.pdfOnDisk = await subtypes(pdfPath);
  report.writerUnchanged = readFileSync(docxPath).equals(readFileSync(join(repo, 'tests/corpus/generated/docx-basic.docx')));
  s.log('after closing', { exited: report.exited, dialogs: report.dialogs.length, pdfOnDisk: report.pdfOnDisk, writerUnchanged: report.writerUnchanged, writerDocId: writer.docId });
} catch (err) {
  report.error = String(err?.stack ?? err);
  s.log('FAILED', { error: String(err?.message ?? err) });
} finally {
  s.close();
  writeFileSync(join(out, 'report.json'), JSON.stringify({ ...report, steps: s.steps }, null, 2));
}
