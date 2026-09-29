/** Interfaces of the DocumentService's collaborators (implemented in src/main/app and src/main/recovery). */
import type { BrowserWindow } from 'electron';
import type { FormatId } from '@shared/formats';
import type { ModuleKind, OfficeKind } from '@shared/modules';
import type { DiskStamp } from './record';

/** Native file dialogs (Electron implementation: src/main/app/dialogs.ts). */
export interface DocumentDialogs {
  openDocuments(win: BrowserWindow | null, kind?: ModuleKind): Promise<string[]>;
  saveDocument(win: BrowserWindow | null, opts: { defaultPath: string; kind: OfficeKind; format: FormatId }): Promise<string | null>;
  savePdf(win: BrowserWindow | null, defaultPath: string): Promise<string | null>;
}

/** Newest recovery snapshot of a document whose engine crashed. */
export interface CrashSnapshot {
  path: string;
  snapshotAt: string;
  /** Stored with the document's password (ODF encryption). */
  encrypted: boolean;
}

/** Hooks the RecoveryService registers with the DocumentService. */
export interface DocumentLifecycleHooks {
  documentSaved(docId: string): void;
  documentClosed(docId: string): void;
  /** Called once per crash; returns the newest snapshot (if any) and records a crash entry. */
  engineCrashed(docId: string): Promise<CrashSnapshot | null>;
  /** The crashed document runs again in a new engine instance; its crash entry is no longer needed. */
  crashRecovered(docId: string): void;
  /** Time (ISO) of the newest recovery snapshot of the document, or null; no side effects. */
  lastSnapshotAt?(docId: string): Promise<string | null>;
}

/** A recovery snapshot to open as a new document (recovery:restore). */
export interface RecoveredDocumentInput {
  snapshotPath: string;
  kind: ModuleKind;
  title: string;
  originalPath: string | null;
  originalFormat: FormatId | null;
  /** State of the original file when the document was opened (external change detection on save). */
  originalStamp?: DiskStamp;
  snapshotAt: string;
  encrypted: boolean;
}
