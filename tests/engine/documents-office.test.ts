/**
 * Document lifecycle of the main-process core against the real LibreOffice engine (headless, hidden views):
 * XLSX and PPTX open → edit through engine RPC → save through the whole pipeline (working copy → doc.store
 * into a temp sibling → zip/CRC check → re-open by the conversion instance → ReplaceFileW) → reopen; the
 * save-risk prompt with "save a copy" (the original stays byte-identical); PDF export (PDF/A-2b, tagged).
 * Files come from tests/corpus/generated when present, otherwise the engine creates them first.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prompt } from '@shared/api/documents';
import { copyCorpus, createRealHarness, engineAvailable, until, type RealHarness } from '../unit/main/helpers/realEngine';

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const zipText = async (path: string, part: string) => (await (await JSZip.loadAsync(readFileSync(path))).file(part)?.async('string')) ?? '';

/** Files next to the user's documents that the pipeline must not leave behind (temp siblings, backups). */
function leftovers(dir: string, keep: string[]): string[] {
  return readdirSync(dir).filter((n) => !keep.includes(n));
}

describe.skipIf(!engineAvailable)('documents with the real engine: spreadsheets and presentations', () => {
  let h: RealHarness;

  beforeAll(async () => {
    h = await createRealHarness('office');
  });

  afterAll(async () => {
    if (!h) return;
    const left = await h.dispose();
    // Every engine process ended with the service (none had to be killed afterwards).
    expect(left).toEqual([]);
    expect(h.views.attached).toEqual([]);
  });

  /** A spreadsheet to work on: the generated corpus file, or one the engine creates now. */
  async function spreadsheet(name: string): Promise<{ path: string; fromCorpus: boolean }> {
    const copied = copyCorpus('xlsx-basic.xlsx', h.docsDir, name);
    if (copied) return { path: copied, fromCorpus: true };
    const doc = await h.service.create('calc');
    await h.instance(doc.docId).call('calc.setCell', { docId: doc.docId, sheet: 0, address: 'A1', value: 'Şehir' });
    const path = join(h.docsDir, name);
    expect((await h.service.save(doc.docId, { path, format: 'xlsx' })).outcome).toBe('saved');
    expect(await h.service.close(doc.docId)).toBe('closed');
    return { path, fromCorpus: false };
  }

  async function presentation(name: string): Promise<{ path: string; fromCorpus: boolean }> {
    const copied = copyCorpus('pptx-basic.pptx', h.docsDir, name);
    if (copied) return { path: copied, fromCorpus: true };
    const doc = await h.service.create('impress');
    const path = join(h.docsDir, name);
    expect((await h.service.save(doc.docId, { path, format: 'pptx' })).outcome).toBe('saved');
    expect(await h.service.close(doc.docId)).toBe('closed');
    return { path, fromCorpus: false };
  }

  it(
    'XLSX: open → edit → save through the safe pipeline with re-open verification → reopen shows the edit',
    async () => {
      const { path: src, fromCorpus } = await spreadsheet('Tablo.xlsx');
      const doc = await h.service.open(src);
      expect(doc).toMatchObject({ kind: 'calc', format: 'xlsx', state: 'ready', modified: false, path: src, title: 'Tablo.xlsx' });
      const docId = doc.docId;
      const inst = h.instance(docId);

      const text = 'Düzce — çğıöşü ÇĞİÖŞÜ ıIiİ';
      await inst.call('calc.setCell', { docId, sheet: 0, address: 'Z1', value: 100 });
      await inst.call('calc.setCell', { docId, sheet: 0, address: 'Z2', value: 250.5 });
      await inst.call('calc.setCell', { docId, sheet: 0, address: 'Z3', formula: '=SUM(Z1:Z2)' });
      await inst.call('calc.setCell', { docId, sheet: 0, address: 'Z4', value: text });
      if (fromCorpus) await inst.call('calc.setCell', { docId, sheet: 'Veriler', address: 'C2', value: 1_600_000 });
      await until(() => h.service.get(docId)?.descriptor.modified === true, 30_000, 'modified flag');
      expect((await inst.call('calc.getCell', { docId, sheet: 0, address: 'Z3' })).value).toBe(350.5);
      if (fromCorpus) expect((await inst.call('calc.getCell', { docId, sheet: 'Hesaplar', address: 'B2' })).value).toBe(4_415_000);

      const promptsBefore = h.prompts.length;
      const result = await h.service.save(docId);
      expect(result).toEqual({ outcome: 'saved', path: src, format: 'xlsx' });
      // A plain XLSX has nothing at risk: no prompt.
      expect(h.prompts.slice(promptsBefore)).toEqual([]);
      expect(h.service.get(docId)?.descriptor).toMatchObject({ modified: false, path: src, format: 'xlsx' });
      // The engine cleared its own flag together with the store (markSaved); nothing forced it afterwards.
      expect((await inst.call('doc.info', { docId })).modified).toBe(false);

      // Independent of the engine: the file is a valid package that contains the edit.
      const zip = await JSZip.loadAsync(readFileSync(src));
      expect(zip.file('xl/workbook.xml')).not.toBeNull();
      const sheetXml = await zipText(src, 'xl/worksheets/sheet1.xml');
      const strings = await zipText(src, 'xl/sharedStrings.xml');
      expect(strings + sheetXml).toContain(text);
      expect(sheetXml).toMatch(/<f[^>]*>SUM\(Z1:Z2\)<\/f><v>350\.5<\/v>/);
      // Nothing left behind: no temp sibling next to the file, no verification PDF.
      expect(leftovers(h.docsDir, ['Tablo.xlsx'])).toEqual([]);
      expect(existsSync(join(h.dir, 'scratch')) ? readdirSync(join(h.dir, 'scratch')) : []).toEqual([]);

      expect(await h.service.close(docId)).toBe('closed');
      const again = await h.service.open(src);
      const inst2 = h.instance(again.docId);
      expect(inst2).not.toBe(inst);
      expect((await inst2.call('calc.getCell', { docId: again.docId, sheet: 0, address: 'Z4' })).value).toBe(text);
      const sum = await inst2.call('calc.getCell', { docId: again.docId, sheet: 0, address: 'Z3' });
      expect(sum.value).toBe(350.5);
      expect(sum.formula).toMatch(/SUM\(/);
      if (fromCorpus) {
        const b2 = await inst2.call('calc.getCell', { docId: again.docId, sheet: 'Hesaplar', address: 'B2' });
        expect(b2.value).toBe(4_415_000);
        expect(b2.formula).toMatch(/SUM\(/);
      }
      expect(await h.service.close(again.docId)).toBe('closed');
    },
    600_000,
  );

  it(
    'an edit made while the written file is verified keeps the document modified; the file has the edits before it',
    async () => {
      const { path: src } = await spreadsheet('Dogrulama.xlsx');
      const doc = await h.service.open(src);
      const docId = doc.docId;
      const inst = h.instance(docId);
      const saved = 'Kaydedilen değer';
      const later = 'Doğrulama sırasında yazılan';
      await inst.call('calc.setCell', { docId, sheet: 0, address: 'Y1', value: saved });
      await until(() => h.service.get(docId)?.descriptor.modified === true, 30_000, 'modified flag');
      // The user keeps typing while the conversion instance re-opens the written temp file.
      const engine = h.engine as { convert: RealHarness['engine']['convert'] };
      const convert = engine.convert.bind(h.engine);
      engine.convert = async (params, opts) => {
        await inst.call('calc.setCell', { docId, sheet: 0, address: 'Y2', value: later });
        return convert(params, opts);
      };
      try {
        expect(await h.service.save(docId)).toEqual({ outcome: 'saved', path: src, format: 'xlsx' });
      } finally {
        engine.convert = convert;
      }
      expect((await inst.call('doc.info', { docId })).modified).toBe(true);
      expect(h.service.get(docId)?.descriptor.modified).toBe(true);
      const strings = await zipText(src, 'xl/sharedStrings.xml');
      expect(strings).toContain(saved);
      expect(strings).not.toContain(later);
      // Closing still asks (the answer here: don't save).
      h.answer((p) => (p.kind === 'unsavedChanges' ? { kind: 'unsavedChanges', choice: 'discard' } : undefined));
      const promptsBefore = h.prompts.length;
      expect(await h.service.close(docId)).toBe('closed');
      expect(h.prompts.slice(promptsBefore).map((p) => p.kind)).toEqual(['unsavedChanges']);
      h.answer(() => undefined);
      // The other tests check the documents folder for leftovers.
      rmSync(src);
    },
    600_000,
  );

  it(
    'PPTX: open → duplicate a slide and change a text → save → reopen shows both, images are kept',
    async () => {
      const { path: src, fromCorpus } = await presentation('Sunum.pptx');
      const doc = await h.service.open(src);
      expect(doc).toMatchObject({ kind: 'impress', format: 'pptx', state: 'ready' });
      const docId = doc.docId;
      const inst = h.instance(docId);
      const before = (await inst.call('impress.slides', { docId })).slides;
      if (fromCorpus) expect(before).toHaveLength(3);
      const first = before[0];
      expect(first).toBeDefined();
      const shape = Math.max(0, (first?.texts ?? []).findIndex((t, i) => i > 0 && t.length > 0));
      const originalText = first?.texts?.[shape] ?? '';
      // A UI command (as a ribbon button sends it): duplicates the current (first) slide.
      await inst.call('impress.gotoSlide', { docId, index: 0 });
      await inst.call('cmd.dispatch', { docId, command: '.uno:DuplicatePage' });
      await until(() => h.service.get(docId)?.descriptor.modified === true, 30_000, 'modified flag');
      // Then a text change on the first slide. (This RPC does not set LibreOffice's modified flag on its own;
      // the document is already modified here.)
      const text = 'Değiştirilen metin: çğıöşü ÇĞİÖŞÜ — İzmir, Iğdır';
      await inst.call('impress.setShapeText', { docId, slide: 0, shape, text });

      const promptsBefore = h.prompts.length;
      expect(await h.service.save(docId)).toEqual({ outcome: 'saved', path: src, format: 'pptx' });
      // A missing font is reported but not at risk on save: no prompt.
      expect(h.prompts.slice(promptsBefore)).toEqual([]);
      expect(await zipText(src, 'ppt/slides/slide1.xml')).toContain('Değiştirilen metin: çğıöşü ÇĞİÖŞÜ');
      const names = Object.keys((await JSZip.loadAsync(readFileSync(src))).files);
      expect(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(before.length + 1);
      if (fromCorpus) expect(names.some((n) => /^ppt\/media\/[^/]+\.(png|jpe?g)$/i.test(n))).toBe(true);
      expect(leftovers(h.docsDir, ['Tablo.xlsx', 'Sunum.pptx'])).toEqual([]);

      expect(await h.service.close(docId)).toBe('closed');
      const again = await h.service.open(src);
      const slides = (await h.instance(again.docId).call('impress.slides', { docId: again.docId })).slides;
      expect(slides).toHaveLength(before.length + 1);
      expect(slides[0]?.texts?.[shape]).toBe(text);
      // The duplicate was made before the text change.
      expect(slides[1]?.texts?.[shape]).toBe(originalText);
      // The bulleted body of the next slide is one shape; its lines are joined in the shape text.
      if (fromCorpus) expect(slides[2]?.texts?.join(' ')).toContain('Pijamalı hasta yağız şoföre çabucak güvendi.');
      expect(await h.service.close(again.docId)).toBe('closed');
    },
    600_000,
  );

  it(
    'save-risk prompt: "save a copy" writes the copy and leaves the original byte-identical; "cancel" writes nothing',
    async () => {
      // A workbook with threaded comments (kept by LibreOffice only as plain notes): at risk on every save.
      const { path: base } = await spreadsheet('Yorumlu-temel.xlsx');
      const zip = await JSZip.loadAsync(readFileSync(base));
      zip.file('xl/threadedComments/threadedComment1.xml', '<ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"/>');
      const src = join(h.docsDir, 'Yorumlu.xlsx');
      writeFileSync(src, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
      const originalHash = sha(src);

      const doc = await h.service.open(src);
      const docId = doc.docId;
      expect(doc.compat?.findings.map((f) => f.id)).toContain('threadedComments');
      const inst = h.instance(docId);
      await inst.call('calc.setCell', { docId, sheet: 0, address: 'Z9', value: 'Kopyaya giden değişiklik' });
      await until(() => h.service.get(docId)?.descriptor.modified === true, 30_000, 'modified flag');

      // "cancel": nothing is written.
      h.answer((p) => (p.kind === 'saveRisk' ? { kind: 'saveRisk', choice: 'cancel' } : undefined));
      expect(await h.service.save(docId)).toEqual({ outcome: 'cancelled' });
      expect(sha(src)).toBe(originalHash);

      // "save a copy": the Save As dialog suggests "<name> (kopya)"; the user accepts it.
      h.answer((p) => (p.kind === 'saveRisk' ? { kind: 'saveRisk', choice: 'saveCopy' } : undefined));
      const promptsBefore = h.prompts.length;
      const result = await h.service.save(docId);
      const copy = join(h.docsDir, 'Yorumlu (kopya).xlsx');
      expect(result).toEqual({ outcome: 'savedCopy', path: copy, format: 'xlsx' });
      const risk = h.prompts.slice(promptsBefore).find((p): p is Extract<Prompt, { kind: 'saveRisk' }> => p.kind === 'saveRisk');
      expect(risk).toMatchObject({ docId, fileName: 'Yorumlu.xlsx', format: 'xlsx' });
      expect(risk?.findings.map((f) => f.id)).toContain('threadedComments');
      expect(h.dialogs.saveRequests.at(-1)?.defaultPath).toBe(copy);

      // The original is untouched; the copy holds the change; the document continues on the copy.
      expect(sha(src)).toBe(originalHash);
      expect((await zipText(copy, 'xl/sharedStrings.xml')) + (await zipText(copy, 'xl/worksheets/sheet1.xml'))).toContain('Kopyaya giden değişiklik');
      expect(h.service.get(docId)?.descriptor).toMatchObject({ path: copy, title: 'Yorumlu (kopya).xlsx', modified: false });
      expect(await h.service.close(docId)).toBe('closed');
      h.answer(() => undefined);
    },
    600_000,
  );

  it(
    'exports PDF/A-2b (tagged) through the safe pipeline',
    async () => {
      const { path: src } = await spreadsheet('Rapor.xlsx');
      const doc = await h.service.open(src);
      const target = join(h.docsDir, 'Rapor.pdf');
      const result = await h.service.exportPdf(doc.docId, { path: target, pdfA: true });
      expect(result).toEqual({ outcome: 'saved', path: target, format: 'pdf' });
      const bytes = readFileSync(target);
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      const text = bytes.toString('latin1');
      expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
      // PDF/A identification in the XMP metadata and a structure tree (tagged PDF).
      expect(text).toMatch(/pdfaid:part(>|=")2/);
      expect(text).toContain('/StructTreeRoot');
      // Exporting does not touch the document or its file.
      expect(h.service.get(doc.docId)?.descriptor.modified).toBe(false);
      expect(await h.service.close(doc.docId)).toBe('closed');
    },
    600_000,
  );
});
