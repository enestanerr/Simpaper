/**
 * Plain-text imports (CSV/TSV into Calc, TXT into Writer): encoding detection, a short preview for the
 * CSV import prompt, separator guessing and the engine FilterOptions. The API defaults (UTF-8, comma)
 * are wrong for Turkish data, so options are always passed explicitly (formats.md, table 3).
 */
import { open } from 'node:fs/promises';
import { CSV_LCID, csvImportOptions, defaultCsvSeparator, isCsvSeparatorChar } from '@shared/formats';

/** One character (isCsvSeparatorChar): the import prompt offers these five and any other with "Other". */
export type CsvSeparator = string;
export const CSV_SEPARATORS: readonly CsvSeparator[] = [';', ',', '\t', '|', ' '];

export type TextEncoding = 'utf8' | 'utf16le' | 'utf16be' | 'legacy';

export interface TextSample {
  text: string;
  encoding: TextEncoding;
}

/** LibreOffice charset ids for the CSV filter: UTF-8, UTF-16, Windows-1254 (tr), Windows-1252. */
const CHARSET = { utf8: 76, utf16: 65535, cp1254: 36, cp1252: 1 } as const;

export function isValidUtf8(buf: Uint8Array): boolean {
  let end = buf.length;
  // The sample may end in the middle of a character: ignore an incomplete trailing sequence.
  for (let i = buf.length - 1, back = 0; i >= 0 && back < 4; i--, back++) {
    const b = buf[i] ?? 0;
    if (b < 0x80) break;
    if (b >= 0xc0) {
      const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
      if (buf.length - i < need) end = i;
      break;
    }
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}

const SCAN_CHUNK = 1024 * 1024;

/**
 * Whether the file from `start` on is valid UTF-8, decided over the whole file (streamed; a legacy-encoded file
 * often has an ASCII head of many thousand rows). A sequence cut off at the very end is tolerated.
 */
export async function isValidUtf8File(path: string, start = 0, chunkBytes = SCAN_CHUNK): Promise<boolean> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(chunkBytes);
    let pos = start;
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, chunkBytes, pos);
      if (bytesRead === 0) return true;
      decoder.decode(buf.subarray(0, bytesRead), { stream: true });
      pos += bytesRead;
    }
  } catch {
    return false;
  } finally {
    await fh.close();
  }
}

/**
 * Reads and decodes the start of a text file for the preview (`maxBytes`); the encoding is decided over the
 * whole file. Legacy (non-UTF) text is decoded as Windows-1254/1252.
 */
export async function readTextSample(path: string, locale: string, maxBytes = 64 * 1024): Promise<TextSample> {
  const fh = await open(path, 'r');
  let buf: Buffer;
  let size: number;
  try {
    size = (await fh.stat()).size;
    buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    buf = buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf16le' };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf16be' };
  const bomLength = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  const body = buf.subarray(bomLength);
  const utf8 = isValidUtf8(body) && (size <= buf.length || (await isValidUtf8File(path, bomLength)));
  if (utf8) return { text: new TextDecoder('utf-8').decode(body), encoding: 'utf8' };
  const legacy = locale.startsWith('tr') ? 'windows-1254' : 'windows-1252';
  return { text: new TextDecoder(legacy).decode(body), encoding: 'legacy' };
}

export function previewLines(text: string, maxLines = 8, maxChars = 200): string[] {
  return text
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '')
    .slice(0, maxLines)
    .map((l) => (l.length > maxChars ? `${l.slice(0, maxChars)}…` : l));
}

function countOutsideQuotes(line: string, ch: string): number {
  let n = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === ch) n++;
  }
  return n;
}

/**
 * Guesses the field separator from sample lines. A separator present the same number of times on
 * every line wins, preferring tab, semicolon and pipe over comma (comma is also the Turkish decimal separator).
 */
export function guessSeparator(lines: readonly string[]): CsvSeparator | undefined {
  const sample = lines.filter((l) => l.trim() !== '').slice(0, 8);
  if (!sample.length) return undefined;
  const candidates: CsvSeparator[] = ['\t', ';', '|', ','];
  for (const sep of candidates) {
    const counts = sample.map((l) => countOutsideQuotes(l, sep));
    if (counts.every((c) => c > 0 && c === counts[0])) return sep;
  }
  let best: CsvSeparator | undefined;
  let bestLines = 0;
  for (const sep of candidates) {
    const linesWith = sample.filter((l) => countOutsideQuotes(l, sep) > 0).length;
    if (linesWith > bestLines) {
      best = sep;
      bestLines = linesWith;
    }
  }
  return best;
}

export function csvCharset(encoding: TextEncoding, locale: string): number {
  if (encoding === 'utf8') return CHARSET.utf8;
  if (encoding === 'utf16le' || encoding === 'utf16be') return CHARSET.utf16;
  return locale.startsWith('tr') ? CHARSET.cp1254 : CHARSET.cp1252;
}

export function isCsvSeparator(v: unknown): v is CsvSeparator {
  return isCsvSeparatorChar(v);
}

export function isCsvLocale(v: unknown): v is string {
  return typeof v === 'string' && Object.hasOwn(CSV_LCID, v);
}

/** Default separator shown in the import prompt. */
export function defaultImportSeparator(setting: 'auto' | ';' | ',' | '\t', isTsv: boolean, lines: readonly string[], locale: string): CsvSeparator {
  if (setting !== 'auto') return setting;
  if (isTsv) return '\t';
  return guessSeparator(lines) ?? defaultCsvSeparator(locale);
}

/**
 * `locale` sets number and date recognition (the prompt's choice). `textLocale` picks the code page of legacy
 * (non-UTF) files and must be the locale the preview was decoded with, so the import shows what the preview showed.
 */
export function buildCsvImportOptions(separator: CsvSeparator, locale: string, encoding: TextEncoding, textLocale = locale): string {
  // Formulas are never evaluated on import (CSV formula injection); see formats.md table 3, token 13.
  return csvImportOptions({ separator, locale, charset: csvCharset(encoding, textLocale), evaluateFormulas: false });
}

/** Expands `{bcp47}`/`{lcid}` and the charset of `Text (encoded)` FilterOptions (`charset,lineend,font,lang,...`). */
export function textFilterOptions(template: string, locale: string, encoding: TextEncoding = 'utf8'): string {
  const lcid = String(CSV_LCID[locale] ?? 0);
  const expanded = template.replaceAll('{bcp47}', locale).replaceAll('{lcid}', lcid);
  if (encoding === 'utf8') return expanded;
  const charset = encoding === 'legacy' ? (locale.startsWith('tr') ? 'MS_1254' : 'MS_1252') : 'UNICODE';
  return expanded.replace(/^[^,]*/, charset);
}
