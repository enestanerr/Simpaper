/**
 * Access to the generated corpus (tests/corpus/generated) and its manifest.
 * `ensureGeneratedCorpus()` generates the fixtures when they are missing or outdated; a cross-process
 * lock makes it safe for parallel test workers.
 */
import { join } from 'node:path';
import { ensureCorpus, type CorpusFile, type CorpusManifest } from '../../scripts/corpus/lib/index.mjs';
import { GENERATED_DIR } from './paths';

export type {
  CorpusFile,
  CorpusManifest,
  DocxFacts,
  PdfEncryptedFacts,
  PdfFormFacts,
  PdfScannedFacts,
  PdfTextFacts,
  PptxFacts,
  XlsxFacts,
} from '../../scripts/corpus/lib/index.mjs';

export interface Corpus {
  dir: string;
  manifest: CorpusManifest;
  /** Absolute path of a corpus file by id. */
  path(id: string): string;
  entry<F = unknown>(id: string): CorpusFile<F>;
  facts<F>(id: string): F;
}

function wrap(dir: string, manifest: CorpusManifest): Corpus {
  const entry = <F>(id: string): CorpusFile<F> => {
    const e = manifest.files.find((f) => f.id === id);
    if (!e) throw new Error(`corpus file ${id} not in manifest (${dir})`);
    return e as CorpusFile<F>;
  };
  return {
    dir,
    manifest,
    path: (id) => join(dir, entry(id).path),
    entry,
    facts<F>(id: string): F {
      const f = entry<F>(id).facts;
      if (f === undefined) throw new Error(`corpus file ${id} has no facts`);
      return f;
    },
  };
}

/**
 * Returns the generated corpus, generating it first when needed.
 * `derived: true` also requires the LibreOffice-derived formats (needs the engine).
 */
export async function ensureGeneratedCorpus(opts: { derived?: boolean; dir?: string } = {}): Promise<Corpus> {
  const dir = opts.dir ?? GENERATED_DIR;
  const manifest = await ensureCorpus({ outDir: dir, derived: opts.derived ?? false });
  return wrap(dir, manifest);
}
