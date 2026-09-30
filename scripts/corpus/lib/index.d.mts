/** Types of index.mjs (corpus orchestrator) and of the generated manifest.json. */

export declare const GENERATOR_VERSION: number;
export declare const MANIFEST_NAME: string;
export declare const MANIFEST_SCHEMA: number;
export declare const REPO_ROOT: string;
export declare const DEFAULT_OUT_DIR: string;

export type CorpusKind = 'writer' | 'calc' | 'impress' | 'pdf';

export interface CorpusFile<F = unknown> {
  id: string;
  /** Path relative to the corpus directory (forward slashes). */
  path: string;
  format: string;
  kind: CorpusKind;
  origin: 'generated' | 'derived';
  derivedFrom?: string;
  /** `--convert-to` target used for derived files. */
  target?: string;
  locale?: string;
  deterministic: boolean;
  features: string[];
  facts?: F;
  bytes: number;
  sha256: string;
}

export interface CorpusManifest {
  schema: number;
  generatorVersion: number;
  generator: string;
  license: string;
  engine: { version: string | null } | null;
  tools: Record<string, string | null>;
  derivedSpecs: string[];
  files: CorpusFile[];
}

export interface DocxFacts {
  pages: number;
  headings: { level: number; text: string }[];
  texts: string[];
  bold: string[];
  italic: string[];
  underline: string[];
  plain: string[];
  table: string[][];
  header: string;
  footerPrefix: string;
  footerFields: string[];
  comments: { author: string; text: string }[];
  insertions: { author: string; text: string }[];
  hyperlinks: { text: string; target: string }[];
  images: { widthPx: number; heightPx: number; alt: string }[];
  bullets: string[];
  page: { width: number; height: number; margin: number };
  language: string;
}

export interface PptxFacts {
  slideCount: number;
  slideSize: { cx: number; cy: number };
  slides: { title: string; texts: string[]; bulletLevels: number[]; notes: string; images: number; table: string[][] | null }[];
}

export type ExpectedValue = number | string | boolean;

export interface XlsxFacts {
  sheets: string[];
  headers: string[];
  rows: { city: string; region: string; population: number; area: number; founded: number; growth: number; ok: string }[];
  dataFormats: Record<'population' | 'area' | 'founded' | 'growth', string>;
  formulas: { label: string; sheet: string; address: string; formula: string; expected: ExpectedValue; numFmt?: string; kind?: 'date'; staleCache?: number }[];
  formats: { sheet: string; address: string; value: number | string; numFmt: string; kind?: 'date' }[];
  merges: Record<string, string[]>;
  frozen: Record<string, { xSplit: number; ySplit: number }>;
  dataValidations: Record<string, { range: string; type: string; formula: string }>;
  conditionalFormats: Record<string, string[]>;
  definedNames: Record<string, string>;
  csv: Record<'tr-TR' | 'en-US', { separator: string; lines: string[] }>;
  tsv: Record<'en-US', { separator: string; lines: string[] }>;
  application: string;
}

export interface PdfTextFacts {
  pages: { title: string; paragraphs: string[]; footer: string }[];
  title: string;
  author: string;
  pageCount: number;
  /** Font file embedded by the generator: relative to the repository root, or absolute on another drive. */
  font: string;
}

export interface PdfFormFacts {
  fields: { name: string; type: 'text' | 'dropdown' | 'checkbox'; value: string | boolean; options?: string[]; multiline?: boolean }[];
  labels: string[];
}

export interface PdfEncryptedFacts {
  password: string;
  algorithm: string;
  text: string[];
}

export interface PdfScannedFacts {
  textLayer: false;
  imagePixels: [number, number];
  ocrText: string[];
}

export interface GenerateOptions {
  outDir?: string;
  large?: boolean;
  derived?: boolean | 'auto';
  programDir?: string | null;
  workDir?: string;
  log?: (msg: string) => void;
  largeSizes?: { rows?: number; pages?: number; slides?: number };
}

export declare function generateCorpus(opts?: GenerateOptions): Promise<CorpusManifest>;
export declare function readManifest(outDir?: string): CorpusManifest | null;
export declare function ensureCorpus(opts?: { outDir?: string; derived?: boolean; log?: (msg: string) => void }): Promise<CorpusManifest>;
export declare function withDirLock<T>(dir: string, fn: () => Promise<T>, opts?: { staleMs?: number; waitMs?: number }): Promise<T>;
