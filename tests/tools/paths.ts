/** Well-known locations of the test corpus and test artefacts. */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CORPUS_DIR = join(REPO_ROOT, 'tests', 'corpus');
/** Deterministic generated corpus (git-ignored; `npm run corpus:generate`). */
export const GENERATED_DIR = join(CORPUS_DIR, 'generated');
/** Vendored, license-clean third-party samples. */
export const THIRD_PARTY_DIR = join(CORPUS_DIR, 'third_party');
/** Scratch output of tests (git-ignored). */
export const TEST_OUTPUT = join(REPO_ROOT, 'test-output');
/** Scratch folder of the corpus/verification tooling (profiles, conversions, temporary fixtures). */
export const CORPUS_OUTPUT = join(TEST_OUTPUT, 'corpus');
/** Diff images of failed visual comparisons. */
export const VISUAL_OUTPUT = join(TEST_OUTPUT, 'visual');
