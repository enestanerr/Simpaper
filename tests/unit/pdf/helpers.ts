/**
 * Test helpers for the PDF service: PDF fixtures generated with @cantoo/pdf-lib, a fake document
 * registry, a real temp-folder SafeWriter and verification through the pdf.js legacy build.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@cantoo/fontkit';
import { PDFDocument, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { DocumentDescriptor, DocumentEvent, Prompt, PromptAnswer } from '@shared/api/documents';
import type { DocumentRegistry, OpenDocumentRecord, SafeWriter } from '../../../src/main/documents/types';
import type { Logger, LogLevel } from '../../../src/main/log';

/** Repository root. (String-based: under jsdom the global URL class is jsdom's, which fileURLToPath rejects.) */
export const REPO_ROOT = import.meta.url.startsWith('file:') ? resolve(dirname(fileURLToPath(import.meta.url)), '../../..') : process.cwd();
export const ENGINE_FONTS = join(REPO_ROOT, 'vendor/libreoffice/Fonts');
export const PDFJS_FONTS = join(REPO_ROOT, 'node_modules/pdfjs-dist/standard_fonts');
export const TURKISH = 'ğüşıöçİĞÜŞÖÇ';

/** Fonts the integrator would pass (engine layout of the admin image, then the installed layout). */
export function fontCandidates(): string[] {
  return [
    join(ENGINE_FONTS, 'DejaVuSans.ttf'),
    join(ENGINE_FONTS, 'LiberationSans-Regular.ttf'),
    join(REPO_ROOT, 'vendor/libreoffice/share/fonts/truetype/DejaVuSans.ttf'),
  ];
}

/** A Unicode font for fixtures: the engine's DejaVu Sans if present, else pdfjs-dist's Liberation Sans. */
export async function fixtureFontBytes(): Promise<Uint8Array> {
  const path = fontCandidates().find((p) => existsSync(p)) ?? join(PDFJS_FONTS, 'LiberationSans-Regular.ttf');
  return new Uint8Array(await readFile(path));
}

export interface PagedPdfOptions {
  pages: number;
  /** Page sizes (points); default A4 portrait. */
  size?: (index: number) => [number, number];
  rotation?: (index: number) => number;
}

/** A PDF whose page i contains the text `PAGE-<i+1>` (ASCII, Helvetica). */
export async function makePagedPdf(opts: PagedPdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = doc.embedStandardFont(StandardFonts.Helvetica);
  for (let i = 0; i < opts.pages; i++) {
    const page = doc.addPage(opts.size?.(i) ?? [595.28, 841.89]);
    page.drawText(`PAGE-${i + 1}`, { x: 60, y: page.getHeight() - 80, size: 24, font, color: rgb(0, 0, 0) });
    const rot = opts.rotation?.(i);
    if (rot) page.setRotation(degrees(rot));
  }
  return doc.save();
}

/** Two pages; page 1 holds a text field `name` and a checkbox `agree`, page 2 a text field `city`. */
export async function makeFormPdf(prefix = ''): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = doc.embedStandardFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  const p1 = doc.addPage([595.28, 841.89]);
  p1.drawText(`${prefix}FORM-PAGE-1`, { x: 60, y: 780, size: 18, font });
  const name = form.createTextField(`${prefix}name`);
  name.setText('Ada');
  name.addToPage(p1, { x: 60, y: 700, width: 240, height: 24, font });
  const agree = form.createCheckBox(`${prefix}agree`);
  agree.addToPage(p1, { x: 60, y: 650, width: 16, height: 16 });
  const p2 = doc.addPage([595.28, 841.89]);
  p2.drawText(`${prefix}FORM-PAGE-2`, { x: 60, y: 780, size: 18, font });
  const city = form.createTextField(`${prefix}city`);
  city.addToPage(p2, { x: 60, y: 700, width: 240, height: 24, font });
  return doc.save();
}

/** One page with Turkish text drawn in an embedded Unicode font. */
export async function makeTurkishPdf(text = `Türkçe metin: ${TURKISH}`): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await fixtureFontBytes(), { subset: true });
  const page = doc.addPage([595.28, 841.89]);
  page.drawText(text, { x: 60, y: 760, size: 16, font });
  return doc.save();
}

// ------------------------------------------------------------------ pdf.js (legacy build) verification

export interface PageInfo {
  text: string;
  rotation: number;
  width: number;
  height: number;
}

