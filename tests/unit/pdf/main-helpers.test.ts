import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { detectImageMime, parseHexColor, textLines } from '../../../src/main/pdf/content';
import { codePointsNeedingGlyphs, createFontProvider } from '../../../src/main/pdf/fonts';
import { displayAxes, firstBaseline, imageOrigin, normalizeRotation } from '../../../src/main/pdf/layout';
import { looksLikePdf, usesXrefStream } from '../../../src/main/pdf/load';
import { createKeyedMutex } from '../../../src/main/pdf/mutex';
import { buildPrintHtml } from '../../../src/main/pdf/print';
import { verifyPdfBytes } from '../../../src/main/pdf/verify';
import { TURKISH, fontCandidates, makePagedPdf, memoryLogger } from './helpers';

describe('layout', () => {
  it('normalises rotations', () => {
    expect([0, 90, 180, 270, 360, -90, 450, -180].map(normalizeRotation)).toEqual([0, 90, 180, 270, 0, 270, 90, 180]);
  });

  it('maps the displayed right/down axes into PDF space', () => {
    expect(displayAxes(0)).toEqual({ right: { x: 1, y: 0 }, down: { x: 0, y: -1 } });
    expect(displayAxes(90)).toEqual({ right: { x: 0, y: 1 }, down: { x: 1, y: 0 } });
    expect(displayAxes(180)).toEqual({ right: { x: -1, y: 0 }, down: { x: 0, y: 1 } });
    expect(displayAxes(270)).toEqual({ right: { x: 0, y: -1 }, down: { x: -1, y: 0 } });
  });

  it('computes the first baseline and the image origin from a top-left anchor', () => {
    expect(firstBaseline({ x: 10, y: 100 }, 0, 12)).toEqual({ x: 10, y: 88 });
    expect(firstBaseline({ x: 10, y: 100 }, 90, 12)).toEqual({ x: 22, y: 100 });
    expect(firstBaseline({ x: 10, y: 100 }, 180, 12)).toEqual({ x: 10, y: 112 });
    expect(firstBaseline({ x: 10, y: 100 }, 270, 12)).toEqual({ x: -2, y: 100 });
    expect(imageOrigin({ x: 50, y: 500 }, 0, 40)).toEqual({ x: 50, y: 460 });
    expect(imageOrigin({ x: 50, y: 500 }, 90, 40)).toEqual({ x: 90, y: 500 });
  });
});

describe('content helpers', () => {
  it('parses colours', () => {
    expect(parseHexColor('#ff0000')).toMatchObject({ red: 1, green: 0, blue: 0 });
    expect(parseHexColor('0f0')).toMatchObject({ red: 0, green: 1, blue: 0 });
    expect(parseHexColor('not a colour')).toMatchObject({ red: 0, green: 0, blue: 0 });
  });

  it('splits lines and strips control characters', () => {
    expect(textLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
    expect(textLines('x\ty\u0007z')).toEqual(['x    yz']);
  });

  it('detects image types by signature', () => {
    expect(detectImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(detectImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
  });
});

describe('fonts', () => {
  it('ignores whitespace when collecting required glyphs', () => {
    expect(codePointsNeedingGlyphs('a a\n\tb')).toEqual([0x61, 0x62]);
  });

  it('finds a font covering Turkish letters and falls back to the bundled font', async () => {
    const log = memoryLogger();
    const withEngine = await createFontProvider(fontCandidates, log).resolve(TURKISH).catch(() => null);
    expect(withEngine?.missing).toEqual([]);
    const fallbackOnly = await createFontProvider(() => ['Z:/does/not/exist.ttf'], log).resolve(TURKISH);
    expect(fallbackOnly.path).toMatch(/LiberationSans-Regular\.ttf$/);
    expect(fallbackOnly.missing).toEqual([]);
  });
});

describe('byte checks', () => {
  it('recognises PDFs and the kind of their newest cross-reference section', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const classic = await doc.save({ useObjectStreams: false });
    const stream = await doc.save({ useObjectStreams: true });
    expect(looksLikePdf(classic)).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode('%PDF-1.7 but no end'))).toBe(false);
    expect(usesXrefStream(classic)).toBe(false);
    expect(usesXrefStream(stream)).toBe(true);
  });

  it('verifies page counts and rejects damaged files', async () => {
    const bytes = await makePagedPdf({ pages: 3 });
    await expect(verifyPdfBytes(bytes)).resolves.toMatchObject({ pageCount: 3, encrypted: false });
    await expect(verifyPdfBytes(bytes, { pageCount: 2 })).rejects.toThrow('pdf.errors.verifyFailed');
    await expect(verifyPdfBytes(bytes.subarray(0, Math.floor(bytes.length * 0.6)))).rejects.toThrow('pdf.errors.verifyFailed');
    await expect(verifyPdfBytes(new Uint8Array(0))).rejects.toThrow('pdf.errors.verifyFailed');
  });

  it('verifies encrypted files structurally without the password', async () => {
    const doc = await PDFDocument.load(await makePagedPdf({ pages: 2 }));
    doc.encrypt({ userPassword: 'x', ownerPassword: 'y' });
    await expect(verifyPdfBytes(await doc.save())).resolves.toMatchObject({ pageCount: 2, encrypted: true });
  });
});

describe('keyed mutex', () => {
  it('runs tasks of one key in order and keeps going after failures', async () => {
    const mutex = createKeyedMutex();
    const order: string[] = [];
    const slow = (label: string, ms: number, fail = false) => () =>
      new Promise<string>((resolve, reject) =>
        setTimeout(() => {
          order.push(label);
          if (fail) reject(new Error(label));
          else resolve(label);
        }, ms),
      );
    const a = mutex.run('doc', slow('a', 30));
    const b = mutex.run('doc', slow('b', 1, true));
    const c = mutex.run('doc', slow('c', 1));
    const other = mutex.run('other', slow('x', 1));
    await expect(a).resolves.toBe('a');
    await expect(b).rejects.toThrow('b');
    await expect(c).resolves.toBe('c');
    await other;
    expect(order.filter((l) => l !== 'x')).toEqual(['a', 'b', 'c']);
    expect(order.indexOf('x')).toBeLessThan(order.indexOf('a'));
    await new Promise((r) => setTimeout(r, 0));
    expect(mutex.size).toBe(0);
  });
});

describe('print page', () => {
  it('builds one page box per image, sized by the first page, with an escaped title', () => {
    const html = buildPrintHtml(
      [
        { file: 'page-0001.png', widthPt: 841.89, heightPt: 595.28 },
        { file: 'page-0002.png', widthPt: 595.28, heightPt: 841.89 },
      ],
      'Rapor <ğüş> & "x"',
    );
    expect(html).toContain('@page { size: 841.89pt 595.28pt; margin: 0; }');
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain('<title>Rapor &#60;ğüş&#62; &#38; &#34;x&#34;</title>');
    expect(html).not.toContain('<script');
  });
});
