/**
 * Pixel comparison of PNG renders (pixelmatch + pngjs). Images of different sizes are compared on a
 * white canvas of the larger size (the size difference itself is reported). Diff images go to
 * test-output/visual/ — by default only for comparisons that fail their budget.
 *
 * Besides the page-level count, every comparison reports its densest *window* (the square of
 * `window` × `window` pixels, scanned with half-window overlap, that contains the most differing
 * pixels) and the bounding box of all differences. A page-level ratio alone cannot see a changed word
 * on a page full of text (one word is ~0.1 % of an A4 page); the windowed count can, while diffuse
 * sub-pixel noise spread over the page stays below it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { VISUAL_OUTPUT } from './paths';

/** Default window edge in pixels for the windowed count. */
export const DEFAULT_WINDOW = 32;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Accepted differences of a comparison: both limits apply when set. */
export interface DiffBudget {
  /** Accepted share of differing pixels on the whole canvas (0..1). */
  maxRatio?: number;
  /** Accepted number of differing pixels inside any single window. */
  maxWindowPixels?: number;
}

export interface CompareOptions extends DiffBudget {
  /** pixelmatch per-pixel colour distance threshold (0..1). Default 0.1. */
  threshold?: number;
  /** Count anti-aliased pixels as differences. Default false (anti-aliasing noise ignored). */
  includeAA?: boolean;
  /** Window edge in pixels for the windowed count. Default {@link DEFAULT_WINDOW}. */
  window?: number;
  /** Base name for written files (`<name>.diff.png`, `.expected.png`, `.actual.png`). */
  name?: string;
  outDir?: string;
  /** When to write images: 'failures' (default when a budget is set), 'always' or 'never'. */
  writeDiff?: 'always' | 'failures' | 'never';
}

export interface CompareResult {
  width: number;
  height: number;
  diffPixels: number;
  /** diffPixels / (width × height) of the compared canvas. */
  ratio: number;
  /** The window with the most differing pixels (the first one found when several tie). */
  hotspot: Rect & { diffPixels: number };
  /** Bounding box of all differing pixels; null when there are none. */
  bounds: Rect | null;
  sizeMismatch: boolean;
  sizes: { expected: [number, number]; actual: [number, number] };
  /** Set when a budget (maxRatio and/or maxWindowPixels) was given. */
  passed?: boolean;
  /** Path of the diff image when one was written. */
  diffPath?: string;
}

export function readPng(source: string | Buffer): PNG {
  return PNG.sync.read(typeof source === 'string' ? readFileSync(source) : source);
}

/** Copies `img` onto a white canvas of `width × height`. */
function onCanvas(img: PNG, width: number, height: number): Buffer {
  if (img.width === width && img.height === height) return img.data;
  const out = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < img.height; y++) img.data.copy(out, y * width * 4, y * img.width * 4, (y + 1) * img.width * 4);
  return out;
}

/** Start offsets of windows of `size` along an axis of `length`, `step` apart, the last one flush with the end. */
function windowStarts(length: number, size: number, step: number): number[] {
  if (length <= size) return [0];
  const starts: number[] = [];
  for (let s = 0; s + size <= length; s += step) starts.push(s);
  if (starts.at(-1)! + size < length) starts.push(length - size);
  return starts;
}

/**
 * Windowed statistics of a diff mask (1 = differing pixel): densest window (half-window overlap, so any
 * cluster up to half a window wide lies entirely inside one window) and bounding box of all differences.
 */
export function maskStatistics(mask: Uint8Array, width: number, height: number, window = DEFAULT_WINDOW): { hotspot: CompareResult['hotspot']; bounds: Rect | null } {
  if (!Number.isInteger(window) || window < 2) throw new RangeError(`window must be an integer ≥ 2 (got ${window})`);
  // Summed-area table with a zero first row and column.
  const stride = width + 1;
  const sat = new Uint32Array(stride * (height + 1));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      const on = mask[y * width + x] ? 1 : 0;
      if (on) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      rowSum += on;
      sat[(y + 1) * stride + x + 1] = sat[y * stride + x + 1]! + rowSum;
    }
  }
  const w = Math.min(window, width);
  const h = Math.min(window, height);
  const step = Math.max(1, Math.floor(window / 2));
  let hotspot: CompareResult['hotspot'] = { x: 0, y: 0, width: w, height: h, diffPixels: 0 };
  for (const y of windowStarts(height, h, step)) {
    for (const x of windowStarts(width, w, step)) {
      const count = sat[(y + h) * stride + x + w]! - sat[y * stride + x + w]! - sat[(y + h) * stride + x]! + sat[y * stride + x]!;
      if (count > hotspot.diffPixels) hotspot = { x, y, width: w, height: h, diffPixels: count };
    }
  }
  const bounds = maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return { hotspot, bounds };
}

