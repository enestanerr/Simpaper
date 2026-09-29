/** Types of xlsx.mjs (the parts used by tests). */
export declare const XLSX_HEADERS: string[];
export declare const XLSX_FORMATS: Record<'population' | 'area' | 'founded' | 'growth', string>;
export declare function formatNumber(value: number, fmt: { decimals: number; thousands?: boolean; percent?: boolean }, locale: string): string;
export declare function expectedDelimited(locale: 'tr-TR' | 'en-US', sep: string): string[];
export declare function buildXlsx(): Promise<{ buffer: Buffer; facts: import('./index.mjs').XlsxFacts }>;
export declare function writeLargeXlsx(path: string, rows?: number): Promise<{ rows: number; totalCell: string; total: number; sheet: string }>;
