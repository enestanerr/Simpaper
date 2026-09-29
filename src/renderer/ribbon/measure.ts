/** Text measurement for the adaptive layout (canvas with the UI font, cached; approximation without canvas). */
import { approximateMeasure, type MeasureText } from './layout';

const cache = new Map<string, number>();
let ctx: CanvasRenderingContext2D | null | undefined;

export const measureUiText: MeasureText = (text) => {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  if (ctx === undefined) {
    try {
      // jsdom (unit tests) has no canvas implementation.
      ctx = /jsdom/i.test(navigator.userAgent) ? null : document.createElement('canvas').getContext('2d');
      if (ctx) ctx.font = '12px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
    } catch {
      ctx = null;
    }
  }
  const w = ctx ? Math.ceil(ctx.measureText(text).width) : approximateMeasure(text);
  cache.set(text, w);
  return w;
};
