/**
 * Working copies: the engine and pdf.js only ever touch a private copy of the user's file,
 * stored under `<local>/work/<session>/<docId>/<file name>`; the user's file is written only by
 * the save pipeline. Folders of earlier sessions are removed at startup (the single-instance lock
 * guarantees no other Varak process is using them).
 */
import { chmod, copyFile, mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Logger } from '../log';
import { removeQuietly, sanitizeFileName } from './fsUtil';

export class WorkingCopyStore {
  private readonly sessionDir: string;

  constructor(
    private readonly root: string,
    private readonly sessionId: string,
    private readonly log?: Logger,
  ) {
    this.sessionDir = join(root, sessionId);
  }

  dirFor(docId: string): string {
    return join(this.sessionDir, docId);
  }

  /** Copies `sourcePath` into the document's folder (keeping the file name, which the engine uses as a type hint). */
  async create(docId: string, sourcePath: string, fileName = basename(sourcePath)): Promise<string> {
    const dir = this.dirFor(docId);
    await mkdir(dir, { recursive: true });
    const target = join(dir, sanitizeFileName(fileName, 100));
    await copyFile(sourcePath, target);
    // CopyFile keeps FILE_ATTRIBUTE_READONLY; the engine would then open the copy read-only.
    await chmod(target, 0o666);
    return target;
  }

  async remove(docId: string): Promise<void> {
    await removeQuietly(this.dirFor(docId));
  }

  async removeSession(): Promise<void> {
    await removeQuietly(this.sessionDir);
  }

  /** Deletes the folders of previous sessions (crash leftovers). */
  async cleanupStale(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch {
      return;
    }
    const stale = names.filter((n) => n !== this.sessionId);
    await Promise.all(stale.map((n) => removeQuietly(join(this.root, n))));
    if (stale.length) this.log?.info('removed stale working copies', { sessions: stale.length });
  }
}
