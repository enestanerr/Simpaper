/**
 * Turkish-insensitive search. pdf.js matches with a RegExp `i` (plus `u` when the page has diacritics),
 * which pairs I/i only: "istanbul" misses "İSTANBUL" once the page is searched in unicode mode, and
 * "ılık" never finds "ILIK". Folding every I-variant to `i` on both sides fixes that.
 *
 * The fold is length-preserving (one UTF-16 unit in, one out) so match offsets computed on folded text
 * are valid for the original text: pdf.js maps them back to text-layer positions itself.
 */

/** Dotted/dotless I in both cases (İ U+0130, ı U+0131). */
const I_VARIANTS = /[İIıi]/g;

/** Folds İ, I, ı and i to `i`; every other character is unchanged. */
export function foldTurkishI(text: string): string {
  return text.replace(I_VARIANTS, 'i');
}

/** Same fold for pdf.js queries, which may be a string or a list of terms. */
export function foldQuery<T extends string | string[]>(query: T): T {
  if (typeof query === 'string') return foldTurkishI(query) as T;
  return query.map(foldTurkishI) as T;
}

export interface SimpleMatch {
  index: number;
  length: number;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reference matcher with the same semantics as the find controller override (used by tests and for
 * quick "is there a match" checks): case-insensitive, Turkish I-insensitive, NFD-diacritic tolerant.
 */
export function findMatches(text: string, query: string, opts: { caseSensitive?: boolean } = {}): SimpleMatch[] {
  if (!query) return [];
  const haystack = opts.caseSensitive ? text : foldTurkishI(text);
  const needle = opts.caseSensitive ? query : foldTurkishI(query);
  const re = new RegExp(escapeRegExp(needle), opts.caseSensitive ? 'gu' : 'giu');
  const out: SimpleMatch[] = [];
  for (const m of haystack.matchAll(re)) out.push({ index: m.index, length: m[0].length });
  return out;
}
