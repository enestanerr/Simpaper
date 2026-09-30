/**
 * Shared, deterministic content of the generated corpus. Everything the generators write and the tests
 * expect is derived from these values (the manifest records the concrete expectations per file).
 */

/** Bump when generated content changes, so cached corpora are regenerated. */
export const GENERATOR_VERSION = 2;

/** Fixed timestamp for zip entries and document properties (deterministic output). */
export const FIXED_DATE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
export const FIXED_DATE_ISO = '2026-01-01T00:00:00Z';

export const AUTHOR = 'Simpaper Test';
export const AUTHOR_INITIALS = 'ST';

export const TR = {
  pangram: 'Pijamalı hasta yağız şoföre çabucak güvendi.',
  pangramUpper: 'PİJAMALI HASTA YAĞIZ ŞOFÖRE ÇABUCAK GÜVENDİ.',
  lower: 'çğıöşü',
  upper: 'ÇĞİÖŞÜ',
  /** Dotless/dotted i pairs: the classic Turkish casing trap. */
  casing: 'ıIiİ',
  places: ['İstanbul', 'Iğdır', 'Şırnak', 'Çanakkale', 'Muğla', 'Ağrı', 'Düzce', 'Eskişehir'],
};

/** Hyperlink target used in documents (IANA example domain: never resolves to real content). */
export const LINK_URL = 'https://example.com/simpaper/belge?q=%C3%A7%C4%9F%C4%B1';

/** Excel 1900-system serial number of a calendar date (valid from 1900-03-01). */
export function excelSerial(year, month, day) {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/**
 * Small deterministic PRNG (mulberry32) for noise and synthetic data; never Math.random.
 * @param {number} seed
 */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Runs `fn` with Math.random replaced by a seeded PRNG. Some libraries (pdf-lib font subset names)
 * use Math.random; this keeps their output byte-reproducible. Not re-entrant; the generator is sequential.
 * @template T
 * @param {number} seed
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withSeededRandom(seed, fn) {
  const original = Math.random;
  Math.random = prng(seed);
  try {
    return await fn();
  } finally {
    Math.random = original;
  }
}