/** True when `result` stays within `budget` (and both images have the same size). */
export function withinBudget(result: Pick<CompareResult, 'ratio' | 'hotspot' | 'sizeMismatch'>, budget: DiffBudget): boolean {
  if (result.sizeMismatch) return false;
  if (budget.maxRatio !== undefined && result.ratio > budget.maxRatio) return false;
  if (budget.maxWindowPixels !== undefined && result.hotspot.diffPixels > budget.maxWindowPixels) return false;
  return true;
}

/** Human-readable summary of a comparison for assertion messages. */
export function describeDiff(r: CompareResult): string {
  const where = r.bounds ? `in x ${r.bounds.x}–${r.bounds.x + r.bounds.width - 1}, y ${r.bounds.y}–${r.bounds.y + r.bounds.height - 1}` : 'none';
  return (
    `${r.diffPixels} px (${(r.ratio * 100).toFixed(4)} % of ${r.width}×${r.height}) differ ${where}; ` +
    `densest ${r.hotspot.width}×${r.hotspot.height} window at (${r.hotspot.x}, ${r.hotspot.y}): ${r.hotspot.diffPixels} px` +
    (r.sizeMismatch ? `; size mismatch ${JSON.stringify(r.sizes)}` : '') +
    (r.diffPath ? `; diff image ${r.diffPath}` : '')
  );
}

export function comparePng(expected: string | Buffer, actual: string | Buffer, opts: CompareOptions = {}): CompareResult {
  const a = readPng(expected);
  const b = readPng(actual);
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const imgA = onCanvas(a, width, height);
  const imgB = onCanvas(b, width, height);
  const match = { threshold: opts.threshold ?? 0.1, includeAA: opts.includeAA ?? false };

  // Mask pass: only counted differences are drawn (anti-aliased pixels excluded unless includeAA).
  const maskRgba = new Uint8Array(width * height * 4);
  const diffPixels = pixelmatch(imgA, imgB, maskRgba, width, height, { ...match, diffMask: true });
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = maskRgba[i * 4 + 3]! > 0 ? 1 : 0;
  const { hotspot, bounds } = maskStatistics(mask, width, height, opts.window ?? DEFAULT_WINDOW);

  const result: CompareResult = {
    width,
    height,
    diffPixels,
    ratio: diffPixels / (width * height),
    hotspot,
    bounds,
    sizeMismatch: a.width !== b.width || a.height !== b.height,
    sizes: { expected: [a.width, a.height], actual: [b.width, b.height] },
  };
  const hasBudget = opts.maxRatio !== undefined || opts.maxWindowPixels !== undefined;
  if (hasBudget) result.passed = withinBudget(result, opts);

  const mode = opts.writeDiff ?? (hasBudget ? 'failures' : 'always');
  const write = mode === 'always' || (mode === 'failures' && result.passed === false);
  if (write && opts.name) {
    const dir = opts.outDir ?? VISUAL_OUTPUT;
    mkdirSync(dir, { recursive: true });
    // Picture pass: differences in red, anti-aliasing in yellow, over a faded copy of the expected image.
    const diff = new PNG({ width, height });
    pixelmatch(imgA, imgB, diff.data, width, height, { ...match, alpha: 0.2 });
    result.diffPath = join(dir, `${opts.name}.diff.png`);
    writeFileSync(result.diffPath, PNG.sync.write(diff));
    writeFileSync(join(dir, `${opts.name}.expected.png`), PNG.sync.write(a));
    writeFileSync(join(dir, `${opts.name}.actual.png`), PNG.sync.write(b));
  }
  return result;
}

/** Share of pixels darker than `level` (0..255) — used to assert that a render is not blank. */
export function inkRatio(source: string | Buffer, level = 200): number {
  const img = readPng(source);
  let ink = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const alpha = img.data[i + 3]! / 255;
    const lum = (0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!) * alpha + 255 * (1 - alpha);
    if (lum < level) ink++;
  }
  return ink / (img.width * img.height);
}
