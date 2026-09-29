/**
 * pdf.js runtime resources, bundled by Vite and loaded without network access:
 *  - the worker, as a module worker (the `new Worker(new URL(…, import.meta.url))` pattern of
 *    pdfjs-dist/webpack.mjs; one worker per open document, see controller.ts);
 *  - CMaps, standard fonts and WASM decoders through a custom BinaryDataFactory. Each file is a lazily
 *    imported data: URL, so it loads from file:// (packaged app) and from the dev server alike, without
 *    fetch/XHR and without fixed file names (Vite hashes asset names).
 */

type Loader = () => Promise<string>;
type Kind = 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl';

const cmapModules = import.meta.glob('../../../../../node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?url&inline', import: 'default' }) as Record<string, Loader>;
const fontModules = import.meta.glob('../../../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { query: '?url&inline', import: 'default' }) as Record<string, Loader>;
// JBIG2/JPEG 2000 image decoders and colour management; the QuickJS scripting sandbox is not used.
const wasmModules = import.meta.glob('../../../../../node_modules/pdfjs-dist/wasm/{jbig2,openjpeg,qcms_bg}.wasm', { query: '?url&inline', import: 'default' }) as Record<string, Loader>;
const iconModules = import.meta.glob('../../../../../node_modules/pdfjs-dist/web/images/annotation-*.svg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

function byFileName<T>(modules: Record<string, T>): Map<string, T> {
  const map = new Map<string, T>();
  for (const [path, value] of Object.entries(modules)) map.set(path.slice(path.lastIndexOf('/') + 1), value);
  return map;
}

const TABLES: Record<Kind, Map<string, Loader>> = {
  cMapUrl: byFileName(cmapModules),
  standardFontDataUrl: byFileName(fontModules),
  wasmUrl: byFileName(wasmModules),
};

/** URLs of pdf.js' annotation icons (`annotation-note.svg` …) for the annotation layer. */
export const ANNOTATION_ICONS: ReadonlyMap<string, string> = byFileName(iconModules);

export function dataUrlToBytes(url: string): Uint8Array {
  const comma = url.indexOf(',');
  const meta = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  if (!meta.endsWith(';base64')) return new TextEncoder().encode(decodeURIComponent(payload));
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Drop-in for pdf.js' DOMBinaryDataFactory (`getDocument({ BinaryDataFactory })`). */
export class BundledBinaryDataFactory {
  constructor(_urls: { cMapUrl?: string | null; standardFontDataUrl?: string | null; wasmUrl?: string | null }) {}

  async fetch({ kind, filename }: { kind: Kind; filename: string }): Promise<Uint8Array> {
    const loader = TABLES[kind]?.get(filename);
    if (!loader) throw new Error(`pdf.js resource not bundled: ${kind}/${filename}`);
    return dataUrlToBytes(await loader());
  }
}

/** A new pdf.js worker thread (module worker bundled by Vite). The caller terminates it. */
export function createWorkerPort(): Worker {
  return new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
}
