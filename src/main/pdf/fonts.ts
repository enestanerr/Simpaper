/**
 * Chooses a Unicode TrueType font for new text (Turkish ğüşıöçİĞÜŞÖÇ and beyond).
 * Candidates come from the integrator (fonts bundled with the engine); the Liberation Sans shipped in
 * pdfjs-dist (a runtime dependency) is the last resort, so a font is always available.
 */
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import fontkit from '@cantoo/fontkit';
import type { Logger } from '../log';
import { PdfServiceError } from './errors';

export interface ResolvedFont {
  path: string;
  bytes: Uint8Array;
  /** Code points of the requested text the font has no glyph for (empty when fully covered). */
  missing: number[];
}

export interface FontProvider {
  /** Picks the first candidate covering every character of `text` (or the best one if none covers all). */
  resolve(text: string): Promise<ResolvedFont>;
}

interface LoadedFont {
  path: string;
  bytes: Uint8Array;
  hasGlyph(codePoint: number): boolean;
}

/** Path of the fallback font inside pdfjs-dist, or null if the package layout changed. */
export function bundledFallbackFont(): string | null {
  try {
    return createRequire(import.meta.url).resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf');
  } catch {
    return null;
  }
}

/** Characters that need a glyph (controls and whitespace do not). */
export function codePointsNeedingGlyphs(text: string): number[] {
  const set = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined || /\s/u.test(ch) || cp < 0x20) continue;
    set.add(cp);
  }
  return [...set];
}

export function createFontProvider(candidates: () => string[], log: Logger): FontProvider {
  const cache = new Map<string, LoadedFont | null>();

  async function load(path: string): Promise<LoadedFont | null> {
    if (cache.has(path)) return cache.get(path) ?? null;
    let loaded: LoadedFont | null = null;
    try {
      const info = await stat(path);
      if (info.isFile()) {
        const buffer = await readFile(path);
        const font = fontkit.create(buffer);
        // Collections (.ttc) are not used as candidates; a single face is required here.
        if ('hasGlyphForCodePoint' in font) {
          const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
          loaded = { path, bytes, hasGlyph: (cp) => font.hasGlyphForCodePoint(cp) };
        }
      }
    } catch (err) {
      log.debug('font candidate unusable', { path, error: err instanceof Error ? err.message : String(err) });
    }
    cache.set(path, loaded);
    return loaded;
  }

  return {
    async resolve(text: string): Promise<ResolvedFont> {
      const needed = codePointsNeedingGlyphs(text);
      const fallback = bundledFallbackFont();
      const paths = [...candidates(), ...(fallback ? [fallback] : [])];
      let best: { font: LoadedFont; missing: number[] } | null = null;
      for (const path of paths) {
        const font = await load(path);
        if (!font) continue;
        const missing = needed.filter((cp) => !font.hasGlyph(cp));
        if (missing.length === 0) return { path: font.path, bytes: font.bytes, missing };
        if (!best || missing.length < best.missing.length) best = { font, missing };
      }
      if (!best) throw new PdfServiceError('pdf.errors.noFont');
      log.warn('no font covers all characters of the inserted text', { path: best.font.path, missingCount: best.missing.length });
      return { path: best.font.path, bytes: best.font.bytes, missing: best.missing };
    },
  };
}
