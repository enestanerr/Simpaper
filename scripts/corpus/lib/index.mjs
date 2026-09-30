/**
 * Corpus orchestrator: writes the generated fixtures and `manifest.json` (the contract between the
 * generators and the tests). Files are written atomically and the manifest last, so a reader that sees
 * a manifest also sees every file it lists.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATOR_VERSION } from './constants.mjs';
import { DERIVED_SPECS, deriveFormats } from './derive.mjs';
import { buildDocx } from './docx.mjs';
import { findUnicodeFont } from './fonts.mjs';
import { buildEncryptedPdf, buildFormPdf, buildScannedPdf, buildTextPdf } from './pdf.mjs';
import { buildPptx } from './pptx.mjs';
import { engineVersion, findProgramDir } from './soffice.mjs';
import { buildXlsx, writeLargeXlsx } from './xlsx.mjs';

export { GENERATOR_VERSION } from './constants.mjs';
export const MANIFEST_NAME = 'manifest.json';
export const MANIFEST_SCHEMA = 1;

/** Repository root (two levels above scripts/corpus/lib). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DEFAULT_OUT_DIR = join(REPO_ROOT, 'tests', 'corpus', 'generated');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

const posix = (p) => p.split(sep).join('/');

/**
 * @param {{
 *   outDir?: string, large?: boolean, derived?: boolean | 'auto', programDir?: string | null,
 *   workDir?: string, log?: (msg: string) => void, largeSizes?: { rows?: number, pages?: number, slides?: number }
 * }} [opts]
 */
