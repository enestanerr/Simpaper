import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';
import { CORPUS_OUTPUT } from '../../tools/paths';
import { comparePng, describeDiff, inkRatio, maskStatistics, withinBudget } from '../../tools/visual';

function image(width: number, height: number, paint?: (x: number, y: number) => [number, number, number] | undefined): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint?.(x, y) ?? [255, 255, 255];
      const i = (y * width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const square = (x0: number, y0: number, size: number, rgb: [number, number, number]) => (x: number, y: number) =>
  x >= x0 && x < x0 + size && y >= y0 && y < y0 + size ? rgb : undefined;

mkdirSync(CORPUS_OUTPUT, { recursive: true });
const outDir = mkdtempSync(join(CORPUS_OUTPUT, 'unit-visual-'));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe('comparePng', () => {
  it('reports no difference for identical images', () => {
    const a = image(100, 100, square(10, 10, 20, [0, 0, 0]));
    const r = comparePng(a, a, { maxRatio: 0, name: 'same', outDir });
    expect(r).toMatchObject({ diffPixels: 0, ratio: 0, passed: true, sizeMismatch: false });
    expect(r.diffPath).toBeUndefined();
  });

  it('counts changed pixels and writes diff images only for failures', () => {
    const a = image(100, 100);
    const b = image(100, 100, square(0, 0, 10, [200, 0, 0]));
    const r = comparePng(a, b, { maxRatio: 0.005, name: 'red-square', outDir });
    expect(r.diffPixels).toBe(100);
    expect(r.ratio).toBeCloseTo(0.01, 6);
    expect(r.passed).toBe(false);
    expect(r.diffPath && existsSync(r.diffPath)).toBe(true);
    expect(existsSync(join(outDir, 'red-square.expected.png'))).toBe(true);
    expect(existsSync(join(outDir, 'red-square.actual.png'))).toBe(true);
    const ok = comparePng(a, b, { maxRatio: 0.02, name: 'red-square-ok', outDir });
    expect(ok.passed).toBe(true);
    expect(existsSync(join(outDir, 'red-square-ok.diff.png'))).toBe(false);
  });

  it('ignores colour differences below the threshold', () => {
    const a = image(50, 50, square(0, 0, 50, [128, 128, 128]));
    const b = image(50, 50, square(0, 0, 50, [131, 131, 131]));
    expect(comparePng(a, b, { writeDiff: 'never' }).diffPixels).toBe(0);
    expect(comparePng(a, b, { threshold: 0, writeDiff: 'never' }).diffPixels).toBe(2500);
  });

  it('flags size mismatches and compares on a white canvas', () => {
    const a = image(40, 40);
    const b = image(40, 50, square(0, 45, 5, [0, 0, 0]));
    const r = comparePng(a, b, { maxRatio: 1, writeDiff: 'never' });
    expect(r.sizeMismatch).toBe(true);
    expect([r.width, r.height]).toEqual([40, 50]);
    expect(r.diffPixels).toBe(25);
    expect(r.passed).toBe(false);
  });

  it('reports the densest window and the bounds of the differences', () => {
    const a = image(200, 100);
    const b = image(200, 100, (x, y) => square(150, 20, 6, [0, 0, 0])(x, y) ?? square(10, 80, 2, [0, 0, 0])(x, y));
    const r = comparePng(a, b, { writeDiff: 'never' });
    expect(r.diffPixels).toBe(36 + 4);
    expect(r.hotspot).toMatchObject({ diffPixels: 36, width: 32, height: 32 });
    expect(r.hotspot.x).toBeLessThanOrEqual(150);
    expect(r.hotspot.x + 32).toBeGreaterThanOrEqual(156);
    expect(r.bounds).toEqual({ x: 10, y: 20, width: 146, height: 62 });
    expect(describeDiff(r)).toContain('in x 10–155, y 20–81');
    expect(describeDiff(r)).toContain('densest 32×32 window');
  });

  it('fails the window budget for a small local change the page ratio accepts', () => {
    const a = image(100, 100);
    const b = image(100, 100, square(50, 50, 5, [0, 0, 0]));
    const loose = { maxRatio: 0.01, maxWindowPixels: 30 };
    const strict = { maxRatio: 0.01, maxWindowPixels: 10 };
    expect(comparePng(a, b, { ...loose, writeDiff: 'never' }).passed).toBe(true);
    const r = comparePng(a, b, { ...strict, name: 'window-budget', outDir });
    expect(r.ratio).toBeLessThan(strict.maxRatio);
    expect(r.hotspot.diffPixels).toBe(25);
    expect(r.passed).toBe(false);
    expect(r.diffPath && existsSync(r.diffPath)).toBe(true);
    expect(comparePng(a, b, { maxWindowPixels: 25, writeDiff: 'never' }).passed).toBe(true);
  });
});

describe('maskStatistics / withinBudget', () => {
  const mask = (w: number, h: number, on: (x: number, y: number) => boolean) => {
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = on(x, y) ? 1 : 0;
    return m;
  };

  it('keeps a cluster that straddles a tile border in one window (half-window overlap)', () => {
    // 10×10 block across the 32-px grid lines: non-overlapping tiles would split it into four parts.
    const { hotspot, bounds } = maskStatistics(mask(128, 128, (x, y) => x >= 27 && x < 37 && y >= 27 && y < 37), 128, 128, 32);
    expect(hotspot.diffPixels).toBe(100);
    expect(bounds).toEqual({ x: 27, y: 27, width: 10, height: 10 });
  });

  it('covers the right and bottom edges and images smaller than a window', () => {
    const corner = maskStatistics(mask(100, 90, (x, y) => x >= 95 && y >= 85), 100, 90, 32);
    expect(corner.hotspot).toMatchObject({ diffPixels: 25, x: 68, y: 58 });
    const small = maskStatistics(mask(20, 10, () => true), 20, 10, 32);
    expect(small.hotspot).toEqual({ x: 0, y: 0, width: 20, height: 10, diffPixels: 200 });
    expect(maskStatistics(new Uint8Array(64), 8, 8).bounds).toBeNull();
    expect(() => maskStatistics(new Uint8Array(4), 2, 2, 1)).toThrow(RangeError);
  });

  it('applies both limits and rejects size mismatches', () => {
    const r = { ratio: 0.001, hotspot: { x: 0, y: 0, width: 32, height: 32, diffPixels: 5 }, sizeMismatch: false };
    expect(withinBudget(r, {})).toBe(true);
    expect(withinBudget(r, { maxRatio: 0.001, maxWindowPixels: 5 })).toBe(true);
    expect(withinBudget(r, { maxRatio: 0.0009 })).toBe(false);
    expect(withinBudget(r, { maxWindowPixels: 4 })).toBe(false);
    expect(withinBudget({ ...r, sizeMismatch: true }, {})).toBe(false);
  });
});

describe('inkRatio', () => {
  it('measures dark pixels', () => {
    expect(inkRatio(image(10, 10))).toBe(0);
    expect(inkRatio(image(10, 10, square(0, 0, 5, [0, 0, 0])))).toBeCloseTo(0.25, 6);
  });
});
