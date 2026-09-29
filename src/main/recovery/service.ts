/**
 * Crash recovery of unsaved work.
 *
 * Every `settings.autosaveMinutes`, each modified document is snapshotted into
 * `<local>/recovery/<session>/`: office documents as ODF through the engine (`doc.store`, writer8/calc8/
 * impress8, with the document's password when it has one), PDFs by copying the working copy. Each
 * snapshot has a manifest written atomically. A clean shutdown writes a marker and removes the session
 * folder; at the next start, folders without the marker are offered through `recovery:list`.
 */
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settings } from '@shared/api/app';
import type { DocumentDescriptor } from '@shared/api/documents';
import type { RecoveryEntry } from '@shared/api/recovery';
import { getFormat } from '@shared/formats';
import { isOfficeKind } from '@shared/modules';
import { DocumentError } from '../documents/errors';
import type { CrashSnapshot, DocumentLifecycleHooks, RecoveredDocumentInput } from '../documents/ports';
import type { DiskStamp } from '../documents/record';
import { ODF_FORMAT } from '../documents/savePlan';
import type { OpenDocumentRecord, SafeWriter } from '../documents/types';
import { verifySavedFile } from '../documents/verify';
import type { EngineInstance } from '../engine/types';
import { pathExists, removeQuietly, toFileUrl } from '../files/fsUtil';
import type { Logger } from '../log';
import { entryId, MANIFEST_SCHEMA, parseEntryId, readManifest, toEntry, type RecoveryManifest } from './manifest';

export const CLEAN_MARKER = 'clean-shutdown';
export const SESSION_FILE = 'session.json';

/** What the recovery service needs from the document service. */
export interface RecoveryDocuments {
  list(): OpenDocumentRecord[];
  isBusy(docId: string): boolean;
  instanceOf(docId: string): EngineInstance | undefined;
  openRecovered(input: RecoveredDocumentInput): Promise<DocumentDescriptor>;
  /** Original file state recorded at open/save (external change detection). */
  diskStampOf?(docId: string): DiskStamp | undefined;
  /** Runs engine work the user does not wait for (the hang watch ignores the document meanwhile). */
  runBackground?<T>(docId: string, fn: () => Promise<T>): Promise<T>;
}

export interface RecoveryServiceDeps {
  root: string;
  sessionId: string;
  documents: RecoveryDocuments;
  safeWrite: SafeWriter;
  settings: () => Settings;
  log: Logger;
  now?: () => Date;
}

interface KnownEntry {
  manifest: RecoveryManifest;
  dir: string;
  sizeBytes: number;
}

export class RecoveryService implements DocumentLifecycleHooks {
  private readonly sessionDir: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private intervalMinutes = 0;
  private running: Promise<void> | null = null;
  private stopped = false;
  /** Entries of earlier sessions, found at startup. */
  private readonly previous = new Map<string, KnownEntry>();
  /** Documents of this session whose engine crashed and that were not restored. */
  private readonly crashed = new Set<string>();
  /**
   * Restored entries whose document has no snapshot of its own yet (the protective snapshot after
   * recovery:restore failed), by the restored document's docId. The entry is kept (hidden from list()) until the
   * document is snapshotted, saved or closed.
   */
  private readonly unprotected = new Map<string, { id: string; entry: KnownEntry }>();
  /** Removals of restored entries still running (documentSaved/documentClosed). */
  private readonly forgetting = new Set<Promise<void>>();

