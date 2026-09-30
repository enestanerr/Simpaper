#!/usr/bin/env node
/**
 * Generates the deterministic test corpus (npm run corpus:generate).
 *
 *   node scripts/corpus/generate.mjs [--out <dir>] [--large] [--no-derived | --derived] [--engine <programDir>] [--quiet]
 *
 *   --out <dir>        output directory (default tests/corpus/generated, git-ignored)
 *   --large            also write the large fixtures (100k-row XLSX, 300-page DOCX, 200-slide PPTX)
 *   --derived          require LibreOffice and produce the derived formats (default: only when found)
 *   --no-derived       skip the LibreOffice conversions
 *   --engine <dir>     LibreOffice `program` directory (default: SIMPAPER_ENGINE_DIR or vendor/libreoffice/program)
 */
import { parseArgs } from 'node:util';
import { generateCorpus } from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    large: { type: 'boolean', default: false },
    derived: { type: 'boolean' },
    'no-derived': { type: 'boolean', default: false },
    engine: { type: 'string' },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: node scripts/corpus/generate.mjs [--out <dir>] [--large] [--derived | --no-derived] [--engine <programDir>] [--quiet]');
  process.exit(0);
}

const started = Date.now();
try {
  const manifest = await generateCorpus({
    outDir: values.out,
    large: values.large,
    derived: values['no-derived'] ? false : values.derived ? true : 'auto',
    programDir: values.engine,
    log: values.quiet ? undefined : (msg) => console.log(msg),
  });
  const derived = manifest.files.filter((f) => f.origin === 'derived').length;
  console.log(`corpus: ${manifest.files.length} files (${derived} derived) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
} catch (error) {
  console.error(`corpus generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
