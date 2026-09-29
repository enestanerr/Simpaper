/** Zoom steps and parsing of zoom values for pdf.js' `currentScaleValue`. */

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 10;

/** Office-like zoom stops (1 = 100 %). */
export const ZOOM_STEPS: readonly number[] = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4, 8, 10];

export type ZoomMode = 'page-width' | 'page-fit' | 'page-actual' | 'auto';
export const ZOOM_MODES: readonly ZoomMode[] = ['page-width', 'page-fit', 'page-actual', 'auto'];

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Next zoom stop above (+1) or below (-1) the current scale. */
export function nextZoomStep(scale: number, direction: 1 | -1): number {
  const eps = 1e-3;
  if (direction > 0) return ZOOM_STEPS.find((s) => s > scale + eps) ?? MAX_SCALE;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const s = ZOOM_STEPS[i]!;
    if (s < scale - eps) return s;
  }
  return MIN_SCALE;
}

/**
 * Parses a typed or chosen zoom value: a mode (`page-width` …), a percentage ("125", "125 %", "%125")
 * or a scale ("1.25"/"1,25"). Returns the string pdf.js accepts as `currentScaleValue`, or null.
 */
export function parseZoomValue(input: string): string | null {
  const value = input.trim().toLowerCase();
  if ((ZOOM_MODES as readonly string[]).includes(value)) return value;
  const percent = /^%?\s*(\d+(?:[.,]\d+)?)\s*%?$/.exec(value);
  if (!percent?.[1]) return null;
  const n = Number(percent[1].replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  // Values up to 10 without a percent sign are scales ("1.5"), larger ones are percentages ("150").
  const scale = value.includes('%') || n > MAX_SCALE ? n / 100 : n;
  return String(clampScale(scale));
}

export function zoomPercent(scale: number): number {
  return Math.round(scale * 100);
}
