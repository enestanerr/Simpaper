import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from '@cantoo/pdf-lib';
import { Canvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createPdfService, ensurePdfExtension, pageRangeLabel } from '../../../src/main/pdf';
import type { PdfService } from '../../../src/main/pdf/types';
import {
  FakeDialogs,
  FakeRegistry,
  PDFJS_FONTS,
  TURKISH,
  darkPixelRatio,
  fontCandidates,
  makeFormPdf,
  makePagedPdf,
  makeTempDir,
  makeTurkishPdf,
  memoryLogger,
  pageMarkers,
  readBytes,
  readWithPdfjs,
  tempSafeWriter,
  writeBytes,
  type LogEntry,
} from './helpers';

interface Ctx {
  dir: string;
  cleanup: () => Promise<void>;
  registry: FakeRegistry;
  dialogs: FakeDialogs;
  logs: LogEntry[];
  service: PdfService;
  workingCopy: string;
  original: string;
}

let ctx: Ctx;

async function setup(bytes: Uint8Array, opts: { withPath?: boolean } = {}): Promise<Ctx> {
  const { dir, cleanup } = await makeTempDir();
  const registry = new FakeRegistry();
  const dialogs = new FakeDialogs();
  const logs: LogEntry[] = [];
  const workingCopy = join(dir, 'work', 'wc.pdf');
  const original = join(dir, 'user', 'Belge ğüş.pdf');
  await writeBytes(workingCopy, bytes);
  await writeBytes(original, bytes);
  registry.add({ docId: 'd1', title: 'Belge ğüş.pdf', path: opts.withPath === false ? null : original }, workingCopy);
  const service = createPdfService({
    registry,
    safeWrite: tempSafeWriter(),
    log: memoryLogger(logs),
    fontFiles: fontCandidates,
    dialogs: {
      saveAs: (win, p) => dialogs.saveAs(win, p),
      openPdfs: () => dialogs.openPdfs(),
    },
  });
  return { dir, cleanup, registry, dialogs, logs, service, workingCopy, original };
}

async function expectRejectKey(promise: Promise<unknown>, key: string): Promise<void> {
  await expect(promise).rejects.toThrow(key);
}

async function allStreamText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let out = '';
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        out += Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1');
      } catch {
        out += Buffer.from(obj.getContents()).toString('latin1');
      }
    }
  }
  return out;
}

/** pdf-lib writes standard-font text as hex strings; accept both spellings. */
function hasText(haystack: string, text: string): boolean {
  const hex = Buffer.from(text, 'latin1').toString('hex').toUpperCase();
  return haystack.includes(text) || haystack.toUpperCase().includes(hex);
}

async function pngBytes(w: number, h: number, format: 'png' | 'jpeg' = 'png'): Promise<Uint8Array> {
  const canvas = new Canvas(w, h);
  const c = canvas.getContext('2d');
  c.fillStyle = '#000000';
  c.fillRect(0, 0, w, h);
  return new Uint8Array(format === 'png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg'));
}

afterEach(async () => {
  await ctx?.cleanup();
});

describe('read / update', () => {
  beforeEach(async () => {
    ctx = await setup(await makePagedPdf({ pages: 2 }));
  });

  it('returns the working copy bytes', async () => {
    const bytes = await ctx.service.read('d1');
    expect(Buffer.from(bytes).equals(Buffer.from(await readBytes(ctx.workingCopy)))).toBe(true);
  });

  it('rejects unknown documents and non-PDF bytes', async () => {
    await expectRejectKey(ctx.service.read('nope'), 'pdf.errors.notOpen');
    await expectRejectKey(ctx.service.update('d1', new TextEncoder().encode('hello world, not a pdf at all')), 'pdf.errors.invalidBytes');
    expect(ctx.registry.get('d1')?.descriptor.modified).toBe(false);
  });

  it('writes new bytes to the working copy and marks the document modified', async () => {
    const next = await makePagedPdf({ pages: 3 });
    await ctx.service.update('d1', next);
    expect(await pageMarkers(await readBytes(ctx.workingCopy))).toEqual(['PAGE-1', 'PAGE-2', 'PAGE-3']);
    expect(ctx.registry.get('d1')?.descriptor.modified).toBe(true);
    expect(ctx.registry.events.some((e) => e.type === 'updated' && e.doc.modified)).toBe(true);
    // The user's file is untouched until save.
    expect(await pageMarkers(await readBytes(ctx.original))).toEqual(['PAGE-1', 'PAGE-2']);
  });
});

