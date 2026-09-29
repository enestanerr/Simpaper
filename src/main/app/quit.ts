/**
 * Graceful quit: every modified document is offered for saving through the renderer's prompt
 * (save / don't save / cancel), then documents and services are disposed and the recovery session is
 * closed with its clean-shutdown marker. A hard timeout guarantees the process ends even if an engine hangs.
 */
import type { DocumentDescriptor, DocumentEvent, PromptAnswer, SaveResult } from '@shared/api/documents';
import type { Logger } from '../log';

export interface QuitDocuments {
  /**
   * PDF flush protocol: the renderer pushes edits pdf.js still holds (bounded by a timeout), so documents
   * edited just before the quit count as modified.
   */
  flushPending?(): Promise<void>;
  modifiedDocuments(): DocumentDescriptor[];
  activate(docId: string): void;
  prompt(prompt: { kind: 'unsavedChanges'; docId: string; fileName: string } | { kind: 'closeStuck'; docId: string; fileName: string; snapshotAt: string | null }): Promise<PromptAnswer>;
  /** Time of the newest recovery snapshot of a document (see DocumentService.lastSnapshotAt). */
  lastSnapshotAt?(docId: string): Promise<string | null>;
  save(docId: string): Promise<SaveResult>;
  closeAll(): Promise<void>;
  emit(event: DocumentEvent): void;
}

export interface QuitDeps {
  documents: QuitDocuments;
  recovery: { markCleanShutdown(): Promise<void> };
  /** Disposes engine, platform, stores and log (in that order). */
  disposeServices: () => Promise<void>;
  exit: () => void;
  log: Logger;
  timeoutMs?: number;
}

export type QuitPhase = 'running' | 'asking' | 'shutting-down' | 'done';

export class QuitController {
  private phase: QuitPhase = 'running';
  private pending: Promise<boolean> | null = null;

  constructor(private readonly deps: QuitDeps) {}

  get state(): QuitPhase {
    return this.phase;
  }

  /** Asks about unsaved documents, then shuts down. Resolves false when the user cancelled. */
  requestQuit(): Promise<boolean> {
    if (this.phase === 'shutting-down' || this.phase === 'done') return Promise.resolve(true);
    if (this.pending) return this.pending;
    this.pending = this.run().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async run(): Promise<boolean> {
    this.phase = 'asking';
    const docs = this.deps.documents;
    try {
      // Before deciding which documents are modified: pending PDF edits reach the main process first.
      await docs.flushPending?.();
      for (const d of docs.modifiedDocuments()) {
        // A hung or crashed engine cannot save: say what is lost; the recovery snapshot is kept for the next start.
        if (d.state === 'busy' || d.state === 'crashed') {
          docs.activate(d.docId);
          const snapshotAt = (await docs.lastSnapshotAt?.(d.docId)) ?? null;
          const answer = await docs.prompt({ kind: 'closeStuck', docId: d.docId, fileName: d.title, snapshotAt });
          if (answer.kind !== 'closeStuck' || answer.choice !== 'close') {
            this.phase = 'running';
            return false;
          }
          continue;
        }
        if (d.state !== 'ready') continue;
        docs.activate(d.docId);
        const answer = await docs.prompt({ kind: 'unsavedChanges', docId: d.docId, fileName: d.title });
        const choice = answer.kind === 'unsavedChanges' ? answer.choice : 'cancel';
        if (choice === 'cancel') {
          this.phase = 'running';
          return false;
        }
        if (choice === 'save') {
          const result = await docs.save(d.docId);
          if (result.outcome !== 'saved' && result.outcome !== 'savedCopy') {
            if (result.outcome === 'failed') docs.emit({ type: 'error', docId: d.docId, errorKey: result.errorKey ?? 'errors.save.failed', ...(result.errorDetail ? { detail: result.errorDetail } : {}) });
            this.phase = 'running';
            return false;
          }
        }
      }
    } catch (err) {
      this.deps.log.error('quit flow failed', { error: err });
      this.phase = 'running';
      return false;
    }
    await this.shutdown();
    return true;
  }

  /** Disposes everything without asking (after the unsaved-changes prompts). */
  async shutdown(): Promise<void> {
    if (this.phase === 'shutting-down' || this.phase === 'done') return;
    this.phase = 'shutting-down';
    const timer = setTimeout(() => {
      this.deps.log.error('shutdown timed out; exiting');
      this.exitOnce();
    }, this.deps.timeoutMs ?? 20_000);
    try {
      await this.deps.documents.closeAll();
      await this.deps.recovery.markCleanShutdown();
      await this.deps.disposeServices();
    } catch (err) {
      this.deps.log.error('shutdown error', { error: err });
    } finally {
      clearTimeout(timer);
      this.exitOnce();
    }
  }

  private exitOnce(): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.deps.exit();
  }
}
