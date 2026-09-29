/**
 * Locale-aware text helpers. Turkish has dotted/dotless i (i/İ, ı/I), so `toUpperCase()`,
 * `toLowerCase()`, default sorting and the regex `i` flag are all wrong for Turkish text.
 */
import type { UiLanguage } from '@shared/api/app';

export const LOCALE_TAGS: Record<UiLanguage, string> = { tr: 'tr-TR', en: 'en-US' };

export function localeTag(lang: UiLanguage): string {
  return LOCALE_TAGS[lang];
}

export function upper(text: string, lang: UiLanguage): string {
  return text.toLocaleUpperCase(localeTag(lang));
}

export function lower(text: string, lang: UiLanguage): string {
  return text.toLocaleLowerCase(localeTag(lang));
}

const collators = new Map<string, Intl.Collator>();

export function collator(lang: UiLanguage, sensitivity: Intl.CollatorOptions['sensitivity'] = 'variant'): Intl.Collator {
  const key = `${lang}:${sensitivity}`;
  let c = collators.get(key);
  if (!c) {
    c = new Intl.Collator(lang, { sensitivity, numeric: true });
    collators.set(key, c);
  }
  return c;
}

/** Sorts a copy of `items` with the language's collation (Turkish: ç after c, ı before i ...). */
export function sortLocale<T>(items: readonly T[], lang: UiLanguage, key: (item: T) => string = String): T[] {
  const c = collator(lang);
  return [...items].sort((a, b) => c.compare(key(a), key(b)));
}

/**
 * Folds text for case-insensitive matching. Both the locale-specific and the plain mapping of
 * I/ı/İ/i end up as `i`, so a Turkish user typing "istanbul" finds "İstanbul" and an English
 * user typing "INFO" finds "info".
 */
export function fold(text: string, lang: UiLanguage): string {
  return lower(text, lang)
    .normalize('NFD')
    .replace(/̇/g, '')
    .replace(/ı/g, 'i')
    .normalize('NFC');
}

/** Case-insensitive "contains" that is correct for Turkish. */
export function includesFolded(haystack: string, needle: string, lang: UiLanguage): boolean {
  return fold(haystack, lang).includes(fold(needle, lang));
}

/**
 * Normalises a typed character for KeyTip matching. KeyTips use ASCII letters/digits only;
 * every variant of I (i, ı, İ, I) maps to `I` so the Turkish-Q and Turkish-F layouts behave the same.
 */
export function normalizeKeyTipChar(ch: string): string {
  if (ch.length === 0) return '';
  if (ch === 'i' || ch === 'ı' || ch === 'İ' || ch === 'I') return 'I';
  const up = ch.toLocaleUpperCase('en-US');
  return /^[A-Z0-9]$/.test(up) ? up : '';
}
