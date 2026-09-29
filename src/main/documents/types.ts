/**
 * Contracts shared by the document lifecycle services (implementation: src/main/documents/*,
 * src/main/files/*). The PDF service and the recovery service use these instead of reaching
 * into DocumentService internals.
 */
import type { DocumentDescriptor, DocumentEvent, Prompt, PromptAnswer } from '@shared/api/documents';

export interface OpenDocumentRecord {
  descriptor: DocumentDescriptor;
  /** Private copy the engine / pdf.js works on; the user's file is only written by the save pipeline. */
  workingCopyPath: string | null;
  /** Filter LibreOffice used on load (office documents only). */
  loadFilter?: string;
  /** Password supplied by the user for this session (never persisted). */
  password?: string;
}

/** mtime/size of a user's file (external change detection before a save overwrites it). */
export interface DiskStamp {
  mtimeMs: number;
  size: number;
}

export interface DocumentRegistry {
  get(docId: string): OpenDocumentRecord | undefined;
  list(): OpenDocumentRecord[];
  update(docId: string, patch: Partial<DocumentDescriptor>): DocumentDescriptor;
  emit(event: DocumentEvent): void;
  /** Sends a prompt to the renderer and resolves with the user's answer. */
  prompt<P extends Prompt>(prompt: Omit<P, 'id'>): Promise<PromptAnswer>;
  /**
   * PDFs: asks the renderer to push edits pdf.js still holds (`flushRequest` event → pdf:update →
   * `documents:flushDone`). Resolves when the renderer confirmed, or after `timeoutMs` (default 10 s, a warning
   * is logged); never rejects. Optional: registries without a renderer have nothing to flush.
   */
  requestFlush?(docId: string, timeoutMs?: number): Promise<void>;
  /** State of the user's file when it was opened or last saved (undefined = unknown). */
  diskStampOf?(docId: string): DiskStamp | undefined;
  /** Records the state of the user's file after the document was written to it. */
  setDiskStamp?(docId: string, stamp: DiskStamp | undefined): void;
}

export interface SafeWriteOptions {
  /** Throws if the freshly written temp file is not acceptable (zip check, re-open, qpdf --check ...). */
  verify?: (tempPath: string) => Promise<void>;
  /** Keep `<name>.bak` of the previous version after a successful replace. Default false. */
  keepBackup?: boolean;
}

/**
 * Writes `targetPath` without ever leaving it half-written:
 * write → temp file in the same folder → flush → verify → atomic replace (ReplaceFileW / rename).
 * On any failure the original file is untouched and the temp file is removed.
 */
export type SafeWriter = (targetPath: string, write: (tempPath: string) => Promise<void>, opts?: SafeWriteOptions) => Promise<void>;
