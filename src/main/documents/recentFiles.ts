/**
 * Recent files (`recent.json` in userData): most recent first, bounded by settings.recentLimit,
 * existence checked on every listing (with a timeout so unreachable network drives cannot stall the UI).
 */
import { existsSync, readFileSync } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute } from 'node:path';
import type { RecentFile } from '@shared/api/documents';
import { FORMATS, type FormatId } from '@shared/formats';
import { MODULE_KINDS, type ModuleKind } from '@shared/modules';
import type { Logger } from '../log';
import { samePath } from '../files/fsUtil';
import type { SafeWriter } from './types';

type StoredRecent = Omit<RecentFile, 'exists'>;

const FORMAT_IDS = new Set<string>(FORMATS.map((f) => f.id));
const KINDS = new Set<string>(MODULE_KINDS);

function isStoredRecent(v: unknown): v is StoredRecent {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['path'] === 'string' &&
    isAbsolute(r['path']) &&
    typeof r['title'] === 'string' &&
    typeof r['kind'] === 'string' &&
    KINDS.has(r['kind']) &&
    typeof r['format'] === 'string' &&
    FORMAT_IDS.has(r['format']) &&
    typeof r['openedAt'] === 'string' &&
    !Number.isNaN(Date.parse(r['openedAt']))
  );
}

export interface RecentFilesOptions {
  file: string;
  safeWrite: SafeWriter;
  limit: () => number;
  log?: Logger;
  now?: () => Date;
  /** Existence check (default fs.access with a timeout). */
  exists?: (path: string) => Promise<boolean>;
  existsTimeoutMs?: number;
}

export class RecentFilesStore {
  private items: StoredRecent[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly opts: RecentFilesOptions) {
    try {
      if (existsSync(opts.file)) {
        const raw = JSON.parse(readFileSync(opts.file, 'utf8').replace(/^\uFEFF/, '')) as { items?: unknown };
        this.items = Array.isArray(raw.items) ? raw.items.filter(isStoredRecent) : [];
      }
    } catch (err) {
      opts.log?.warn('recent files: unreadable list ignored', { error: err });
      this.items = [];
    }
    this.items = this.items.slice(0, Math.max(0, opts.limit()));
  }

  async add(path: string, kind: ModuleKind, format: FormatId, title = basename(path)): Promise<void> {
    const entry: StoredRecent = { path, title, kind, format, openedAt: (this.opts.now?.() ?? new Date()).toISOString() };
    this.items = [entry, ...this.items.filter((i) => !samePath(i.path, path))].slice(0, Math.max(0, this.opts.limit()));
    await this.persist();
  }

  async remove(path: string): Promise<void> {
    const before = this.items.length;
    this.items = this.items.filter((i) => !samePath(i.path, path));
    if (this.items.length !== before) await this.persist();
  }

  /** Applies a lowered limit (settings change). */
  async trim(): Promise<void> {
    const limit = Math.max(0, this.opts.limit());
    if (this.items.length > limit) {
      this.items = this.items.slice(0, limit);
      await this.persist();
    }
  }

  async list(): Promise<RecentFile[]> {
    const check = this.opts.exists ?? ((p: string) => access(p).then(() => true, () => false));
    const timeout = this.opts.existsTimeoutMs ?? 1500;
    // An unanswered check (offline network share) counts as "exists": the entry stays usable.
    const withTimeout = (p: string) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(true), timeout);
        check(p).then(
          (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          () => {
            clearTimeout(timer);
            resolve(false);
          },
        );
      });
    const snapshot = [...this.items];
    const exists = await Promise.all(snapshot.map((i) => withTimeout(i.path)));
    return snapshot.map((i, n) => ({ ...i, exists: exists[n] ?? true }));
  }

  /** Resolves when pending writes are done. */
  flush(): Promise<void> {
    return this.writeChain;
  }

  private persist(): Promise<void> {
    const text = `${JSON.stringify({ version: 1, items: this.items }, null, 2)}\n`;
    const run = async () => {
      await mkdir(dirname(this.opts.file), { recursive: true });
      await this.opts.safeWrite(this.opts.file, (tmp) => writeFile(tmp, text, 'utf8'));
    };
    const next = this.writeChain.then(run, run);
    this.writeChain = next.catch((err) => this.opts.log?.warn('recent files: write failed', { error: err }));
    return this.writeChain;
  }
}
