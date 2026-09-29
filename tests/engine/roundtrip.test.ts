/**
 * Round trips through the engine: a new DOCX / XLSX / PPTX is edited (Turkish text, formatting, cells
 * and formulas, slide text, an added slide), stored, closed, and reopened in a NEW engine instance
 * (another soffice process) where the content is verified. The written files are also checked with the
 * independent OOXML readers of tests/tools/ooxml.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineInstance, EngineManager } from '../../src/main/engine/types';
import { docxDocument, pptxSlides, xlsxWorkbook } from '../tools/ooxml';
import { engineAvailable, fileUrl, makeManager, outDir, printTimings, timed, TURKISH } from './helpers';

describe.skipIf(!engineAvailable)('engine round trips (DOCX, XLSX, PPTX) across engine instances', () => {
  let manager: EngineManager;
  let dir: string;
  let counter = 0;

  beforeAll(() => {
    manager = makeManager('roundtrip');
    dir = outDir('roundtrip');
  });

  afterAll(async () => {
    await manager?.dispose();
    printTimings('Engine round-trip timings');
  });

  /** Runs `fn` on a fresh engine instance and ends that instance afterwards (its soffice process exits). */
  async function withInstance<T>(fn: (instance: EngineInstance, officePid: number | undefined) => Promise<T>): Promise<T> {
    const id = `roundtrip-${++counter}`;
    const instance = await manager.acquireDocumentInstance(id);
    try {
      return await fn(instance, instance.info().officePid);
    } finally {
      await manager.releaseDocumentInstance(id);
    }
  }

  it('DOCX: Turkish text and bold survive save → close → reopen in a new instance', async () => {
    const path = join(dir, 'türkçe belge.docx');
    const firstPid = await withInstance(async (a, pid) => {
      const created = await a.call('doc.new', { docId: 'w', kind: 'writer', view: { mode: 'hidden' } });
      expect(created).toMatchObject({ kind: 'writer', readOnly: false, hasMacros: false });
      await a.call('writer.insertText', { docId: 'w', text: TURKISH });
      await a.call('cmd.dispatch', { docId: 'w', command: '.uno:SelectAll' });
      await a.call('cmd.dispatch', { docId: 'w', command: '.uno:Bold' });
      await timed('DOCX store', () => a.call('doc.store', { docId: 'w', url: fileUrl(path), filter: 'MS Word 2007 XML' }));
      // storeToURL writes a copy: the document is still modified and keeps no location.
      expect((await a.call('doc.info', { docId: 'w' })).modified).toBe(true);
      await a.call('doc.close', { docId: 'w' });
      return pid;
    });

    await withInstance(async (b, pid) => {
      expect(pid).not.toBe(firstPid);
      const loaded = await timed('DOCX load in a new instance', () => b.call('doc.load', { docId: 'w2', url: fileUrl(path), view: { mode: 'hidden' } }));
      expect(loaded).toMatchObject({ kind: 'writer', filterName: 'MS Word 2007 XML', readOnly: false, hasMacros: false });
      expect(loaded.pageCount).toBe(1);
      expect((await b.call('writer.getText', { docId: 'w2' })).text).toBe(TURKISH);
      await b.call('cmd.dispatch', { docId: 'w2', command: '.uno:SelectAll' });
      const { states } = await b.call('cmd.subscribe', { docId: 'w2', commands: ['.uno:Bold'] });
      expect(states[0]).toMatchObject({ command: '.uno:Bold', enabled: true, value: true });
      expect((await b.call('doc.info', { docId: 'w2' })).modified).toBe(false);
      await b.call('doc.close', { docId: 'w2' });
    });

    const docx = await docxDocument(readFileSync(path));
    expect(docx.text).toBe(TURKISH);
    const runs = docx.runs.filter((r) => r.text.trim());
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.bold)).toBe(true);
  });

  it('XLSX: text, numbers and formulas survive; results are recalculated after reopening', async () => {
    const path = join(dir, 'tablo.xlsx');
    const formulas: Record<string, [string, number | string]> = {
      B3: ['=SUM(B1:B2)', 5.5],
      B4: ['=AVERAGE(B1:B2)', 2.75],
      B5: ['=IF(B3>5;"büyük";"küçük")', 'büyük'],
      B6: ['=$B$1*B2', 7],
    };
    await withInstance(async (a) => {
      const created = await a.call('doc.new', { docId: 'c', kind: 'calc', view: { mode: 'hidden' } });
      expect(created.sheetNames).toEqual(['Sayfa1']);
      await a.call('calc.setCell', { docId: 'c', address: 'A1', value: TURKISH });
      await a.call('calc.setCell', { docId: 'c', address: 'B1', value: 2 });
      await a.call('calc.setCell', { docId: 'c', address: 'B2', value: 3.5 });
      for (const [address, [formula]] of Object.entries(formulas)) await a.call('calc.setCell', { docId: 'c', address, formula });
      await timed('XLSX store', () => a.call('doc.store', { docId: 'c', url: fileUrl(path), filter: 'Calc MS Excel 2007 XML' }));
      await a.call('doc.close', { docId: 'c' });
    });

    await withInstance(async (b) => {
      const loaded = await timed('XLSX load in a new instance', () => b.call('doc.load', { docId: 'c2', url: fileUrl(path), view: { mode: 'hidden' } }));
      expect(loaded).toMatchObject({ kind: 'calc', filterName: 'Calc MS Excel 2007 XML', sheetNames: ['Sayfa1'] });
      expect(await b.call('calc.getCell', { docId: 'c2', address: 'A1' })).toMatchObject({ type: 'text', value: TURKISH });
      expect(await b.call('calc.getCell', { docId: 'c2', address: 'B2' })).toMatchObject({ type: 'value', value: 3.5, display: '3,5' });
      for (const [address, [formula, value]] of Object.entries(formulas)) {
        expect(await b.call('calc.getCell', { docId: 'c2', address })).toMatchObject({ type: 'formula', formula, value });
      }
      // Recalculation on edit after reopening.
      await b.call('calc.setCell', { docId: 'c2', address: 'B1', value: 10 });
      expect((await b.call('calc.getCell', { docId: 'c2', address: 'B3' })).value).toBe(13.5);
      expect((await b.call('calc.getCell', { docId: 'c2', address: 'B6' })).value).toBe(35);
      await b.call('doc.close', { docId: 'c2' });
    });

    const book = await xlsxWorkbook(readFileSync(path));
    const sheet = book.sheet('Sayfa1');
    expect(sheet.cells.get('A1')?.value).toBe(TURKISH);
    expect(sheet.cells.get('B3')).toMatchObject({ formula: 'SUM(B1:B2)', value: 5.5, hasCachedResult: true });
    expect(sheet.cells.get('B5')).toMatchObject({ value: 'büyük', hasCachedResult: true });
    expect(sheet.cells.get('B6')?.formula).toBe('$B$1*B2');
  });

  it('PPTX: slide texts and an added slide survive save → close → reopen in a new instance', async () => {
    const path = join(dir, 'sunum.pptx');
    const title = `Başlık: ${TURKISH}`;
    const subtitle = 'Alt başlık — ığdır, İstanbul, Çorum';
    await withInstance(async (a) => {
      const created = await a.call('doc.new', { docId: 'p', kind: 'impress', view: { mode: 'hidden' } });
      expect(created.slideCount).toBe(1);
      const { slides } = await a.call('impress.slides', { docId: 'p' });
      expect(slides[0]?.texts?.length).toBeGreaterThanOrEqual(2);
      await a.call('impress.setShapeText', { docId: 'p', slide: 0, shape: 0, text: title });
      await a.call('impress.setShapeText', { docId: 'p', slide: 0, shape: 1, text: subtitle });
      await a.call('cmd.dispatch', { docId: 'p', command: '.uno:DuplicatePage' });
      expect((await a.call('doc.info', { docId: 'p' })).slideCount).toBe(2);
      await timed('PPTX store', () => a.call('doc.store', { docId: 'p', url: fileUrl(path), filter: 'Impress MS PowerPoint 2007 XML' }));
      await a.call('doc.close', { docId: 'p' });
    });

    await withInstance(async (b) => {
      const loaded = await timed('PPTX load in a new instance', () => b.call('doc.load', { docId: 'p2', url: fileUrl(path), view: { mode: 'hidden' } }));
      expect(loaded).toMatchObject({ kind: 'impress', filterName: 'Impress MS PowerPoint 2007 XML', slideCount: 2 });
      const { slides } = await b.call('impress.slides', { docId: 'p2' });
      expect(slides).toHaveLength(2);
      for (const slide of slides) expect(slide.texts).toEqual(expect.arrayContaining([title, subtitle]));
      await b.call('impress.gotoSlide', { docId: 'p2', index: 1 });
      expect((await b.call('doc.info', { docId: 'p2' })).currentSlide).toBe(1);
      await b.call('doc.close', { docId: 'p2' });
    });

    const pptx = await pptxSlides(readFileSync(path));
    expect(pptx).toHaveLength(2);
    for (const slide of pptx) expect(slide.texts).toEqual(expect.arrayContaining([title, subtitle]));
  });
});
