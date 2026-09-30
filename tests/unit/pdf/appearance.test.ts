import { afterEach, describe, expect, it } from 'vitest';
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFStream, PDFString, PDFTextField } from '@cantoo/pdf-lib';
import { fixUnicodeAppearances, parseDefaultAppearance } from '../../../src/main/pdf/appearance';
import { createFontProvider } from '../../../src/main/pdf/fonts';
import { createPdfService } from '../../../src/main/pdf';
import {
  FakeDialogs,
  FakeRegistry,
  TURKISH,
  darkPixelRatio,
  fontCandidates,
  makeFormPdf,
  makeTempDir,
  memoryLogger,
  readBytes,
  tempSafeWriter,
  writeBytes,
} from './helpers';
import { join } from 'node:path';

const log = memoryLogger();
const fonts = createFontProvider(fontCandidates, log);

type Rect = [number, number, number, number];

/** A page with a FreeText annotation the way pdf.js 6.3 saves Turkish text: /DA with Helv, no /AP. */
async function freeTextPdf(text: string, rect: Rect, rotate = 0, pageRotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  if (pageRotate) page.node.set(PDFName.of('Rotate'), doc.context.obj(pageRotate));
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'FreeText',
    Rect: rect,
    DA: PDFString.of('/Helv 14 Tf 0 0 1 rg'),
    Contents: PDFHexString.fromText(text),
    F: 4,
    Border: [0, 0, 0],
    ...(rotate ? { Rotate: rotate } : {}),
  });
  page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  return doc.save({ useObjectStreams: false });
}

async function firstAnnot(bytes: Uint8Array): Promise<{ doc: PDFDocument; annot: PDFDict }> {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  return { doc, annot: annots.lookup(0, PDFDict) };
}

function apStream(doc: PDFDocument, annot: PDFDict): PDFStream | undefined {
  const n = annot.lookupMaybe(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N'));
  const stream = n instanceof PDFRef ? doc.context.lookup(n) : n;
  return stream instanceof PDFStream ? stream : undefined;
}

describe('FreeText appearance fix', () => {
  const rect: Rect = [40, 300, 360, 340];

  it('draws Turkish FreeText that had no appearance, as an incremental update', async () => {
    const input = await freeTextPdf(`Not: ${TURKISH}`, rect);
    expect(await darkPixelRatio(input, 0, rect)).toBe(0);
    const result = await fixUnicodeAppearances(input, fonts, log);
    expect(result.freeTexts).toBe(1);
    expect(Buffer.from(result.bytes.subarray(0, input.length)).equals(Buffer.from(input))).toBe(true);
    const { doc, annot } = await firstAnnot(result.bytes);
    const stream = apStream(doc, annot);
    expect(stream?.dict.get(PDFName.of('SimpaperAP'))).toBeInstanceOf(PDFString);
    expect(stream?.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Font'), PDFDict).has(PDFName.of('SimpaperF1'))).toBe(true);
    // The annotation's own data is untouched.
    expect(annot.lookup(PDFName.of('Contents'), PDFHexString).decodeText()).toBe(`Not: ${TURKISH}`);
    expect(await darkPixelRatio(result.bytes, 0, rect)).toBeGreaterThan(0.01);
  });

  it('is idempotent and regenerates appearances that became stale', async () => {
    const first = await fixUnicodeAppearances(await freeTextPdf(`Şahin ${TURKISH}`, rect), fonts, log);
    const second = await fixUnicodeAppearances(first.bytes, fonts, log);
    expect(second.freeTexts).toBe(0);
    expect(second.bytes).toBe(first.bytes);

    // pdf.js edits the text again but keeps the old /AP: the hash no longer matches.
    const edited = await PDFDocument.load(first.bytes, { forIncrementalUpdate: true });
    const annots = edited.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    annots.lookup(0, PDFDict).set(PDFName.of('Contents'), PDFHexString.fromText('Değişti İĞÜŞ'));
    const third = await fixUnicodeAppearances(await edited.save(), fonts, log);
    expect(third.freeTexts).toBe(1);
  });

  it('recognises appearances written before the rename (/VarakAP) as its own', async () => {
    const first = await fixUnicodeAppearances(await freeTextPdf(`Eski ${TURKISH}`, rect), fonts, log);
    const legacy = await PDFDocument.load(first.bytes, { forIncrementalUpdate: true });
    const annots = legacy.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const stream = apStream(legacy, annots.lookup(0, PDFDict))!;
    stream.dict.set(PDFName.of('VarakAP'), stream.dict.get(PDFName.of('SimpaperAP'))!);
    stream.dict.delete(PDFName.of('SimpaperAP'));
    const old = await legacy.save();
    // Up to date: left alone. Edited afterwards: redrawn (an unknown marker would be kept as someone else's).
    expect((await fixUnicodeAppearances(old, fonts, log)).freeTexts).toBe(0);
    const edited = await PDFDocument.load(old, { forIncrementalUpdate: true });
    edited.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict).set(PDFName.of('Contents'), PDFHexString.fromText('Yeni metin İĞÜŞ'));
    expect((await fixUnicodeAppearances(await edited.save(), fonts, log)).freeTexts).toBe(1);
  });

  it('honours the annotation rotation', async () => {
    const tall: Rect = [150, 60, 190, 360];
    const input = await freeTextPdf(`Dikey ${TURKISH}`, tall, 90, 90);
    const result = await fixUnicodeAppearances(input, fonts, log);
    expect(result.freeTexts).toBe(1);
    expect(await darkPixelRatio(result.bytes, 0, tall)).toBeGreaterThan(0.01);
    expect(await darkPixelRatio(result.bytes, 0, [220, 60, 380, 360])).toBe(0);
  });

  it('leaves documents without FreeText or /NeedAppearances alone', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const bytes = await doc.save();
    const result = await fixUnicodeAppearances(bytes, fonts, log);
    expect(result.bytes).toBe(bytes);
  });

  it('parses /DA strings', () => {
    expect(parseDefaultAppearance('/Helv 14 Tf 0 0 1 rg')).toEqual({ fontSize: 14, colorOp: '0 0 1 rg' });
    expect(parseDefaultAppearance('/Helv 9.5 Tf 0 g')).toEqual({ fontSize: 9.5, colorOp: '0 g' });
    expect(parseDefaultAppearance('0 0 0 1 k /F1 0 Tf')).toEqual({ fontSize: 12, colorOp: '0 0 0 1 k' });
    expect(parseDefaultAppearance('')).toEqual({ fontSize: 12, colorOp: '0 g' });
  });
});

