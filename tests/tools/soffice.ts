/**
 * Typed, format-aware facade over the headless LibreOffice runner (scripts/corpus/lib/soffice.mjs):
 * conversions without the engine bridge, each runner with its own temporary profile, a timeout per
 * invocation and process-tree cleanup. Filter names come from the shared format registry.
 */
import { mkdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { PDF_EXPORT_FILTER, formatFromPath } from '@shared/formats';
import { isOfficeKind } from '@shared/modules';
import {
  SofficeRunner,
  convertTarget,
  engineVersion,
  findProgramDir,
  pdfFilterData,
} from '../../scripts/corpus/lib/soffice.mjs';
import { CORPUS_OUTPUT, REPO_ROOT } from './paths';

export { SofficeConversionError, SofficeTimeoutError, convertTarget, pdfFilterData } from '../../scripts/corpus/lib/soffice.mjs';

/** LibreOffice program directory (VARAK_ENGINE_DIR or vendor/libreoffice/program), or null. */
export const ENGINE_PROGRAM_DIR: string | null = findProgramDir({ repoRoot: REPO_ROOT });
/** True when a LibreOffice engine is available for headless tests. */
export const hasEngine = ENGINE_PROGRAM_DIR !== null;
export const ENGINE_VERSION: string | null = ENGINE_PROGRAM_DIR ? engineVersion(ENGINE_PROGRAM_DIR) : null;

export interface SofficeOptions {
  /** Document/system locale of the profile (the UI is always en-US, see soffice.mjs). */
  locale?: string;
  /** Profile name prefix (shows up in the profile folder name). */
  name?: string;
  /** Parent folder of the temporary profile; default test-output/corpus/soffice. */
  workDir?: string;
  timeoutMs?: number;
}

/** PDF export filter for a document path (writer/calc/impress chosen from its format). */
export function pdfFilterFor(path: string): string {
  const format = formatFromPath(path);
  if (!format || !isOfficeKind(format.kind)) throw new Error(`not an office document: ${path}`);
  return PDF_EXPORT_FILTER[format.kind];
}

/** Export filter that writes a document back in its own format (from the shared registry). */
export function sameFormatFilter(path: string): string {
  const format = formatFromPath(path);
  if (!format?.exportFilter) throw new Error(`no export filter for ${path}`);
  return format.exportFilter;
}

export class Soffice {
  private constructor(private readonly runner: SofficeRunner) {}

  /** Starts nothing yet: the soffice process runs only during a conversion. */
  static create(opts: SofficeOptions = {}): Soffice {
    if (!ENGINE_PROGRAM_DIR) throw new Error('LibreOffice engine not found (set VARAK_ENGINE_DIR or run npm run engine:fetch)');
    const workDir = opts.workDir ?? join(CORPUS_OUTPUT, 'soffice');
    mkdirSync(workDir, { recursive: true });
    return new Soffice(new SofficeRunner({ programDir: ENGINE_PROGRAM_DIR, workDir, locale: opts.locale ?? 'en-US', name: opts.name ?? 'test', timeoutMs: opts.timeoutMs }));
  }

  get profileDir(): string {
    return this.runner.profileDir;
  }

  get locale(): string {
    return this.runner.locale;
  }

  /** Converts one file; resolves with the output path (`<outDir>/<basename>.<ext>`). */
  async convert(input: string, target: string, opts: { outDir: string; timeoutMs?: number }): Promise<string> {
    const [out] = await this.runner.convert(input, target, opts);
    return out!;
  }

  /** Converts several files of the same document kind in one soffice run. */
  convertMany(inputs: string[], target: string, opts: { outDir: string; timeoutMs?: number }): Promise<string[]> {
    return this.runner.convert(inputs, target, opts);
  }

  /** PDF export with lossless images and embedded standard fonts (deterministic renders). */
  toPdf(input: string, outDir: string, extra?: Record<string, string | number | boolean>): Promise<string> {
    return this.convert(input, convertTarget('pdf', pdfFilterFor(input), pdfFilterData(extra)), { outDir });
  }

  /** Open → save in the same format (e.g. DOCX with "MS Word 2007 XML"). */
  roundTrip(input: string, outDir: string): Promise<string> {
    const ext = extname(input).slice(1).toLowerCase();
    return this.convert(input, convertTarget(ext, sameFormatFilter(input)), { outDir });
  }

  /** Output path LibreOffice uses for `input` converted to `ext`. */
  static outputName(input: string, ext: string): string {
    return `${basename(input, extname(input))}.${ext}`;
  }

  /** soffice processes still using this runner's profile (should always be empty between conversions). */
  leftovers(): Promise<Array<{ pid: number; name: string }>> {
    return this.runner.leftovers();
  }

  /** Kills leftovers and removes the temporary profile. */
  dispose(): Promise<void> {
    return this.runner.dispose();
  }
}