describe('save', () => {
  it('writes the working copy to the original path through the safe writer and clears modified', async () => {
    ctx = await setup(await makePagedPdf({ pages: 2 }));
    await ctx.service.pages('d1', [{ op: 'move', pageIndex: 1, value: 0 }]);
    const result = await ctx.service.save('d1', false, null);
    expect(result).toEqual({ outcome: 'saved', path: ctx.original, format: 'pdf' });
    expect(await pageMarkers(await readBytes(ctx.original))).toEqual(['PAGE-2', 'PAGE-1']);
    const desc = ctx.registry.get('d1')!.descriptor;
    expect(desc.modified).toBe(false);
    expect(desc.title).toBe('Belge ğüş.pdf');
    expect(ctx.dialogs.saveAsCalls).toEqual([]);
    const busy = ctx.registry.events.filter((e) => e.type === 'busy');
    expect(busy.map((e) => e.type === 'busy' && e.busy)).toEqual([true, false]);
  });

  it('asks for a path for new documents and appends .pdf', async () => {
    ctx = await setup(await makePagedPdf({ pages: 1 }), { withPath: false });
    const target = join(ctx.dir, 'out', 'Yeni belge');
    ctx.dialogs.saveAsResults = [target];
    const result = await ctx.service.save('d1', false, null);
    expect(result.outcome).toBe('saved');
    expect(result.path).toBe(`${target}.pdf`);
    expect(ctx.dialogs.saveAsCalls).toEqual(['Belge ğüş.pdf']);
    expect(ctx.registry.get('d1')!.descriptor).toMatchObject({ path: `${target}.pdf`, title: 'Yeni belge.pdf', modified: false });
    expect((await readWithPdfjs(await readBytes(`${target}.pdf`))).length).toBe(1);
  });

  it('save as always shows the dialog; cancelling writes nothing', async () => {
    ctx = await setup(await makePagedPdf({ pages: 1 }));
    ctx.dialogs.saveAsResults = [null];
    expect(await ctx.service.save('d1', true, null)).toEqual({ outcome: 'cancelled' });
    expect(ctx.dialogs.saveAsCalls).toEqual([ctx.original]);
    expect(ctx.registry.get('d1')!.descriptor.path).toBe(ctx.original);
  });

  it('fails verification of a corrupt working copy and leaves the original untouched', async () => {
    ctx = await setup(await makePagedPdf({ pages: 2 }));
    const before = await readBytes(ctx.original);
    const corrupt = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< garbage >>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    await writeBytes(ctx.workingCopy, corrupt);
    const result = await ctx.service.save('d1', false, null);
    expect(result.outcome).toBe('failed');
    expect(result.errorKey).toBe('pdf.errors.verifyFailed');
    expect(Buffer.from(await readBytes(ctx.original)).equals(Buffer.from(before))).toBe(true);
    expect(ctx.registry.get('d1')!.descriptor.modified).toBe(false);
  });

  it('warns before overwriting a signed original with a rewritten file and can save a copy instead', async () => {
    const signedDoc = await PDFDocument.load(await makePagedPdf({ pages: 2 }));
    signedDoc.catalog.set(PDFName.of('VarakTestSig'), signedDoc.context.obj({ Type: 'Sig', ByteRange: [0, 10, 20, 30], Contents: PDFString.of('00') }));
    // Signature dictionaries are never inside object streams in real files.
    const signed = await signedDoc.save({ useObjectStreams: false });
    ctx = await setup(signed);
    await ctx.service.pages('d1', [{ op: 'rotate', pageIndex: 0, value: 90 }]);

    ctx.registry.promptAnswer = { kind: 'saveRisk', choice: 'cancel' };
    expect(await ctx.service.save('d1', false, null)).toEqual({ outcome: 'cancelled' });
    expect(ctx.registry.prompts[0]).toMatchObject({ kind: 'saveRisk', docId: 'd1', format: 'pdf', findings: [{ id: 'digitalSignature' }] });
    expect(Buffer.from(await readBytes(ctx.original)).equals(Buffer.from(signed))).toBe(true);

    ctx.registry.promptAnswer = { kind: 'saveRisk', choice: 'saveCopy' };
    const copy = join(ctx.dir, 'user', 'kopya.pdf');
    ctx.dialogs.saveAsResults = [copy];
    const result = await ctx.service.save('d1', false, null);
    expect(result).toEqual({ outcome: 'savedCopy', path: copy, format: 'pdf' });
    expect((await readWithPdfjs(await readBytes(copy)))[0]?.rotation).toBe(90);
    expect(Buffer.from(await readBytes(ctx.original)).equals(Buffer.from(signed))).toBe(true);
    expect(ctx.registry.get('d1')!.descriptor).toMatchObject({ path: ctx.original, modified: true });
  });
});