export async function generateCorpus(opts = {}) {
  const outDir = resolve(opts.outDir ?? DEFAULT_OUT_DIR);
  const log = opts.log ?? (() => {});
  const programDir = opts.programDir === null ? null : findProgramDir({ explicit: opts.programDir ?? undefined, repoRoot: REPO_ROOT });
  const workDir = resolve(opts.workDir ?? join(REPO_ROOT, 'test-output', 'corpus'));
  const derivedMode = opts.derived ?? 'auto';
  if (derivedMode === true && !programDir) throw new Error('LibreOffice not found: set SIMPAPER_ENGINE_DIR or run npm run engine:fetch (or use --no-derived)');
  mkdirSync(outDir, { recursive: true });

  const fontPath = findUnicodeFont({ repoRoot: REPO_ROOT, programDir });
  const boldFontPath = findUnicodeFont({ repoRoot: REPO_ROOT, programDir, weight: 'bold' });
  if (!fontPath) throw new Error('No Unicode TrueType font found for the PDF fixtures (see scripts/corpus/lib/fonts.mjs)');

  /** @type {any[]} */
  const files = [];
  const add = (entry, buffer) => {
    const abs = join(outDir, entry.path);
    if (buffer) writeAtomic(abs, buffer);
    const bytes = buffer ?? readFileSync(abs);
    files.push({ ...entry, bytes: bytes.length, sha256: sha256(bytes) });
    log(`  wrote ${entry.path} (${bytes.length} bytes)`);
    return abs;
  };

  log(`Generating corpus in ${outDir}`);
  const docx = await buildDocx();
  add({ id: 'docx-basic', path: 'docx-basic.docx', format: 'docx', kind: 'writer', origin: 'generated', deterministic: true, features: ['styles', 'headings', 'turkish', 'bold-italic', 'table', 'image', 'header-footer', 'page-fields', 'comment', 'tracked-insertion', 'hyperlink', 'bullets', 'a4', 'margins'], facts: docx.facts }, docx.buffer);
  const docxChanged = await buildDocx({ variant: 'changed' });
  add({ id: 'docx-changed', path: 'docx-changed.docx', format: 'docx', kind: 'writer', origin: 'generated', deterministic: true, features: ['visual-sensitivity'], facts: docxChanged.facts }, docxChanged.buffer);

  const pptx = await buildPptx();
  add({ id: 'pptx-basic', path: 'pptx-basic.pptx', format: 'pptx', kind: 'impress', origin: 'generated', deterministic: true, features: ['title-slide', 'bullets', 'turkish', 'image', 'table', 'speaker-notes', 'layouts'], facts: pptx.facts }, pptx.buffer);
  const pptxChanged = await buildPptx({ variant: 'changed' });
  add({ id: 'pptx-changed', path: 'pptx-changed.pptx', format: 'pptx', kind: 'impress', origin: 'generated', deterministic: true, features: ['visual-sensitivity'], facts: pptxChanged.facts }, pptxChanged.buffer);

  const xlsx = await buildXlsx();
  add({ id: 'xlsx-basic', path: 'xlsx-basic.xlsx', format: 'xlsx', kind: 'calc', origin: 'generated', deterministic: true, features: ['sheets', 'number-formats', 'dates', 'percent', 'currency', 'formulas', 'cross-sheet', 'absolute-refs', 'defined-name', 'stale-cache', 'merged-cells', 'borders', 'data-validation', 'conditional-formatting', 'frozen-panes', 'turkish'], facts: xlsx.facts }, xlsx.buffer);

  const pdfText = await buildTextPdf({ fontPath, boldFontPath });
  add({ id: 'pdf-text', path: 'pdf-text.pdf', format: 'pdf', kind: 'pdf', origin: 'generated', deterministic: true, features: ['multi-page', 'turkish', 'embedded-unicode-font', 'metadata'], facts: { ...pdfText.facts, font: posix(relative(REPO_ROOT, fontPath)) } }, pdfText.buffer);
  const pdfForm = await buildFormPdf({ fontPath });
  add({ id: 'pdf-form', path: 'pdf-form.pdf', format: 'pdf', kind: 'pdf', origin: 'generated', deterministic: true, features: ['acroform', 'text-field', 'checkbox', 'dropdown', 'turkish'], facts: pdfForm.facts }, pdfForm.buffer);
  const pdfEnc = await buildEncryptedPdf({ fontPath });
  add({ id: 'pdf-encrypted', path: 'pdf-encrypted.pdf', format: 'pdf', kind: 'pdf', origin: 'generated', deterministic: false, features: ['encrypted', 'aes-256', 'password'], facts: pdfEnc.facts }, pdfEnc.buffer);
  const pdfScan = await buildScannedPdf({ fontPath });
  add({ id: 'pdf-scanned', path: 'pdf-scanned.pdf', format: 'pdf', kind: 'pdf', origin: 'generated', deterministic: true, features: ['image-only', 'no-text-layer', 'jpeg'], facts: pdfScan.facts }, pdfScan.buffer);

  if (opts.large) {
    const sizes = { rows: 100_000, pages: 300, slides: 200, ...opts.largeSizes };
    log(`Generating large fixtures (${sizes.rows} rows, ${sizes.pages} pages, ${sizes.slides} slides)`);
    const bigXlsx = join(outDir, 'large', `xlsx-${sizes.rows}-rows.xlsx`);
    mkdirSync(dirname(bigXlsx), { recursive: true });
    const xlsxFacts = await writeLargeXlsx(`${bigXlsx}.tmp-${process.pid}`, sizes.rows);
    renameSync(`${bigXlsx}.tmp-${process.pid}`, bigXlsx);
    add({ id: 'large-xlsx', path: posix(relative(outDir, bigXlsx)), format: 'xlsx', kind: 'calc', origin: 'generated', deterministic: true, features: ['large', 'streaming-writer'], facts: xlsxFacts });
    const bigDocx = await buildDocx({ pages: sizes.pages - 2 });
    add({ id: 'large-docx', path: `large/docx-${sizes.pages}-pages.docx`, format: 'docx', kind: 'writer', origin: 'generated', deterministic: true, features: ['large', 'page-breaks'], facts: { pages: bigDocx.facts.pages } }, bigDocx.buffer);
    const bigPptx = await buildPptx({ slides: sizes.slides });
    add({ id: 'large-pptx', path: `large/pptx-${sizes.slides}-slides.pptx`, format: 'pptx', kind: 'impress', origin: 'generated', deterministic: true, features: ['large', 'shared-image'], facts: { slideCount: bigPptx.facts.slideCount } }, bigPptx.buffer);
  }

  let engine = null;
  const wantDerived = derivedMode === true || (derivedMode === 'auto' && programDir);
  if (wantDerived && programDir) {
    engine = { version: engineVersion(programDir) };
    log(`Deriving formats with LibreOffice ${engine.version ?? '(unknown version)'} (headless)`);
    const sources = Object.fromEntries(files.filter((f) => f.origin === 'generated').map((f) => [f.id, join(outDir, f.path)]));
    const derived = await deriveFormats({ programDir, outDir, workDir, sources, log });
    for (const { spec } of derived) {
      add({ id: spec.id, path: spec.file, format: spec.format, kind: files.find((f) => f.id === spec.from).kind, origin: 'derived', derivedFrom: spec.from, target: spec.target, locale: spec.locale, deterministic: false, features: spec.features });
    }
  } else if (derivedMode === 'auto') {
    log('LibreOffice not found: derived formats skipped (set SIMPAPER_ENGINE_DIR or run npm run engine:fetch)');
  }

  const manifest = {
    schema: MANIFEST_SCHEMA,
    generatorVersion: GENERATOR_VERSION,
    generator: 'scripts/corpus/generate.mjs',
    license: 'CC0-1.0',
    engine,
    tools: { node: process.version, ...libraryVersions() },
    derivedSpecs: wantDerived ? DERIVED_SPECS.map((s) => s.id) : [],
    files,
  };
  writeAtomic(join(outDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`Done: ${files.length} files, manifest ${join(outDir, MANIFEST_NAME)}`);
  return manifest;
}

function libraryVersions() {
  const version = (name) => {
    try {
      return JSON.parse(readFileSync(join(REPO_ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
    } catch {
      return null;
    }
  };
  return { jszip: version('jszip'), exceljs: version('exceljs'), pdfLib: version('@cantoo/pdf-lib'), fontkit: version('@cantoo/fontkit'), napiCanvas: version('@napi-rs/canvas') };
}

/**
 * Reads the manifest of `outDir` if it exists and matches the current generator; null otherwise.
 * @param {string} [outDir]
 */
export function readManifest(outDir = DEFAULT_OUT_DIR) {
  const path = join(outDir, MANIFEST_NAME);
  if (!existsSync(path)) return null;
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (manifest.schema !== MANIFEST_SCHEMA || manifest.generatorVersion !== GENERATOR_VERSION) return null;
    for (const f of manifest.files) if (!existsSync(join(outDir, f.path)) || statSync(join(outDir, f.path)).size !== f.bytes) return null;
    return manifest;
  } catch {
    return null;
  }
}

/**
 * Cross-process lock around corpus generation (parallel test workers share tests/corpus/generated).
 * A lock older than `staleMs` is considered abandoned.
 * @template T
 * @param {string} dir
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withDirLock(dir, fn, { staleMs = 10 * 60_000, waitMs = 15 * 60_000 } = {}) {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, '.lock');
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > staleMs) rmSync(lock, { recursive: true, force: true });
      } catch {
        // lock vanished between the calls
      }
      if (Date.now() - started > waitMs) throw new Error(`timed out waiting for ${lock}`, { cause: error });
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Returns a manifest for `outDir`, generating the corpus first when it is missing or outdated.
 * With `derived: true` a manifest without derived files is regenerated (requires LibreOffice).
 */
export async function ensureCorpus({ outDir = DEFAULT_OUT_DIR, derived = false, log } = {}) {
  const usable = (m) => m && (!derived || m.derivedSpecs.length === DERIVED_SPECS.length);
  const existing = readManifest(outDir);
  if (usable(existing)) return existing;
  return withDirLock(outDir, async () => {
    const again = readManifest(outDir);
    if (usable(again)) return again;
    return generateCorpus({ outDir, derived: derived ? true : false, log });
  });
}
