/**
 * Find controller with Turkish-insensitive matching. pdf.js' public `match()` hook receives the
 * normalised query and page text; both are folded (İ/I/ı/i → i) before pdf.js builds its RegExp, and
 * the fold keeps offsets, so highlighting positions stay correct. Case-sensitive searches are untouched.
 */
import { foldQuery, foldTurkishI } from '../logic/search';

export interface MatchResult {
  index: number;
  length: number;
}

/** The part of PDFFindController this subclass relies on. */
export interface FindControllerBase {
  readonly state: unknown;
  match(query: string | string[], pageContent: string, pageIndex: number): MatchResult[] | undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeScript mixins require an any[] constructor
type Constructor<T> = new (...args: any[]) => T;

/** Builds the subclass for a given PDFFindController class (modern build in the app, legacy in tests). */
export function withTurkishMatching<C extends Constructor<FindControllerBase>>(Base: C) {
  return class TurkishFindController extends Base {
    override match(query: string | string[], pageContent: string, pageIndex: number): MatchResult[] | undefined {
      const state = this.state as { caseSensitive?: boolean } | null;
      if (state?.caseSensitive) return super.match(query, pageContent, pageIndex);
      return super.match(foldQuery(query), foldTurkishI(pageContent), pageIndex);
    }
  };
}