describe('page operations', () => {
  it('rotates relative to the current rotation', async () => {
    ctx = await setup(await makePagedPdf({ pages: 3, rotation: (i) => (i === 1 ? 90 : 0) }));
    const out = await ctx.service.pages('d1', [
      { op: 'rotate', pageIndex: 0, value: 90 },
      { op: 'rotate', pageIndex: 1, value: -90 },
      { op: 'rotate', pageIndex: 2, value: 270 },
      { op: 'rotate', pageIndex: 2, value: 180 },
    ]);
    const pages = await readWithPdfjs(out);
    expect(pages.map((p) => p.rotation)).toEqual([90, 0, 90]);
    expect(await pageMarkers(await readBytes(ctx.workingCopy))).toEqual(['PAGE-1', 'PAGE-2', 'PAGE-3']);
  });

  it('deletes, moves, duplicates and inserts blank pages in sequence', async () => {
    ctx = await setup(await makePagedPdf({ pages: 4, size: (i) => (i === 2 ? [842, 595] : [595, 842]), rotation: (i) => (i === 2 ? 90 : 0) }));
    const out = await ctx.service.pages('d1', [
      { op: 'delete', pageIndex: 0 }, // 2 3 4
      { op: 'move', pageIndex: 2, value: 0 }, // 4 2 3
      { op: 'duplicate', pageIndex: 1 }, // 4 2 2 3
      { op: 'insertBlank', pageIndex: 4 }, // 4 2 2 3 _ (size/rotation of page 3)
      { op: 'insertBlank', pageIndex: 0 }, // _ 4 2 2 3 _
    ]);
    expect(await pageMarkers(out)).toEqual(['', 'PAGE-4', 'PAGE-2', 'PAGE-2', 'PAGE-3', '']);
    const pages = await readWithPdfjs(out);
    expect(pages[5]).toMatchObject({ width: 842, height: 595, rotation: 90 });
    expect(pages[0]).toMatchObject({ width: 595, height: 842, rotation: 0 });
    expect(ctx.registry.get('d1')!.descriptor.modified).toBe(true);
  });

  it('moves a page to the end', async () => {
    ctx = await setup(await makePagedPdf({ pages: 3 }));
    const out = await ctx.service.pages('d1', [{ op: 'move', pageIndex: 0, value: 2 }]);
    expect(await pageMarkers(out)).toEqual(['PAGE-2', 'PAGE-3', 'PAGE-1']);
  });

  it('refuses to delete the last page and rejects invalid indices without touching the working copy', async () => {
    ctx = await setup(await makePagedPdf({ pages: 1 }));
    const before = await readBytes(ctx.workingCopy);
    await expectRejectKey(ctx.service.pages('d1', [{ op: 'delete', pageIndex: 0 }]), 'pdf.errors.lastPage');
    await expectRejectKey(ctx.service.pages('d1', [{ op: 'rotate', pageIndex: 3, value: 90 }]), 'pdf.errors.invalidPage');
    await expectRejectKey(ctx.service.pages('d1', [{ op: 'rotate', pageIndex: 0, value: 45 }]), 'pdf.errors.invalidOp');
    await expectRejectKey(ctx.service.pages('d1', []), 'pdf.errors.invalidOp');
    expect(Buffer.from(await readBytes(ctx.workingCopy)).equals(Buffer.from(before))).toBe(true);
    expect(ctx.registry.get('d1')!.descriptor.modified).toBe(false);
  });

  it('removes the content and form fields of deleted pages from the file', async () => {
    ctx = await setup(await makeFormPdf());
    const before = await allStreamText(await readBytes(ctx.workingCopy));
    expect(hasText(before, 'FORM-PAGE-2')).toBe(true);
    const out = await ctx.service.pages('d1', [{ op: 'delete', pageIndex: 1 }]);
    const text = await allStreamText(out);
    expect(hasText(text, 'FORM-PAGE-1')).toBe(true);
    expect(hasText(text, 'FORM-PAGE-2')).toBe(false);
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getFields().map((f) => f.getName()).sort()).toEqual(['agree', 'name']);
  });

  it('serialises concurrent operations on the same document', async () => {
    ctx = await setup(await makePagedPdf({ pages: 2 }));
    await Promise.all([
      ctx.service.pages('d1', [{ op: 'rotate', pageIndex: 0, value: 90 }]),
      ctx.service.pages('d1', [{ op: 'rotate', pageIndex: 0, value: 90 }]),
      ctx.service.pages('d1', [{ op: 'rotate', pageIndex: 0, value: 90 }]),
    ]);
    expect((await readWithPdfjs(await readBytes(ctx.workingCopy)))[0]?.rotation).toBe(270);
  });

  it('refuses page operations on encrypted documents instead of dropping their protection', async () => {
    const doc = await PDFDocument.load(await makePagedPdf({ pages: 2 }));
    doc.encrypt({ userPassword: 'gizli', ownerPassword: 'sahip' });
    ctx = await setup(await doc.save());
    await expectRejectKey(ctx.service.pages('d1', [{ op: 'rotate', pageIndex: 0, value: 90 }]), 'pdf.errors.encrypted');
    await expectRejectKey(ctx.service.insertText('d1', [{ pageIndex: 0, x: 10, y: 10, text: 'x', fontSize: 12, color: '#000000' }]), 'pdf.errors.encrypted');
  });
});