/** The way pdf.js saves a text field value it cannot encode: new /V, no /AP, /NeedAppearances true. */
async function formWithUnencodableValue(value: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await makeFormPdf(), { forIncrementalUpdate: true });
  const field = doc.getForm().getTextField('city');
  const widget = field.acroField.getWidgets()[0]!;
  field.acroField.dict.set(PDFName.of('V'), PDFHexString.fromText(value));
  widget.dict.delete(PDFName.of('AP'));
  doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict).set(PDFName.of('NeedAppearances'), PDFBool.True);
  return doc.save({ useObjectStreams: false });
}

describe('form field appearance fix', () => {
  it('generates appearances for Turkish values and clears /NeedAppearances', async () => {
    const input = await formWithUnencodableValue(`İzmir ${TURKISH}`);
    // Inside the field, away from its border: only the value's glyphs can be dark here.
    // (pdf.js synthesises its own appearance while /NeedAppearances is set, so only the result is checked.)
    const inner: Rect = [64, 703, 240, 721];
    const result = await fixUnicodeAppearances(input, fonts, log);
    expect(result.fields).toBe(1);
    const doc = await PDFDocument.load(result.bytes);
    const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    expect(acroForm.get(PDFName.of('NeedAppearances'))).toBe(PDFBool.False);
    const field = doc.getForm().getField('city');
    expect(field).toBeInstanceOf(PDFTextField);
    expect((field as PDFTextField).getText()).toBe(`İzmir ${TURKISH}`);
    // /DA keeps the field's original font; the appearance carries its own font resources.
    expect(field.acroField.dict.lookup(PDFName.of('DA'), PDFString).decodeText()).toContain('/Helvetica');
    const widget = field.acroField.getWidgets()[0]!;
    expect(widget.dict.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'))).toBeInstanceOf(PDFRef);
    expect(await darkPixelRatio(result.bytes, 1, inner)).toBeGreaterThan(0.05);
  });
});

describe('service integration', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('pdf:update stores the fixed bytes in the working copy', async () => {
    const tmp = await makeTempDir();
    cleanup = tmp.cleanup;
    const wc = join(tmp.dir, 'wc.pdf');
    const input = await freeTextPdf(`Güncelleme ${TURKISH}`, [40, 300, 360, 340]);
    await writeBytes(wc, input);
    const registry = new FakeRegistry();
    registry.add({ docId: 'd', path: null }, wc);
    const dialogs = new FakeDialogs();
    const service = createPdfService({
      registry,
      safeWrite: tempSafeWriter(),
      log,
      fontFiles: fontCandidates,
      dialogs: { saveAs: (w, p) => dialogs.saveAs(w, p), openPdfs: () => dialogs.openPdfs() },
    });
    await service.update('d', input);
    const stored = await readBytes(wc);
    expect(stored.length).toBeGreaterThan(input.length);
    const { doc, annot } = await firstAnnot(stored);
    expect(apStream(doc, annot)).toBeDefined();
  });
});
