/**
 * Export and protection through the engine:
 *  - PDF export of Writer, Calc and Impress documents with Turkish text (PDF_EXPORT_FILTER of
 *    src/shared/formats.ts), checked with pdf.js (legacy build) and through the conversion instance;
 *  - a password-protected DOCX round trip: PASSWORD_REQUIRED without, WRONG_PASSWORD with a wrong one,
 *    the content with the right one (ECMA-376 agile encryption in an OLE compound file).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDF_EXPORT_FILTER } from '@shared/formats';
import { RPC_ERROR } from '@shared/engine-protocol';
import type { OfficeKind } from '@shared/modules';
import { isEngineRpcError } from '../../src/main/engine';
import type { EngineInstance, EngineManager } from '../../src/main/engine/types';
import { isCfb, readCfb } from '../tools/cfb';
import { engineAvailable, fileUrl, makeManager, outDir, pdfPageTexts, printTimings, timed, TURKISH } from './helpers';

describe.skipIf(!engineAvailable)('engine export: PDF and password protection', () => {
  let manager: EngineManager;
  let instance: EngineInstance;
  let dir: string;

  beforeAll(async () => {
    manager = makeManager('export');
    dir = outDir('export');
    instance = await manager.acquireDocumentInstance('export');
  });

  afterAll(async () => {
    await manager?.dispose();
    printTimings('Export timings');
  });

  async function fill(docId: string, kind: OfficeKind): Promise<void> {
    if (kind === 'writer') {
      await instance.call('writer.insertText', { docId, text: TURKISH });
    } else if (kind === 'calc') {
      await instance.call('calc.setCell', { docId, address: 'A1', value: TURKISH });
      await instance.call('calc.setCell', { docId, address: 'A2', value: 1234.5 });
    } else {
      await instance.call('impress.setShapeText', { docId, slide: 0, shape: 0, text: TURKISH });
    }
  }

  for (const kind of ['writer', 'calc', 'impress'] as const) {
    it(`exports ${kind} to PDF with Turkish text intact`, async () => {
      const docId = `pdf-${kind}`;
      await instance.call('doc.new', { docId, kind, view: { mode: 'hidden' } });
      await fill(docId, kind);
      const path = join(dir, `${kind}-türkçe.pdf`);
      await timed(`PDF export (${kind})`, () =>
        instance.call('doc.store', { docId, url: fileUrl(path), filter: PDF_EXPORT_FILTER[kind], filterData: { UseTaggedPDF: true, ExportBookmarks: true } }),
      );
      await instance.call('doc.close', { docId });
      const bytes = readFileSync(path);
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      const pages = await pdfPageTexts(new Uint8Array(bytes));
      expect(pages.length).toBeGreaterThanOrEqual(1);
      const text = pages.join('\n').replace(/\s+/g, ' ');
      expect(text).toContain(TURKISH);
      if (kind === 'calc') expect(text).toContain('1234,5');
    });
  }

  it('converts a stored DOCX to PDF/A on the headless conversion instance', async () => {
    const docx = join(dir, 'kaynak.docx');
    await instance.call('doc.new', { docId: 'src', kind: 'writer', view: { mode: 'hidden' } });
    await fill('src', 'writer');
    await instance.call('doc.store', { docId: 'src', url: fileUrl(docx), filter: 'MS Word 2007 XML' });
    await instance.call('doc.close', { docId: 'src' });
    const pdf = join(dir, 'donusturulen.pdf');
    await timed('convert.file DOCX → PDF/A-2b (incl. conversion instance start)', () =>
      manager.convert({ input: fileUrl(docx), output: fileUrl(pdf), filter: PDF_EXPORT_FILTER.writer, filterData: { SelectPdfVersion: 2 } }),
    );
    const bytes = readFileSync(pdf);
    expect(bytes.toString('latin1')).toMatch(/pdfaid:part[^0-9]*2/);
    expect((await pdfPageTexts(new Uint8Array(bytes))).join(' ')).toContain(TURKISH);
  });

  it('round-trips a password-protected DOCX', async () => {
    const path = join(dir, 'şifreli.docx');
    const password = 'Gizli-Şifre-2026';
    await instance.call('doc.new', { docId: 'secret', kind: 'writer', view: { mode: 'hidden' } });
    await instance.call('writer.insertText', { docId: 'secret', text: `${TURKISH} — gizli` });
    await timed('store encrypted DOCX', () => instance.call('doc.store', { docId: 'secret', url: fileUrl(path), filter: 'MS Word 2007 XML', password }));
    await instance.call('doc.close', { docId: 'secret' });

    // Encrypted OOXML is an OLE compound file with the encryption info and the encrypted package.
    const bytes = new Uint8Array(readFileSync(path));
    expect(isCfb(bytes)).toBe(true);
    const streams = [...readCfb(bytes).keys()].map((name) => name.replace(/^.*\//, ''));
    expect(streams).toEqual(expect.arrayContaining(['EncryptionInfo', 'EncryptedPackage']));
    expect(Buffer.from(bytes).includes(Buffer.from('gizli', 'utf8'))).toBe(false);

    const load = (docId: string, pw?: string) =>
      instance.call('doc.load', { docId, url: fileUrl(path), view: { mode: 'hidden' }, ...(pw === undefined ? {} : { password: pw }) });
    await expect(load('without')).rejects.toSatisfy((e) => isEngineRpcError(e, RPC_ERROR.PASSWORD_REQUIRED));
    await expect(load('wrong', 'yanlış')).rejects.toSatisfy((e) => isEngineRpcError(e, RPC_ERROR.WRONG_PASSWORD));
    const loaded = await timed('load encrypted DOCX', () => load('right', password));
    expect(loaded).toMatchObject({ kind: 'writer', readOnly: false });
    expect((await instance.call('writer.getText', { docId: 'right' })).text).toBe(`${TURKISH} — gizli`);
    await instance.call('doc.close', { docId: 'right' });
    // Failed loads leave nothing behind.
    await expect(instance.call('doc.info', { docId: 'without' })).rejects.toSatisfy((e) => isEngineRpcError(e, RPC_ERROR.DOC_NOT_FOUND));
  });
});
