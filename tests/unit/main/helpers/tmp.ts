/** Temporary folders for main-process tests (under the git-ignored test-output/main-core). */
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'test-output', 'main-core', 'unit');

export async function makeTempDir(prefix: string): Promise<string> {
  const dir = join(ROOT, `${prefix}-${randomBytes(4).toString('hex')}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
