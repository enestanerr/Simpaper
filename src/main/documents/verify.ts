/**
 * Verification of a freshly written file before it replaces the user's file (SafeWriter `verify`):
 * package integrity (zip central directory + CRC, compound-file directory, PDF header/trailer) and,
 * optionally, a re-open through the engine's headless conversion instance.
 */
import { open, readFile, stat } from 'node:fs/promises';
import JSZip from 'jszip';
import type { FormatInfo } from '@shared/formats';
import { isCfb, readCfbFileSummary } from '../files/cfb';

export class VerifyError extends Error {
  override readonly name = 'VerifyError';
}

const CRC_LIMIT = 64 * 1024 * 1024;

const REQUIRED_STREAM: Partial<Record<string, string[]>> = {
  doc: ['WordDocument'],
  xls: ['Workbook', 'Book'],
  ppt: ['PowerPoint Document'],
  pps: ['PowerPoint Document'],
};

async function readHeadTail(path: string, size: number): Promise<{ head: Buffer; tail: Buffer }> {
  const fh = await open(path, 'r');
  try {
    const head = Buffer.alloc(Math.min(1024, size));
    await fh.read(head, 0, head.length, 0);
    const tailLen = Math.min(2048, size);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    return { head, tail };
  } finally {
    await fh.close();
  }
}

export async function verifyPdfFile(path: string): Promise<void> {
  const { size } = await stat(path);
  if (size < 64) throw new VerifyError('PDF too small');
  const { head, tail } = await readHeadTail(path, size);
  if (!head.includes('%PDF-')) throw new VerifyError('PDF header missing');
  if (!tail.includes('%%EOF')) throw new VerifyError('PDF trailer missing');
}

export interface VerifyOptions {
  format: FormatInfo;
  /**
   * Written with a password: OOXML then becomes a compound file (EncryptedPackage); ODF stays a zip, since
   * LibreOffice 26.8 with a single `encrypted-package` entry instead of content.xml ("wholesome" encryption).
   */
  encrypted: boolean;
  /** Optional deep check: re-open the file through the engine. */
  reopen?: (path: string) => Promise<void>;
}

export async function verifySavedFile(path: string, opts: VerifyOptions): Promise<void> {
  const { format } = opts;
  const { size } = await stat(path);
  if (format.family === 'text') {
    if (opts.reopen) await opts.reopen(path);
    return;
  }
  if (size === 0) throw new VerifyError('empty file');
  if (format.family === 'pdf') return verifyPdfFile(path);

  const head = Buffer.alloc(8);
  const fh = await open(path, 'r');
  try {
    await fh.read(head, 0, 8, 0);
  } finally {
    await fh.close();
  }

  if (format.family === 'binary' || (format.family === 'ooxml' && opts.encrypted)) {
    if (!isCfb(head)) throw new VerifyError('not a compound file');
    const summary = await readCfbFileSummary(path);
    const names = new Set(summary.entries.map((e) => e.name));
    const required = format.family === 'ooxml' ? ['EncryptedPackage'] : (REQUIRED_STREAM[format.id] ?? []);
    if (required.length && !required.some((n) => names.has(n))) throw new VerifyError('main stream missing');
  } else {
    if (head[0] !== 0x50 || head[1] !== 0x4b) throw new VerifyError('not a zip package');
    const zip = await JSZip.loadAsync(await readFile(path), { checkCRC32: size <= CRC_LIMIT });
    if (format.family === 'ooxml' && !zip.file('[Content_Types].xml')) throw new VerifyError('[Content_Types].xml missing');
    if (format.family === 'odf' && (!zip.file('mimetype') || !(zip.file('content.xml') || (opts.encrypted && zip.file('encrypted-package'))))) {
      throw new VerifyError('ODF parts missing');
    }
  }
  if (opts.reopen) await opts.reopen(path);
}