describe('merge and extract', () => {
  it('appends the pages of other files and keeps their form fields (renaming clashes)', async () => {
    ctx = await setup(await makeFormPdf());
    const other = join(ctx.dir, 'in', 'other.pdf');
    await writeBytes(other, await makeFormPdf('B-'));
    const third = join(ctx.dir, 'in', 'third.pdf');
    await writeBytes(third, await makeFormPdf());
    const out = await ctx.service.merge('d1', [other, third], null);
    const markers = (await readWithPdfjs(out)).map((p) => /[A-Z-]*FORM-PAGE-\d/.exec(p.text)?.[0]);
    expect(markers).toEqual(['FORM-PAGE-1', 'FORM-PAGE-2', 'B-FORM-PAGE-1', 'B-FORM-PAGE-2', 'FORM-PAGE-1', 'FORM-PAGE-2']);
    const task = getDocument({ data: out.slice(), verbosity: 0, standardFontDataUrl: `${PDFJS_FONTS}/` });
    const pdf = await task.promise;
    const fieldObjects: unknown = await pdf.getFieldObjects();
    const fields = (fieldObjects instanceof Map ? [...fieldObjects.keys()] : Object.keys(fieldObjects ?? {})).sort();
    await task.destroy();
    expect(fields).toEqual(['B-agree', 'B-city', 'B-name', 'agree', 'agree_2', 'city', 'city_2', 'name', 'name_2']);
  });

  it('uses the open dialog when no paths are given and reports cancellation', async () => {
    ctx = await setup(await makePagedPdf({ pages: 1 }));
    const other = join(ctx.dir, 'in', 'other.pdf');
    await writeBytes(other, await makePagedPdf({ pages: 2 }));
    ctx.dialogs.openResults = [[other], []];
    expect(await pageMarkers(await ctx.service.merge('d1', undefined, null))).toEqual(['PAGE-1', 'PAGE-1', 'PAGE-2']);
    await expectRejectKey(ctx.service.merge('d1', undefined, null), 'pdf.errors.cancelled');
  });

  it('names the file when a merge source is encrypted or broken', async () => {
    ctx = await setup(await makePagedPdf({ pages: 1 }));
    const enc = await PDFDocument.load(await makePagedPdf({ pages: 1 }));
    enc.encrypt({ userPassword: 'a', ownerPassword: 'b' });
    const encPath = join(ctx.dir, 'in', 'kilitli.pdf');
    await writeBytes(encPath, await enc.save());
    await expect(ctx.service.merge('d1', [encPath], null)).rejects.toMatchObject({
      message: 'pdf.errors.mergeEncrypted',
      detail: expect.stringContaining('kilitli.pdf'),
    });
    await expect(ctx.service.merge('d1', [join(ctx.dir, 'missing.pdf')], null)).rejects.toMatchObject({
      message: 'pdf.errors.mergeParse',
      detail: expect.stringContaining('missing.pdf'),
    });
  });

  it('extracts selected pages, in the given order, to a new verified file', async () => {
    ctx = await setup(await makePagedPdf({ pages: 5 }));
    const target = join(ctx.dir, 'out', 'secim');
    ctx.dialogs.saveAsResults = [target];
    const result = await ctx.service.extract('d1', [3, 0, 1], null);
    expect(result).toEqual({ outcome: 'savedCopy', path: `${target}.pdf`, format: 'pdf' });
    expect(ctx.dialogs.saveAsCalls).toEqual(['Belge ğüş_1-2,4.pdf']);
    expect(await pageMarkers(await readBytes(`${target}.pdf`))).toEqual(['PAGE-4', 'PAGE-1', 'PAGE-2']);
    // The open document is not changed by an extraction.
    expect(ctx.registry.get('d1')!.descriptor.modified).toBe(false);
  });

  it('reports invalid selections, cancellation and the open file as target', async () => {
    ctx = await setup(await makePagedPdf({ pages: 2 }));
    expect((await ctx.service.extract('d1', [], null)).errorKey).toBe('pdf.errors.invalidPage');
    expect((await ctx.service.extract('d1', [0, 0], null)).errorKey).toBe('pdf.errors.invalidPage');
    expect((await ctx.service.extract('d1', [7], null)).errorKey).toBe('pdf.errors.invalidPage');
    ctx.dialogs.saveAsResults = [null];
    expect(await ctx.service.extract('d1', [1], null)).toEqual({ outcome: 'cancelled' });
    ctx.dialogs.saveAsResults = [ctx.original];
    expect((await ctx.service.extract('d1', [1], null)).errorKey).toBe('pdf.errors.extractSameFile');
    expect(await pageMarkers(await readBytes(ctx.original))).toEqual(['PAGE-1', 'PAGE-2']);
  });
});

