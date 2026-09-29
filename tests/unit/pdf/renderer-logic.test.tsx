/**
 * Pure renderer logic of the PDF module: Turkish search folding, viewport↔PDF coordinates (checked against
 * pdf.js' PageViewport), page-operation planning, zoom, colours, error keys and form-field order.
 * (.tsx: tests importing renderer modules stay out of tsconfig.node.json, whose composite project cannot include
 * src/renderer; they are type-checked with tests/unit/pdf/tsconfig.renderer-tests.json.)
 */
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfPageOp } from '@shared/api/pdf';
import { fieldStops, nextStop } from '../../../src/renderer/modules/pdf/logic/fields';
import {
  applyInverseTransform,
  applyTransform,
  clientToPdf,
  defaultImageSize,
  displayedPageSize,
  viewportTransform,
  type ViewBox,
} from '../../../src/renderer/modules/pdf/logic/geometry';
import { colorNumberToHex, errorKeyOf, hexToColorNumber, isCancellation } from '../../../src/renderer/modules/pdf/logic/misc';
import {
  NEW_PAGE,
  formatPageRanges,
  mapIndex,
  mapSelection,
  parsePageRanges,
  planDelete,
  planDuplicate,
  planInsertBlank,
  planMove,
  planNudge,
  planRotate,
  simulate,
} from '../../../src/renderer/modules/pdf/logic/pages';
import { findMatches, foldQuery, foldTurkishI } from '../../../src/renderer/modules/pdf/logic/search';
import { nextZoomStep, parseZoomValue, zoomPercent } from '../../../src/renderer/modules/pdf/logic/zoom';
import { PDFJS_FONTS, makePagedPdf } from './helpers';
import { PDFDocument, degrees } from '@cantoo/pdf-lib';

describe('Turkish search folding', () => {
  it('folds every I variant to i and keeps the length', () => {
    const text = 'İSTANBUL ıssız Irmak ilk';
    const folded = foldTurkishI(text);
    expect(folded).toBe('iSTANBUL issiz irmak ilk');
    expect(folded.length).toBe(text.length);
    expect(foldQuery(['Iğdır', 'ılık'])).toEqual(['iğdir', 'ilik']);
  });

  it('finds İstanbul/ISTANBUL/ıstanbul for "istanbul" and ILIK for "ılık"', () => {
    const page = 'İSTANBUL, Istanbul, ıstanbul ve istanbul. Hava ILIK, ılık.';
    expect(findMatches(page, 'istanbul')).toHaveLength(4);
    expect(findMatches(page, 'İSTANBUL')).toHaveLength(4);
    expect(findMatches(page, 'ılık').map((m) => page.slice(m.index, m.index + m.length))).toEqual(['ILIK', 'ılık']);
    expect(findMatches(page, 'şehir')).toEqual([]);
    expect(findMatches('ŞEHİR', 'şehir')).toHaveLength(1);
  });

  it('respects case-sensitive searches', () => {
    expect(findMatches('İstanbul istanbul', 'istanbul', { caseSensitive: true })).toEqual([{ index: 9, length: 8 }]);
  });
});