/** Text (items joined) and rotation of every page, read by pdf.js. */
export async function readWithPdfjs(bytes: Uint8Array): Promise<PageInfo[]> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0, standardFontDataUrl: `${PDFJS_FONTS}/` });
  try {
    const pdf = await task.promise;
    const pages: PageInfo[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      const [x1, y1, x2, y2] = page.view as [number, number, number, number];
      pages.push({ text, rotation: page.rotate, width: x2 - x1, height: y2 - y1 });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** Page markers (`PAGE-n`) in document order, e.g. ['PAGE-2', 'PAGE-1']. */
export async function pageMarkers(bytes: Uint8Array): Promise<string[]> {
  const pages = await readWithPdfjs(bytes);
  return pages.map((p) => /[A-Z-]*PAGE-\d+/.exec(p.text)?.[0] ?? '');
}

/** Fraction of dark pixels of a page region (PDF user-space rect) rendered by pdf.js at 2x. */
export async function darkPixelRatio(bytes: Uint8Array, pageIndex: number, rect: [number, number, number, number]): Promise<number> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0, standardFontDataUrl: `${PDFJS_FONTS}/` });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 2 });
    const factory = (pdf as unknown as { canvasFactory: { create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2DLike } } }).canvasFactory;
    const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvas: canvas as never, viewport }).promise;
    const [x1, y1, x2, y2] = rect;
    const [ax, ay] = viewport.convertToViewportPoint(x1, y2) as [number, number];
    const [bx, by] = viewport.convertToViewportPoint(x2, y1) as [number, number];
    const left = Math.max(0, Math.floor(Math.min(ax, bx)));
    const top = Math.max(0, Math.floor(Math.min(ay, by)));
    const w = Math.max(1, Math.floor(Math.abs(bx - ax)));
    const h = Math.max(1, Math.floor(Math.abs(by - ay)));
    const data = context.getImageData(left, top, w, h).data;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i]! + data[i + 1]! + data[i + 2]!) / 3 < 160) dark++;
    }
    return dark / (w * h);
  } finally {
    await task.destroy();
  }
}

interface CanvasRenderingContext2DLike {
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}

// ------------------------------------------------------------------ fakes

export interface LogEntry {
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}

export function memoryLogger(entries: LogEntry[] = []): Logger & { entries: LogEntry[] } {
  const make = (): Logger => ({
    debug: (message, meta) => void entries.push({ level: 'debug', message, meta }),
    info: (message, meta) => void entries.push({ level: 'info', message, meta }),
    warn: (message, meta) => void entries.push({ level: 'warn', message, meta }),
    error: (message, meta) => void entries.push({ level: 'error', message, meta }),
    child: () => make(),
  });
  return Object.assign(make(), { entries });
}

export class FakeRegistry implements DocumentRegistry {
  readonly records = new Map<string, OpenDocumentRecord>();
  readonly events: DocumentEvent[] = [];
  readonly prompts: Omit<Prompt, 'id'>[] = [];
  promptAnswer: PromptAnswer = { kind: 'saveRisk', choice: 'cancel' };

  add(descriptor: Partial<DocumentDescriptor> & { docId: string }, workingCopyPath: string | null): OpenDocumentRecord {
    const rec: OpenDocumentRecord = {
      descriptor: {
        kind: 'pdf',
        title: 'test.pdf',
        path: null,
        format: 'pdf',
        readOnly: false,
        modified: false,
        compat: null,
        state: 'ready',
        ...descriptor,
      },
      workingCopyPath,
    };
    this.records.set(descriptor.docId, rec);
    return rec;
  }

  get(docId: string): OpenDocumentRecord | undefined {
    return this.records.get(docId);
  }

  list(): OpenDocumentRecord[] {
    return [...this.records.values()];
  }

  update(docId: string, patch: Partial<DocumentDescriptor>): DocumentDescriptor {
    const rec = this.records.get(docId);
    if (!rec) throw new Error(`unknown doc ${docId}`);
    rec.descriptor = { ...rec.descriptor, ...patch };
    return rec.descriptor;
  }

  emit(event: DocumentEvent): void {
    this.events.push(event);
  }

  async prompt<P extends Prompt>(prompt: Omit<P, 'id'>): Promise<PromptAnswer> {
    this.prompts.push(prompt as Omit<Prompt, 'id'>);
    return this.promptAnswer;
  }
}

/**
 * Real SafeWriter semantics on a temp folder: temp file next to the target → verify → rename.
 * On failure the temp file is removed and the target is untouched.
 */
export function tempSafeWriter(): SafeWriter & { calls: string[] } {
  const calls: string[] = [];
  const writer: SafeWriter = async (targetPath, write, opts) => {
    calls.push(targetPath);
    await mkdir(dirname(targetPath), { recursive: true });
    const tmp = `${targetPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await write(tmp);
      if (opts?.verify) await opts.verify(tmp);
      await rename(tmp, targetPath);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  };
  return Object.assign(writer, { calls });
}

export class FakeDialogs {
  readonly saveAsCalls: string[] = [];
  saveAsResults: (string | null)[] = [];
  openResults: string[][] = [];

  async saveAs(_win: unknown, defaultPath: string): Promise<string | null> {
    this.saveAsCalls.push(defaultPath);
    return this.saveAsResults.length > 0 ? (this.saveAsResults.shift() ?? null) : null;
  }

  async openPdfs(): Promise<string[]> {
    return this.openResults.shift() ?? [];
  }
}

export async function makeTempDir(prefix = 'varak-pdf-test-'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const base = join(REPO_ROOT, 'test-output', 'pdf');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

export async function readBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path));
}

export { tmpdir };
