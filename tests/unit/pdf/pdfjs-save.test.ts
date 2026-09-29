/**
 * Real pdf.js output → main process: annotations and form values saved with pdf.js' saveDocument()
 * (what the renderer sends through pdf:update) get Unicode appearances from the fix and stay readable.
 */
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fixUnicodeAppearances } from '../../../src/main/pdf/appearance';
import { createFontProvider } from '../../../src/main/pdf/fonts';
import { verifyPdfBytes } from '../../../src/main/pdf/verify';
import { PDFJS_FONTS, TURKISH, darkPixelRatio, fontCandidates, makeFormPdf, makePagedPdf, memoryLogger } from './helpers';

const log = memoryLogger();
const fonts = createFontProvider(fontCandidates, log);

async function withPdfjs<T>(bytes: Uint8Array, fn: (pdf: Awaited<ReturnType<typeof getDocument>['promise']>) => Promise<T>): Promise<T> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0, standardFontDataUrl: `${PDFJS_FONTS}/` });
  try {
    return await fn(await task.promise);
  } finally {
    await task.destroy();
  }
}

describe('pdf.js saveDocument output', () => {
  it('Turkish form values: pdf.js sets /NeedAppearances, the fix adds real appearances', async () => {
    const input = await makeFormPdf();
    const saved = await withPdfjs(input, async (pdf) => {
      const page = await pdf.getPage(2);
      const annots = await page.getAnnotations();
      const city = annots.find((a) => (a as { fieldName?: string }).fieldName === 'city') as { id: string } | undefined;
      expect(city).toBeDefined();
      pdf.annotationStorage.setValue(city!.id, { value: `İzmir ${TURKISH}` });
      return pdf.saveDocument();
    });
    // pdf.js wrote an incremental update with the value but no appearance.
    expect(Buffer.from(saved.subarray(0, input.length)).equals(Buffer.from(input))).toBe(true);
    const before = await PDFDocument.load(saved);
    expect(before.catalog.lookup(PDFName.of('AcroForm'), PDFDict).get(PDFName.of('NeedAppearances'))).toBe(PDFBool.True);

    const fixed = await fixUnicodeAppearances(saved, fonts, log);
    expect(fixed.fields).toBe(1);
    await expect(verifyPdfBytes(fixed.bytes, { pageCount: 2 })).resolves.toBeDefined();
    const after = await PDFDocument.load(fixed.bytes);
    expect(after.catalog.lookup(PDFName.of('AcroForm'), PDFDict).get(PDFName.of('NeedAppearances'))).toBe(PDFBool.False);
    expect(after.getForm().getTextField('city').getText()).toBe(`İzmir ${TURKISH}`);
    expect(await darkPixelRatio(fixed.bytes, 1, [64, 703, 240, 721])).toBeGreaterThan(0.05);
    // pdf.js reads the value back.
    const value = await withPdfjs(fixed.bytes, async (pdf) => {
      const objects: unknown = await pdf.getFieldObjects();
      // One entry for the field, one per widget; the widget carries the value.
      const city = objects instanceof Map ? (objects.get('city') as { value?: string }[] | undefined) : undefined;
      return city?.find((o) => o.value !== undefined)?.value;
    });
    expect(value).toBe(`İzmir ${TURKISH}`);
  });

  it('Turkish FreeText from the annotation storage: saved without /AP by pdf.js, drawn after the fix', async () => {
    const input = await makePagedPdf({ pages: 1 });
    const rect: [number, number, number, number] = [60, 500, 400, 540];
    const saved = await withPdfjs(input, async (pdf) => {
      // What FreeTextEditor.serialize() produces for a new annotation (pdf.js 6.3).
      pdf.annotationStorage.setValue('pdfjs_internal_editor_0', {
        annotationType: 3,
        color: [0, 0, 255],
        fontSize: 16,
        value: `Not: ${TURKISH}`,
        pageIndex: 0,
        rect,
        rotation: 0,
        user: 'Varak',
      });
      return pdf.saveDocument();
    });
    const plain = await PDFDocument.load(saved);
    const annot = plain.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
    expect(annot.get(PDFName.of('Subtype'))).toBe(PDFName.of('FreeText'));
    expect(annot.get(PDFName.of('AP'))).toBeUndefined();
    expect(await darkPixelRatio(saved, 0, rect)).toBe(0);

    const fixed = await fixUnicodeAppearances(saved, fonts, log);
    expect(fixed.freeTexts).toBe(1);
    const doc = await PDFDocument.load(fixed.bytes);
    const ap = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict).lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'));
    expect(ap).toBeInstanceOf(PDFRef);
    expect(doc.context.lookup(ap as PDFRef)).toBeInstanceOf(PDFStream);
    expect(await darkPixelRatio(fixed.bytes, 0, rect)).toBeGreaterThan(0.01);
    // pdf.js still sees one FreeText annotation with the original text.
    const contents = await withPdfjs(fixed.bytes, async (pdf) => {
      const annots = await (await pdf.getPage(1)).getAnnotations();
      return annots.filter((a) => a.subtype === 'FreeText').map((a) => (a as { contentsObj?: { str: string } }).contentsObj?.str);
    });
    expect(contents).toEqual([`Not: ${TURKISH}`]);
  });

  it('encrypted documents: pdf.js keeps the encryption, the fix steps aside and the result verifies', async () => {
    const plain = await PDFDocument.load(await makePagedPdf({ pages: 2 }));
    // Empty user password: opens without a prompt but is encrypted (as many "protected" PDFs are).
    plain.encrypt({ userPassword: '', ownerPassword: 'sahip', permissions: { printing: 'highResolution' } });
    const input = await plain.save();
    const saved = await withPdfjs(input, async (pdf) => {
      pdf.annotationStorage.setValue('pdfjs_internal_editor_0', {
        annotationType: 3,
        color: [0, 0, 0],
        fontSize: 14,
        value: `Şifreli belge ${TURKISH}`,
        pageIndex: 0,
        rect: [60, 500, 400, 540],
        rotation: 0,
      });
      return pdf.saveDocument();
    });
    const fixed = await fixUnicodeAppearances(saved, fonts, log);
    expect(fixed.bytes).toBe(saved);
    await expect(verifyPdfBytes(saved, { pageCount: 2 })).resolves.toMatchObject({ encrypted: true });
    // pdf.js reopens it (with the encryption intact) and finds the new annotation.
    const subtypes = await withPdfjs(saved, async (pdf) => (await (await pdf.getPage(1)).getAnnotations()).map((a) => a.subtype));
    expect(subtypes).toContain('FreeText');
  });

  it('ASCII FreeText gets pdf.js own appearance and is left alone', async () => {
    const input = await makePagedPdf({ pages: 1 });
    const saved = await withPdfjs(input, async (pdf) => {
      pdf.annotationStorage.setValue('pdfjs_internal_editor_0', {
        annotationType: 3,
        color: [0, 0, 0],
        fontSize: 12,
        value: 'Plain ASCII note',
        pageIndex: 0,
        rect: [60, 500, 300, 530],
        rotation: 0,
      });
      return pdf.saveDocument();
    });
    const fixed = await fixUnicodeAppearances(saved, fonts, log);
    expect(fixed.freeTexts).toBe(0);
    expect(fixed.bytes).toBe(saved);
  });
});