describe('viewport ↔ PDF coordinates', () => {
  const box: ViewBox = [0, 0, 612, 792];

  it('matches pdf.js PageViewport for every rotation and offset view boxes', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.setCropBox(30, 40, 500, 700);
    const rotated = doc.addPage([400, 300]);
    rotated.setRotation(degrees(90));
    const task = getDocument({ data: await doc.save(), verbosity: 0, standardFontDataUrl: `${PDFJS_FONTS}/` });
    try {
      const pdf = await task.promise;
      for (const pageNumber of [1, 2]) {
        const p = await pdf.getPage(pageNumber);
        for (const rotation of [0, 90, 180, 270]) {
          for (const scale of [0.5, 1.333, 2]) {
            const viewport = p.getViewport({ scale, rotation });
            const m = viewportTransform(p.view as ViewBox, scale, rotation);
            viewport.transform.forEach((v: number, i: number) => expect(m[i]).toBeCloseTo(v, 9));
            for (const [x, y] of [
              [0, 0],
              [17, 250],
              [viewport.width, viewport.height],
            ]) {
              const [px, py] = viewport.convertToPdfPoint(x!, y!) as [number, number];
              const [qx, qy] = applyInverseTransform(m, x!, y!);
              expect(qx).toBeCloseTo(px, 9);
              expect(qy).toBeCloseTo(py, 9);
            }
          }
        }
      }
    } finally {
      await task.destroy();
    }
  });

  it('round-trips points and maps screen clicks into the page', () => {
    const m = viewportTransform(box, 1.5, 90);
    const [x, y] = applyTransform(m, 100, 700);
    const [bx, by] = applyInverseTransform(m, x, y);
    expect(bx).toBeCloseTo(100, 9);
    expect(by).toBeCloseTo(700, 9);
    const screen = { left: 200, top: 50, width: 792 * 1.5, height: 612 * 1.5 };
    // Top-left of the displayed (90°) page is the PDF origin corner (0, 0).
    const [cx, cy] = clientToPdf(screen, m, 200, 50)!;
    expect(cx).toBeCloseTo(0, 9);
    expect(cy).toBeCloseTo(0, 9);
    expect(clientToPdf(screen, m, 199, 50)).toBeNull();
  });

  it('computes displayed sizes and default image sizes', () => {
    expect(displayedPageSize(box, 90)).toEqual({ width: 792, height: 612 });
    expect(displayedPageSize(box, 180)).toEqual({ width: 612, height: 792 });
    expect(defaultImageSize(200, 100, 612, 792)).toEqual({ width: 150, height: 75 });
    const big = defaultImageSize(4000, 2000, 612, 792);
    expect(big.width).toBeCloseTo(306, 6);
    expect(big.height).toBeCloseTo(153, 6);
  });
});

describe('page-operation planning', () => {
  const apply = (count: number, ops: PdfPageOp[]) => simulate(count, ops);

  it('moves single pages with one op and blocks with correct order', () => {
    expect(planMove([0], 4, 4)).toEqual([{ op: 'move', pageIndex: 0, value: 3 }]);
    expect(planMove([2], 2, 4)).toEqual([]);
    expect(planMove([2], 3, 4)).toEqual([]);
    for (const [selected, slot, expected] of [
      [[1, 3], 0, [1, 3, 0, 2, 4]],
      [[0, 1], 3, [2, 0, 1, 3, 4]],
      [[0, 4], 2, [1, 0, 4, 2, 3]],
      [[3, 1], 5, [0, 2, 4, 1, 3]],
    ] as [number[], number, number[]][]) {
      expect(apply(5, planMove(selected, slot, 5))).toEqual(expected);
    }
  });

  it('nudges selections up and down and refuses at the edges', () => {
    expect(apply(6, planNudge([2, 3], -1, 6))).toEqual([0, 2, 3, 1, 4, 5]);
    expect(apply(6, planNudge([2, 3], 1, 6))).toEqual([0, 1, 4, 2, 3, 5]);
    expect(planNudge([0, 1], -1, 6)).toEqual([]);
    expect(planNudge([5], 1, 6)).toEqual([]);
  });

  it('deletes and duplicates from the back', () => {
    expect(planDelete([1, 3, 1], 5)).toEqual([
      { op: 'delete', pageIndex: 3 },
      { op: 'delete', pageIndex: 1 },
    ]);
    expect(planDelete([0, 1], 2)).toEqual([]);
    expect(apply(4, planDuplicate([0, 2]))).toEqual([0, 0, 1, 2, 2, 3]);
    expect(apply(2, planInsertBlank(1))).toEqual([0, NEW_PAGE, 1]);
    expect(planRotate([2, 0], 90)).toEqual([
      { op: 'rotate', pageIndex: 0, value: 90 },
      { op: 'rotate', pageIndex: 2, value: 90 },
    ]);
  });

  it('maps the current page and the selection through the ops', () => {
    const ops = planDelete([1, 2], 5);
    expect(mapIndex(5, ops, 3)).toBe(1);
    expect(mapIndex(5, ops, 1)).toBe(1);
    expect(mapIndex(5, planMove([0], 5, 5), 0)).toBe(4);
    expect(mapSelection(5, planMove([1, 3], 0, 5), [1, 3])).toEqual([0, 1]);
    expect(mapSelection(4, planDuplicate([1]), [1])).toEqual([1]);
  });

  it('parses and formats page ranges', () => {
    expect(parsePageRanges('1-3, 5; 8-', 9)).toEqual([0, 1, 2, 4, 7, 8]);
    expect(parsePageRanges('4-2', 5)).toEqual([3, 2, 1]);
    expect(parsePageRanges('2, 2, 1', 5)).toEqual([1, 0]);
    expect(parsePageRanges('0', 5)).toBeNull();
    expect(parsePageRanges('6', 5)).toBeNull();
    expect(parsePageRanges('a', 5)).toBeNull();
    expect(parsePageRanges('', 5)).toBeNull();
    expect(formatPageRanges([4, 0, 1, 2, 7])).toBe('1-3, 5, 8');
  });
});

