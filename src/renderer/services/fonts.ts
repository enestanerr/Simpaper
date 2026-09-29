/**
 * Font list for the font name box. Sources, in order:
 *  1. Local Font Access API (window.queryLocalFonts) when the permission is granted;
 *  2. otherwise a curated list of common Windows fonts, filtered by a canvas width probe, plus the
 *     fonts bundled with the engine (always available to LibreOffice);
 *  3. fonts reported by the engine state of `.uno:CharFontName` (e.g. fonts used by the document).
 */
import { useEffect, useMemo, useState } from 'react';
import type { UiLanguage } from '@shared/api/app';
import { currentLanguage } from '../i18n';
import { sortLocale } from '../i18n/turkish';
import { useCommands } from '../state/commandStore';
import { fontNameFromState } from './unoValues';

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72] as const;

export const COMMON_WINDOWS_FONTS = [
  'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Calibri Light', 'Cambria', 'Cambria Math', 'Candara', 'Comic Sans MS',
  'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia',
  'Impact', 'Ink Free', 'Javanese Text', 'Leelawadee UI', 'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic',
  'Microsoft Sans Serif', 'MV Boli', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Emoji',
  'Segoe UI Symbol', 'Segoe UI Variable', 'Sitka Text', 'Sylfaen', 'Symbol', 'Tahoma', 'Times New Roman', 'Trebuchet MS',
  'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic',
] as const;

/** Fonts shipped with LibreOffice 26.8 (vendor/libreoffice/Fonts) that cover Latin/Turkish text. */
export const ENGINE_FONTS = [
  'Caladea', 'Carlito', 'DejaVu Sans', 'DejaVu Sans Condensed', 'DejaVu Sans Mono', 'DejaVu Serif', 'DejaVu Serif Condensed',
  'Liberation Mono', 'Liberation Sans', 'Liberation Sans Narrow', 'Liberation Serif', 'Linux Biolinum G', 'Linux Libertine G',
  'Noto Sans', 'Noto Serif', 'Rubik',
] as const;

interface LocalFontData {
  family: string;
}

type QueryLocalFonts = () => Promise<LocalFontData[]>;

let systemFonts: Promise<string[]> | null = null;

/** Installed font families (cached for the session). */
export function loadSystemFonts(): Promise<string[]> {
  systemFonts ??= (async () => {
    const query = (globalThis as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
    if (typeof query === 'function') {
      try {
        const fonts = await query();
        const families = [...new Set(fonts.map((f) => f.family).filter(Boolean))];
        if (families.length > 0) return families;
      } catch {
        // Permission denied or API disabled: fall back to probing.
      }
    }
    return COMMON_WINDOWS_FONTS.filter((f) => isFontInstalled(f));
  })();
  return systemFonts;
}

let probeContext: CanvasRenderingContext2D | null | undefined;

/** Canvas width probe: a font is installed if text rendered with it differs from both generic fallbacks. */
export function isFontInstalled(family: string): boolean {
  if (probeContext === undefined) {
    try {
      const jsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
      probeContext = typeof document !== 'undefined' && !jsdom ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      probeContext = null;
    }
  }
  const ctx = probeContext;
  if (!ctx) return true;
  const sample = 'mmmmmmmmmmlliiWWğşİı0123';
  for (const generic of ['monospace', 'serif']) {
    ctx.font = `72px ${generic}`;
    const base = ctx.measureText(sample).width;
    ctx.font = `72px "${family}", ${generic}`;
    if (ctx.measureText(sample).width !== base) return true;
  }
  return false;
}

export function mergeFontLists(lang: UiLanguage, ...lists: readonly (readonly string[])[]): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) for (const f of list) if (f && !seen.has(f.toLocaleLowerCase('en-US'))) seen.set(f.toLocaleLowerCase('en-US'), f);
  return sortLocale([...seen.values()], lang);
}

/** Font families for the font box of the given document (empty until requested). */
export function useFontList(enabled: boolean, docId: string | null): string[] {
  const [system, setSystem] = useState<string[]>([]);
  const engineFont = useCommands((s) => (docId ? fontNameFromState(s.states[docId]?.['.uno:CharFontName']?.value) : null));
  const [seenInDoc, setSeenInDoc] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadSystemFonts().then((f) => {
      if (alive) setSystem(f);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (engineFont) setSeenInDoc((prev) => (prev.includes(engineFont) ? prev : [...prev, engineFont]));
  }, [engineFont]);

  const lang = currentLanguage();
  return useMemo(() => (enabled ? mergeFontLists(lang, system, ENGINE_FONTS, seenInDoc) : []), [enabled, lang, system, seenInDoc]);
}

/** Parses "11", "10,5", "10.5", "12 pt" → 1…999.5, rounded to 0.1. */
export function parseFontSize(text: string): number | null {
  const m = /^\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:pt|nk)?\s*$/i.exec(text);
  if (!m?.[1]) return null;
  const n = Math.round(Number(m[1].replace(',', '.')) * 10) / 10;
  return n >= 1 && n <= 999.5 ? n : null;
}

export function formatFontSize(size: number, lang: UiLanguage): string {
  return new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: 1 }).format(size);
}

/** Test helper. */
export function resetFontCache(): void {
  systemFonts = null;
  probeContext = undefined;
}
