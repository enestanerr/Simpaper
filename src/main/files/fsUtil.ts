/** Small file-system helpers shared by the document, recovery and settings services. */
import { randomBytes } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { basename, dirname, extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function toFileUrl(path: string): string {
  return pathToFileURL(resolve(path)).href;
}

/** Path equality with Windows semantics (case-insensitive, separator-insensitive). */
export function samePath(a: string, b: string): boolean {
  const na = normalize(resolve(a));
  const nb = normalize(resolve(b));
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

export async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  return (await statOrNull(path)) !== null;
}

/** Removes a file or directory tree; never throws. */
export async function removeQuietly(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await rm(path, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // best effort (file locked by an indexer/antivirus, already gone ...)
  }
}

export function randomToken(bytes = 6): string {
  return randomBytes(bytes).toString('hex');
}

export function splitFileName(fileName: string): { stem: string; ext: string } {
  const ext = extname(fileName);
  return { stem: ext ? fileName.slice(0, -ext.length) : fileName, ext };
}

/** `C:\a\Rapor.docx` + ` (kopya)` → `C:\a\Rapor (kopya).docx`. */
export function withNameSuffix(path: string, suffix: string): string {
  const { stem, ext } = splitFileName(basename(path));
  return join(dirname(path), `${stem}${suffix}${ext}`);
}

/** Replaces (or adds) the extension; `ext` without dot. */
export function withExtension(path: string, ext: string): string {
  const { stem } = splitFileName(basename(path));
  return join(dirname(path), `${stem}.${ext}`);
}

/** Adds `.pdf` unless the path already ends with it (dialog results, explicit export targets). */
export function ensurePdfExtension(path: string): string {
  return extname(path).toLowerCase() === '.pdf' ? path : `${path}.pdf`;
}

/** Characters Windows does not allow in file names (control characters are replaced separately). */
const INVALID_NAME_CHARS = /[<>:"/\\|?*]/g;

/** Makes a string usable as a file name component (used for working copies and default names). */
export function sanitizeFileName(name: string, maxLength = 120): string {
  const printable = [...name].map((c) => ((c.codePointAt(0) ?? 0) < 32 ? '_' : c)).join('');
  let clean = printable.replace(INVALID_NAME_CHARS, '_').replace(/[. ]+$/, '').trim();
  if (!clean) clean = 'document';
  if (clean.length > maxLength) {
    const { stem, ext } = splitFileName(clean);
    clean = `${stem.slice(0, Math.max(1, maxLength - ext.length))}${ext}`;
  }
  return clean;
}

/** Error code of a Node.js system error (`ENOENT`, `EBUSY` ...), if any. */
export function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
