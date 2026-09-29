/** Types of constants.mjs. */
export declare const GENERATOR_VERSION: number;
export declare const FIXED_DATE: Date;
export declare const FIXED_DATE_ISO: string;
export declare const AUTHOR: string;
export declare const AUTHOR_INITIALS: string;
export declare const TR: { pangram: string; pangramUpper: string; lower: string; upper: string; casing: string; places: string[] };
export declare const LINK_URL: string;
export declare function excelSerial(year: number, month: number, day: number): number;
export declare function prng(seed: number): () => number;
export declare function withSeededRandom<T>(seed: number, fn: () => Promise<T>): Promise<T>;