describe('add text and images', () => {
  it('writes Turkish text that pdf.js extracts, as an incremental update', async () => {
    const input = await makePagedPdf({ pages: 2 });
    ctx = await setup(input);
    const text = `Merhaba ${TURKISH}\nİkinci satır`;
    const out = await ctx.service.insertText('d1', [{ pageIndex: 1, x: 72, y: 700, text, fontSize: 14, color: '#c0303f' }]);
    expect(Buffer.from(out.subarray(0, input.length)).equals(Buffer.from(input))).toBe(true);
    const pages = await readWithPdfjs(out);
    expect(pages[1]?.text).toContain(`Merhaba ${TURKISH}`);
    expect(pages[1]?.text).toContain('İkinci satır');
    expect(pages[0]?.text).not.toContain('Merhaba');
    // The text lands where it was asked for (top-left anchor at 72/700).
    expect(await darkPixelRatio(out, 1, [72, 680, 260, 700])).toBeGreaterThan(0.02);
    expect(await darkPixelRatio(out, 1, [300, 400, 500, 500])).toBe(0);
    // Logs never contain document text.
    expect(JSON.stringify(ctx.logs)).not.toContain('Merhaba');
  });

  it('keeps text upright on rotated pages', async () => {
    ctx = await setup(await makePagedPdf({ pages: 1, rotation: () => 90 }));
    const out = await ctx.service.insertText('d1', [{ pageIndex: 0, x: 100, y: 100, text: `Döndürülmüş ${TURKISH}`, fontSize: 12, color: '#000' }]);
    const task = getDocument({ data: out.slice(), verbosity: 0, standardFontDataUrl: `${PDFJS_FONTS}/` });
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const items = (await page.getTextContent()).items.filter((i) => 'str' in i && i.str.includes('Döndürülmüş'));
    await task.destroy();
    expect(items).toHaveLength(1);
    const item = items[0] as { transform: number[] };
    // Text matrix rotated by +90° (reads upwards in PDF space = left-to-right on the displayed page).
    expect(item.transform[0]).toBeCloseTo(0, 5);
    expect(item.transform[1]).toBeGreaterThan(0);
    // Top-left anchor: the baseline is one ascent to the right (+x) of the anchor.
    expect(item.transform[4]).toBeGreaterThan(100);
    expect(item.transform[5]).toBeCloseTo(100, 0);
  });

  it('adds text to a page whose content leaves a scaled matrix behind', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    // Unbalanced content: scales everything that follows by 0.1.
    const stream = doc.context.flateStream('0.1 0 0 0.1 0 0 cm');
    page.node.set(PDFName.of('Contents'), doc.context.register(stream));
    ctx = await setup(await doc.save());
    const out = await ctx.service.insertText('d1', [{ pageIndex: 0, x: 50, y: 350, text: 'Ölçek', fontSize: 30, color: '#000000' }]);
    expect(await darkPixelRatio(out, 0, [50, 310, 200, 350])).toBeGreaterThan(0.02);
  });

  it('rejects empty text and bad sizes', async () => {
    ctx = await setup(await makePagedPdf({ pages: 1 }));
    await expectRejectKey(ctx.service.insertText('d1', [{ pageIndex: 0, x: 1, y: 1, text: '   ', fontSize: 12, color: '#000' }]), 'pdf.errors.emptyText');
    await expectRejectKey(ctx.service.insertText('d1', [{ pageIndex: 0, x: 1, y: 1, text: 'a', fontSize: 0, color: '#000' }]), 'pdf.errors.invalidOp');
    await expectRejectKey(ctx.service.insertText('d1', [{ pageIndex: 4, x: 1, y: 1, text: 'a', fontSize: 12, color: '#000' }]), 'pdf.errors.invalidPage');
  });

  it('draws PNG and JPEG images at the requested place', async () => {
    ctx = await setup(await makePagedPdf({ pages: 1 }));
    const png = await pngBytes(40, 20, 'png');
    let out = await ctx.service.insertImage('d1', { pageIndex: 0, x: 300, y: 500, width: 100, height: 50, data: png, mime: 'image/png' });
    expect(await darkPixelRatio(out, 0, [305, 455, 395, 495])).toBeGreaterThan(0.95);
    expect(await darkPixelRatio(out, 0, [300, 380, 400, 440])).toBe(0);
    const jpg = await pngBytes(30, 30, 'jpeg');
    out = await ctx.service.insertImage('d1', { pageIndex: 0, x: 100, y: 300, width: 60, height: 60, data: jpg, mime: 'image/jpeg' });
    expect(await darkPixelRatio(out, 0, [105, 245, 155, 295])).toBeGreaterThan(0.95);
  });

  it('places images upright on rotated pages', async () => {
    ctx = await setup(await makePagedPdf({ pages: 1, rotation: () => 90 }));
    const png = await pngBytes(10, 10, 'png');
    // Displayed top-left corner at PDF (200, 300); displayed height 80 runs along PDF +x.
    const out = await ctx.service.insertImage('d1', { pageIndex: 0, x: 200, y: 300, width: 120, height: 80, data: png, mime: 'image/png' });
    expect(await darkPixelRatio(out, 0, [205, 305, 275, 415])).toBeGreaterThan(0.95);
    expect(await darkPixelRatio(out, 0, [120, 305, 195, 415])).toBe(0);
  });

  it('rejects images whose bytes do not match the declared type', async () => {
    ctx = await setup(await makePagedPdf({ pages: 1 }));
    const png = await pngBytes(4, 4, 'png');
    await expectRejectKey(ctx.service.insertImage('d1', { pageIndex: 0, x: 0, y: 100, width: 10, height: 10, data: png, mime: 'image/jpeg' }), 'pdf.errors.imageFormat');
    await expectRejectKey(ctx.service.insertImage('d1', { pageIndex: 0, x: 0, y: 100, width: 10, height: 10, data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), mime: 'image/png' }), 'pdf.errors.imageFormat');
  });
});

