/**
 * PDF reading and rasterising with pdf.js (legacy build for Node) — an engine independent of LibreOffice.
 * Rendering follows pdf.js' Node example: the document's own canvas factory (backed by @napi-rs/canvas)
 * creates the canvas, then `canvas.toBuffer('image/png')`.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
const PDFJS_DIR = dirname(require.resolve('pdfjs-dist/package.json'));
/** pdf.js wants a trailing '/' (also on Windows); forward slashes work with Node's fs everywhere. */
const dirUrl = (name: string) => `${join(PDFJS_DIR, name).split('\\').join('/')}/`;

export interface PdfOpenOptions {
  password?: string;
}

interface NodeCanvas {
  toBuffer(mime: 'image/png'): Buffer;
}
interface CanvasAndContext {
  canvas: NodeCanvas;
  context: unknown;
}
interface CanvasFactory {
  create(width: number, height: number): CanvasAndContext;
  destroy(canvasAndContext: CanvasAndContext): void;
}

async function load(source: string | Uint8Array, opts: PdfOpenOptions = {}) {
  const bytes = typeof source === 'string' ? new Uint8Array(await readFile(source)) : new Uint8Array(source);
  const task = getDocument({
    data: bytes,
    password: opts.password,
    standardFontDataUrl: dirUrl('standard_fonts'),
    cMapUrl: dirUrl('cmaps'),
    wasmUrl: dirUrl('wasm'),
    iccUrl: dirUrl('iccs'),
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  return { doc, close: () => task.destroy() };
}

/** Runs `fn` with an open document and always releases it. */
export async function withPdf<T>(source: string | Uint8Array, fn: (doc: Awaited<ReturnType<typeof load>>['doc']) => Promise<T>, opts?: PdfOpenOptions): Promise<T> {
  const { doc, close } = await load(source, opts);
  try {
    return await fn(doc);
  } finally {
    await close();
  }
}

/** True for pdf.js' "password required / incorrect" errors. */
export function isPasswordError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'PasswordException';
}

/** Text per page (items concatenated, end-of-line items followed by "\n"). */
export async function pdfText(source: string | Uint8Array, opts?: PdfOpenOptions): Promise<string[]> {
  return withPdf(
    source,
    async (doc) => {
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let text = '';
        for (const item of content.items) {
          if (!('str' in item)) continue;
          text += item.str + (item.hasEOL ? '\n' : '');
        }
        pages.push(text);
        page.cleanup();
      }
      return pages;
    },
    opts,
  );
}

export interface PdfField {
  name: string;
  /** pdf.js field type: `Tx` (text), `Btn` (checkbox/radio/button), `Ch` (choice), `Sig` (signature). */
  type: string;
  /** Widget kind: `text`, `checkbox`, `radio`, `push`, `combo`, `list`, `signature` (else the field type). */
  kind: string;
  value: string | string[] | null;
  checked?: boolean;
  options?: string[];
  page: number;
}

export interface PdfInfo {
  pages: number;
  pageSizes: { width: number; height: number }[];
  info: Record<string, unknown>;
  fields: PdfField[];
}

/** Widget kind from pdf.js annotation data (ButtonWidgetAnnotation / ChoiceWidgetAnnotation flags). */
function widgetKind(a: Record<string, unknown>): string {
  switch (a['fieldType']) {
    case 'Tx':
      return 'text';
    case 'Btn':
      return a['checkBox'] ? 'checkbox' : a['radioButton'] ? 'radio' : a['pushButton'] ? 'push' : 'button';
    case 'Ch':
      return a['combo'] ? 'combo' : 'list';
    case 'Sig':
      return 'signature';
    default:
      return String(a['fieldType']);
  }
}

/** Page count and sizes (points), document information dictionary and AcroForm widgets. */
export async function pdfInfo(source: string | Uint8Array, opts?: PdfOpenOptions): Promise<PdfInfo> {
  return withPdf(
    source,
    async (doc) => {
      const meta = await doc.getMetadata();
      const pageSizes: PdfInfo['pageSizes'] = [];
      const fields: PdfField[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        pageSizes.push({ width: vp.width, height: vp.height });
        for (const a of (await page.getAnnotations()) as Record<string, unknown>[]) {
          if (a['subtype'] !== 'Widget' || typeof a['fieldName'] !== 'string') continue;
          const options = Array.isArray(a['options']) ? (a['options'] as { displayValue?: string; exportValue?: string }[]).map((o) => String(o.displayValue ?? o.exportValue)) : undefined;
          const value = a['fieldValue'];
          fields.push({
            name: a['fieldName'],
            type: String(a['fieldType']),
            kind: widgetKind(a),
            value: Array.isArray(value) ? value.map(String) : value === undefined || value === null ? null : String(value),
            checked: a['checkBox'] ? value !== 'Off' && value !== undefined && value !== null && value !== '' : undefined,
            options,
            page: i,
          });
        }
        page.cleanup();
      }
      return { pages: doc.numPages, pageSizes, info: (meta.info ?? {}) as Record<string, unknown>, fields };
    },
    opts,
  );
}

/**
 * Renders one page (0-based) to PNG. `scale` 1 = 72 dpi; 96 dpi ≈ 1.333.
 * Optionally writes the PNG to `outPath`.
 */
export async function renderPdfPage(source: string | Uint8Array, pageIndex: number, scale = 1, opts: PdfOpenOptions & { outPath?: string } = {}): Promise<Buffer> {
  return withPdf(
    source,
    async (doc) => {
      const png = await renderOpenPage(doc, pageIndex, scale);
      if (opts.outPath) {
        await mkdir(dirname(opts.outPath), { recursive: true });
        await writeFile(opts.outPath, png);
      }
      return png;
    },
    opts,
  );
}

/** Renders every page of a document to PNG buffers. */
export async function renderPdfPages(source: string | Uint8Array, scale = 1, opts?: PdfOpenOptions): Promise<Buffer[]> {
  return withPdf(
    source,
    async (doc) => {
      const out: Buffer[] = [];
      for (let i = 0; i < doc.numPages; i++) out.push(await renderOpenPage(doc, i, scale));
      return out;
    },
    opts,
  );
}

async function renderOpenPage(doc: Awaited<ReturnType<typeof load>>['doc'], pageIndex: number, scale: number): Promise<Buffer> {
  if (pageIndex < 0 || pageIndex >= doc.numPages) throw new RangeError(`page ${pageIndex} out of range (0..${doc.numPages - 1})`);
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const factory = doc.canvasFactory as CanvasFactory;
  const target = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  // The render parameters are typed with DOM classes; the Node canvas is API-compatible.
  const params = { canvas: target.canvas, canvasContext: target.context, viewport } as unknown as Parameters<typeof page.render>[0];
  try {
    await page.render(params).promise;
    return target.canvas.toBuffer('image/png');
  } finally {
    factory.destroy(target);
    page.cleanup();
  }
}