  constructor(private readonly deps: RecoveryServiceDeps) {
    this.sessionDir = join(deps.root, deps.sessionId);
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async start(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
    await writeFile(join(this.sessionDir, SESSION_FILE), JSON.stringify({ sessionId: this.deps.sessionId, pid: process.pid, startedAt: this.now().toISOString() }), 'utf8');
    this.applySettings();
  }

  /** (Re)starts the autosave timer from settings.autosaveMinutes (0 = off). */
  applySettings(): void {
    const minutes = this.deps.settings().autosaveMinutes;
    if (this.stopped || minutes === this.intervalMinutes) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.intervalMinutes = minutes;
    if (minutes > 0) this.timer = setInterval(() => void this.snapshotAll(), minutes * 60_000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private manifestPath(docId: string): string {
    return join(this.sessionDir, `${docId}.json`);
  }

  /** Snapshots every modified, idle document; runs are never concurrent. */
  snapshotAll(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      for (const r of this.deps.documents.list()) {
        const d = r.descriptor;
        if (!d.modified || d.state !== 'ready' || this.deps.documents.isBusy(d.docId)) continue;
        try {
          if (await this.snapshot(r)) await this.protectedNow(d.docId);
        } catch (err) {
          this.deps.log.warn('recovery snapshot failed', { docId: d.docId, error: err });
        }
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Writes the snapshot and its manifest; false when there is nothing to store it from (no engine, no copy). */
  private async snapshot(record: OpenDocumentRecord): Promise<boolean> {
    const d = record.descriptor;
    await mkdir(this.sessionDir, { recursive: true });
    let snapshotFile: string;
    let encrypted = false;
    if (isOfficeKind(d.kind)) {
      const instance = this.deps.documents.instanceOf(d.docId);
      if (!instance) return false;
      const odf = getFormat(ODF_FORMAT[d.kind]);
      snapshotFile = `${d.docId}.${odf.extensions[0]}`;
      encrypted = record.password !== undefined;
      const store = () =>
        this.deps.safeWrite(
          join(this.sessionDir, snapshotFile),
          async (tmp) => {
            await instance.call(
              'doc.store',
              {
                docId: d.docId,
                url: toFileUrl(tmp),
                filter: odf.exportFilter as string,
                ...(record.password !== undefined ? { password: record.password } : {}),
                // Links are stored absolute (like LibreOffice's own AutoRecovery): relative to the recovery
                // folder they would point elsewhere once the snapshot is loaded with the document's path as base.
                baseUrl: '',
              },
              { timeoutMs: 300_000 },
            );
          },
          { verify: (tmp) => verifySavedFile(tmp, { format: odf, encrypted }) },
        );
      await (this.deps.documents.runBackground ? this.deps.documents.runBackground(d.docId, store) : store());
    } else {
      if (!record.workingCopyPath) return false;
      const source = record.workingCopyPath;
      snapshotFile = `${d.docId}.pdf`;
      await this.deps.safeWrite(join(this.sessionDir, snapshotFile), (tmp) => copyFile(source, tmp));
    }
    const manifest: RecoveryManifest = {
      schema: MANIFEST_SCHEMA,
      sessionId: this.deps.sessionId,
      docId: d.docId,
      kind: d.kind,
      title: d.title,
      originalPath: d.path,
      originalFormat: d.format,
      originalStamp: this.deps.documents.diskStampOf?.(d.docId) ?? null,
      snapshotFile,
      snapshotAt: this.now().toISOString(),
      reason: this.crashed.has(d.docId) ? 'engine-crash' : 'unclean-shutdown',
      encrypted,
    };
    await this.writeManifest(manifest);
    this.deps.log.debug('recovery snapshot written', { docId: d.docId, kind: d.kind });
    return true;
  }

  /** The restored document has a snapshot of its own now: the entry it was restored from can go. */
  private async protectedNow(docId: string): Promise<void> {
    const pending = this.unprotected.get(docId);
    if (!pending) return;
    this.unprotected.delete(docId);
    await this.forget(pending.id, pending.entry);
  }

  private async writeManifest(m: RecoveryManifest, dir = this.sessionDir): Promise<void> {
    const text = JSON.stringify(m, null, 2);
    await this.deps.safeWrite(join(dir, `${m.docId}.json`), (tmp) => writeFile(tmp, text, 'utf8'));
  }

  private async removeSnapshot(docId: string, dir = this.sessionDir): Promise<void> {
    const m = await readManifest(join(dir, `${docId}.json`));
    await removeQuietly(join(dir, `${docId}.json`));
    if (m) await removeQuietly(join(dir, m.snapshotFile));
  }

  // ------------------------------------------------------------------ lifecycle hooks

  documentSaved(docId: string): void {
    this.crashed.delete(docId);
    void this.removeSnapshot(docId);
    // The restored content is in the user's file now.
    this.forgetRestoredEntry(docId);
  }

  documentClosed(docId: string): void {
    // A crashed, unrestored document keeps its snapshot: it stays in recovery:list (so does the entry it was
    // restored from, when it never got a snapshot of its own).
    if (this.crashed.has(docId)) {
      this.unprotected.delete(docId);
      return;
    }
    void this.removeSnapshot(docId);
    // Closed on purpose (saved or discarded by the user): the entry it was restored from is no longer wanted.
    this.forgetRestoredEntry(docId);
  }

  /** Background removal of the entry a document was restored from (awaited by markCleanShutdown). */
  private forgetRestoredEntry(docId: string): void {
    if (!this.unprotected.has(docId)) return;
    const task: Promise<void> = this.protectedNow(docId)
      .catch((err: unknown) => this.deps.log.warn('removing the restored recovery entry failed', { error: err }))
      .finally(() => this.forgetting.delete(task));
    this.forgetting.add(task);
  }

  async lastSnapshotAt(docId: string): Promise<string | null> {
    const m = await readManifest(this.manifestPath(docId));
    if (m && (await pathExists(join(this.sessionDir, m.snapshotFile)))) return m.snapshotAt;
    return this.unprotected.get(docId)?.entry.manifest.snapshotAt ?? null;
  }

  async engineCrashed(docId: string): Promise<CrashSnapshot | null> {
    this.crashed.add(docId);
    const m = await readManifest(this.manifestPath(docId));
    const path = m ? join(this.sessionDir, m.snapshotFile) : null;
    if (!m || !path || !(await pathExists(path))) {
      // A restored document without a snapshot of its own: the entry it came from still has its content.
      const pending = this.unprotected.get(docId);
      if (!pending) return null;
      const src = pending.entry;
      return { path: join(src.dir, src.manifest.snapshotFile), snapshotAt: src.manifest.snapshotAt, encrypted: src.manifest.encrypted };
    }
    await this.writeManifest({ ...m, reason: 'engine-crash' }).catch(() => undefined);
    return { path, snapshotAt: m.snapshotAt, encrypted: m.encrypted };
  }

  crashRecovered(docId: string): void {
    this.crashed.delete(docId);
    void (async () => {
      const m = await readManifest(this.manifestPath(docId));
      if (m && m.reason === 'engine-crash') await this.writeManifest({ ...m, reason: 'unclean-shutdown' });
    })().catch(() => undefined);
  }

  // ------------------------------------------------------------------ previous sessions

  /** Finds snapshots of sessions that did not shut down cleanly; removes clean or empty folders. */
  async scanPrevious(): Promise<RecoveryEntry[]> {
    let sessions: string[];
    try {
      sessions = (await readdir(this.deps.root, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name !== this.deps.sessionId).map((e) => e.name);
    } catch {
      return [];
    }
    for (const session of sessions) {
      const dir = join(this.deps.root, session);
      const names = await readdir(dir).catch(() => [] as string[]);
      if (names.includes(CLEAN_MARKER)) {
        await removeQuietly(dir);
        continue;
      }
      let found = 0;
      for (const name of names) {
        if (!name.endsWith('.json') || name === SESSION_FILE) continue;
        const m = await readManifest(join(dir, name));
        if (!m || m.sessionId !== session) continue;
        const size = await stat(join(dir, m.snapshotFile)).then((s) => s.size, () => -1);
        if (size < 0) continue;
        this.previous.set(entryId(m.sessionId, m.docId), { manifest: m, dir, sizeBytes: size });
        found++;
      }
      if (!found) await removeQuietly(dir);
    }
    if (this.previous.size) this.deps.log.info('recovery entries found', { count: this.previous.size });
    return this.list();
  }

  /** Entries restored into a document that is still open (kept until that document is protected). */
  private inUse(id: string): boolean {
    for (const u of this.unprotected.values()) if (u.id === id) return true;
    return false;
  }

  async list(): Promise<RecoveryEntry[]> {
    const out: RecoveryEntry[] = [...this.previous.entries()]
      .filter(([id]) => !this.inUse(id))
      .map(([, e]) => toEntry(e.manifest, e.sizeBytes, e.manifest.reason === 'engine-crash' ? 'engine-crash' : 'unclean-shutdown'));
    for (const docId of this.crashed) {
      if (this.inUse(entryId(this.deps.sessionId, docId))) continue;
      const m = await readManifest(this.manifestPath(docId));
      if (!m) continue;
      const size = await stat(join(this.sessionDir, m.snapshotFile)).then((s) => s.size, () => -1);
      if (size >= 0) out.push(toEntry(m, size, 'engine-crash'));
    }
    return out.sort((a, b) => b.snapshotAt.localeCompare(a.snapshotAt));
  }

  /** Entry of an earlier session, or of a crashed, unrestored document of this session. */
  private async resolveEntry(id: string): Promise<KnownEntry | null> {
    if (this.inUse(id)) return null;
    const prev = this.previous.get(id);
    if (prev) return prev;
    const parsed = parseEntryId(id);
    if (!parsed || parsed.sessionId !== this.deps.sessionId || !this.crashed.has(parsed.docId)) return null;
    const m = await readManifest(this.manifestPath(parsed.docId));
    return m ? { manifest: m, dir: this.sessionDir, sizeBytes: 0 } : null;
  }

  async restore(id: string): Promise<DocumentDescriptor> {
    const entry = await this.resolveEntry(id);
    if (!entry) throw new DocumentError('errors.recovery.notFound');
    const m = entry.manifest;
    const descriptor = await this.deps.documents.openRecovered({
      snapshotPath: join(entry.dir, m.snapshotFile),
      kind: m.kind,
      title: m.title,
      originalPath: m.originalPath,
      originalFormat: m.originalFormat,
      ...(m.originalStamp ? { originalStamp: m.originalStamp } : {}),
      snapshotAt: m.snapshotAt,
      encrypted: m.encrypted,
    });
    // Protect the restored content right away (the next timer tick may be minutes away). The entry it came from
    // is removed only once that snapshot and its manifest exist; until then it stays (hidden from the list
    // while the document is open) and goes with the document's first snapshot, its save or its close.
    const record = this.deps.documents.list().find((r) => r.descriptor.docId === descriptor.docId);
    let protectedCopy = false;
    if (record) {
      try {
        protectedCopy = await this.snapshot(record);
      } catch (err) {
        this.deps.log.warn('snapshot after restore failed; the recovery entry is kept', { error: err });
      }
    }
    if (protectedCopy) await this.forget(id, entry);
    else this.unprotected.set(descriptor.docId, { id, entry });
    return descriptor;
  }

  async discard(id: string): Promise<void> {
    const entry = await this.resolveEntry(id);
    if (!entry) throw new DocumentError('errors.recovery.notFound');
    await this.forget(id, entry);
  }

  private async forget(id: string, entry: KnownEntry): Promise<void> {
    await this.removeSnapshot(entry.manifest.docId, entry.dir);
    this.previous.delete(id);
    if (entry.dir === this.sessionDir) {
      this.crashed.delete(entry.manifest.docId);
      return;
    }
    const left = (await readdir(entry.dir).catch(() => [] as string[])).filter((n) => n.endsWith('.json') && n !== SESSION_FILE);
    if (!left.length) await removeQuietly(entry.dir);
  }

  // ------------------------------------------------------------------ shutdown

  /**
   * Clean shutdown: stops autosave; unless unrestored crash snapshots must survive for the next start,
   * writes the clean-shutdown marker and removes the session folder.
   */
  async markCleanShutdown(): Promise<void> {
    this.stop();
    if (this.running) await this.running.catch(() => undefined);
    await Promise.all([...this.forgetting]);
    if (this.crashed.size) {
      this.deps.log.info('keeping crash snapshots for the next start', { count: this.crashed.size });
      return;
    }
    await mkdir(this.sessionDir, { recursive: true }).catch(() => undefined);
    await writeFile(join(this.sessionDir, CLEAN_MARKER), this.now().toISOString(), 'utf8').catch(() => undefined);
    await removeQuietly(this.sessionDir);
  }
}