describe('print', () => {
  it('refuses to print without rendered pages or with invalid images (no window is created)', async () => {
    ctx = await setup(await makePagedPdf({ pages: 1 }));
    await expectRejectKey(ctx.service.print('d1', null), 'pdf.errors.printNothing');
    await expectRejectKey(ctx.service.print('d1', null, []), 'pdf.errors.printNothing');
    await expectRejectKey(
      ctx.service.print('d1', null, [{ data: new Uint8Array([0, 1, 2]), mime: 'image/png', widthPt: 595, heightPt: 842 }]),
      'pdf.errors.printFailed',
    );
    await expectRejectKey(ctx.service.print('x', null, []), 'pdf.errors.notOpen');
  });
});

describe('Turkish round trip', () => {
  it('keeps embedded Turkish text readable through page operations and save', async () => {
    ctx = await setup(await makeTurkishPdf());
    await ctx.service.pages('d1', [{ op: 'insertBlank', pageIndex: 1 }, { op: 'rotate', pageIndex: 0, value: 180 }]);
    expect((await ctx.service.save('d1', false, null)).outcome).toBe('saved');
    const pages = await readWithPdfjs(await readBytes(ctx.original));
    expect(pages).toHaveLength(2);
    expect(pages[0]?.text).toContain(TURKISH);
    expect(pages[0]?.rotation).toBe(180);
  });
});

describe('helpers', () => {
  it('formats page ranges for file names and adds .pdf', () => {
    expect(pageRangeLabel([0, 1, 2, 4, 6, 7])).toBe('1-3,5,7-8');
    expect(pageRangeLabel([5, 3, 4])).toBe('4-6');
    expect(ensurePdfExtension('a/b')).toBe('a/b.pdf');
    expect(ensurePdfExtension('a/b.PDF')).toBe('a/b.PDF');
  });
});