describe('zoom, colours, errors, fields', () => {
  it('steps and parses zoom values', () => {
    expect(nextZoomStep(1, 1)).toBe(1.1);
    expect(nextZoomStep(1, -1)).toBe(0.9);
    expect(nextZoomStep(1.3, 1)).toBe(1.5);
    expect(nextZoomStep(10, 1)).toBe(10);
    expect(parseZoomValue('125')).toBe('1.25');
    expect(parseZoomValue('%80')).toBe('0.8');
    expect(parseZoomValue('1,5')).toBe('1.5');
    expect(parseZoomValue('page-width')).toBe('page-width');
    expect(parseZoomValue('abc')).toBeNull();
    expect(zoomPercent(1.254)).toBe(125);
  });

  it('converts colours', () => {
    expect(colorNumberToHex(0xc0303f)).toBe('#c0303f');
    expect(colorNumberToHex(0x0000ff)).toBe('#0000ff');
    expect(hexToColorNumber('#C0303F')).toBe(0xc0303f);
    expect(hexToColorNumber('red')).toBeNull();
  });

  it('extracts i18n keys from IPC rejections', () => {
    expect(errorKeyOf(new Error("Error invoking remote method 'pdf:pages': IpcRequestError: pdf.errors.encrypted"))).toBe('pdf.errors.encrypted');
    expect(errorKeyOf(new Error("Error invoking remote method 'pdf:read': IpcRequestError: errors.ipc.unknownDocument"))).toBe('errors.ipc.unknownDocument');
    expect(errorKeyOf(new Error('boom'))).toBeNull();
    expect(isCancellation(new Error('x: pdf.errors.cancelled'))).toBe(true);
  });

  it('orders form fields for keyboard navigation', () => {
    const fields = new Map<string, unknown[]>([
      ['b', [{ id: '2R', page: 0, rect: [50, 500, 200, 520], type: 'text', editable: true }]],
      ['a', [{ id: '1R', page: 0, rect: [50, 700, 200, 720], type: 'text', editable: true }]],
      ['c', [{ id: '3R', page: 1, rect: [10, 10, 20, 20], type: 'checkbox', editable: true }]],
      ['hidden', [{ id: '4R', page: 0, rect: [0, 0, 1, 1], type: 'text', hidden: true }]],
      ['button', [{ id: '5R', page: 0, rect: [0, 0, 1, 1], type: 'button' }]],
    ]);
    expect(fieldStops(fields).map((f) => f.id)).toEqual(['1R', '2R', '3R']);
    expect(fieldStops(null)).toEqual([]);
    expect(nextStop(3, -1, 1)).toBe(0);
    expect(nextStop(3, -1, -1)).toBe(2);
    expect(nextStop(3, 2, 1)).toBe(0);
    expect(nextStop(0, 0, 1)).toBe(-1);
  });
});

describe('fixtures', () => {
  it('pdf.js reads the generated fixture', async () => {
    const bytes = await makePagedPdf({ pages: 2 });
    const task = getDocument({ data: bytes, verbosity: 0, standardFontDataUrl: `${PDFJS_FONTS}/` });
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(2);
    await task.destroy();
  });
});
