/** `documents:*` — open/create/save/close lifecycle for all four modules. Owner: main/documents. */
import type { FormatId } from '../formats';
import type { ModuleKind } from '../modules';
import type { UnoPlain } from '../engine-protocol';

export type CompatSeverity = 'info' | 'warning' | 'risk';

/** Something in the source file that the engine may not preserve (see docs/COMPATIBILITY.md). */
export interface CompatFinding {
  id:
    | 'macros'
    | 'activeX'
    | 'embeddedObjects'
    | 'smartArt'
    | 'chartEx'
    | 'charts'
    | 'pivotTables'
    | 'slicers'
    | 'timelines'
    | 'externalLinks'
    | 'powerQuery'
    | 'dataModel'
    | 'threadedComments'
    | 'trackedChanges'
    | 'contentControls'
    | 'equations'
    | 'ink'
    | 'model3d'
    | 'media'
    | 'morphTransition'
    | 'customXml'
    | 'digitalSignature'
    | 'encryption'
    | 'strictOoxml'
    | 'legacyFormat'
    | 'templateMacros'
    | 'missingFonts'
    | 'fontEmbedding';
  severity: CompatSeverity;
  count?: number;
  /** i18n key under `compat.finding.*`. */
  messageKey: string;
  /** Extra detail (e.g. font names); never document text content. */
  detail?: string[];
}

export interface CompatReport {
  format: FormatId;
  findings: CompatFinding[];
  analyzedAt: string;
}

export type EngineDocState = 'loading' | 'ready' | 'busy' | 'crashed' | 'closed';

export interface DocumentDescriptor {
  docId: string;
  kind: ModuleKind;
  /** Display name (file name, or "Belge1"/"Document1" for new documents). */
  title: string;
  /** Absolute path of the user's file; null for new or recovered-unsaved documents. */
  path: string | null;
  format: FormatId | null;
  readOnly: boolean;
  modified: boolean;
  compat: CompatReport | null;
  state: EngineDocState;
  /** Set when the document was restored from a recovery snapshot. */
  recoveredAt?: string;
}

export interface RecentFile {
  path: string;
  title: string;
  kind: ModuleKind;
  format: FormatId;
  openedAt: string;
  exists: boolean;
}

export interface SaveOptions {
  /** Ask for a target path even if the document has one. */
  saveAs?: boolean;
  /** Target format; defaults to the document's format (or the default for its kind). */
  format?: FormatId;
  /**
   * Explicit target path (skips the dialog). Main-process callers only: `documents:save` rejects it
   * (errors.ipc.invalidRequest) — target files are chosen in the native dialog.
   */
  path?: string;
}

export type SaveOutcome = 'saved' | 'savedCopy' | 'cancelled' | 'failed';

export interface SaveResult {
  outcome: SaveOutcome;
  path?: string;
  format?: FormatId;
  /** i18n key describing the failure; the original file is untouched on failure. */
  errorKey?: string;
  errorDetail?: string;
}

export interface PdfExportOptions {
  /** Main-process callers only (always gets `.pdf`): `documents:exportPdf` rejects it (errors.ipc.invalidRequest). */
  path?: string;
  /** Open the result in the PDF module afterwards. */
  openAfter?: boolean;
  pdfA?: boolean;
  taggedPdf?: boolean;
  bookmarks?: boolean;
  /** Embed the ODF source so the PDF can be re-edited losslessly ("hybrid PDF"). */
  hybrid?: boolean;
}

export type CloseOutcome = 'closed' | 'cancelled';

export type Prompt =
  | { id: string; kind: 'password'; fileName: string; retry: boolean }
  | { id: string; kind: 'saveRisk'; docId: string; fileName: string; format: FormatId; findings: CompatFinding[] }
  | { id: string; kind: 'unsavedChanges'; docId: string; fileName: string }
  | { id: string; kind: 'overwriteNewer'; docId: string; fileName: string }
  /**
   * Closing (or quitting with) a modified document whose engine hangs or crashed: it cannot be saved, edits after
   * the newest recovery snapshot (`snapshotAt`, ISO time; null = none) are lost.
   */
  | { id: string; kind: 'closeStuck'; docId: string; fileName: string; snapshotAt: string | null }
  | { id: string; kind: 'csvImport'; fileName: string; defaultSeparator: string; preview: string[] };

export type PromptAnswer =
  | { kind: 'password'; password: string | null }
  | { kind: 'saveRisk'; choice: 'saveCopy' | 'saveAnyway' | 'saveOdf' | 'cancel' }
  | { kind: 'unsavedChanges'; choice: 'save' | 'discard' | 'cancel' }
  | { kind: 'overwriteNewer'; choice: 'overwrite' | 'saveCopy' | 'cancel' }
  | { kind: 'closeStuck'; choice: 'close' | 'cancel' }
  | { kind: 'csvImport'; separator: string | null; locale: string };

export type DocumentEvent =
  | { type: 'opened'; doc: DocumentDescriptor }
  | { type: 'updated'; doc: DocumentDescriptor }
  | { type: 'closed'; docId: string }
  | { type: 'activated'; docId: string }
  | { type: 'state'; docId: string; command: string; enabled: boolean; value: UnoPlain }
  | { type: 'context'; docId: string; context: string }
  | { type: 'busy'; docId: string | null; busy: boolean; reason?: 'dialog' | 'saving' | 'loading' }
  | { type: 'error'; docId: string | null; errorKey: string; detail?: string }
  | { type: 'notice'; docId: string | null; noticeKey: string; detail?: string }
  | { type: 'prompt'; prompt: Prompt }
  /** `Alt` comes from the platform keyboard hook (bare Alt never reaches the engine's key handler). */
  | { type: 'shellKey'; docId: string; key: 'F6' | 'F10' | 'ShiftF6' | 'CtrlF1' | 'CtrlTab' | 'CtrlShiftTab' | 'Alt' }
  | { type: 'intercept'; docId: string; command: string }
  /**
   * The main process is about to save/close/quit a PDF: the renderer must push pending pdf.js edits
   * (saveDocument → pdf:update) and then answer with documents:flushDone { requestId }.
   */
  | { type: 'flushRequest'; docId: string; requestId: string };

export interface DocumentChannels {
  'documents:list': { req: void; res: DocumentDescriptor[] };
  'documents:create': { req: { kind: ModuleKind }; res: DocumentDescriptor };
  /** Shows the native open dialog (optionally filtered to one module) and opens the chosen files. */
  'documents:openDialog': { req: { kind?: ModuleKind }; res: DocumentDescriptor[] };
  'documents:open': { req: { path: string }; res: DocumentDescriptor };
  'documents:recent': { req: void; res: RecentFile[] };
  'documents:save': { req: { docId: string; options?: SaveOptions }; res: SaveResult };
  'documents:exportPdf': { req: { docId: string; options?: PdfExportOptions }; res: SaveResult };
  'documents:close': { req: { docId: string; force?: boolean }; res: CloseOutcome };
  'documents:activate': { req: { docId: string }; res: void };
  'documents:answerPrompt': { req: { promptId: string; answer: PromptAnswer }; res: void };
  'documents:print': { req: { docId: string }; res: void };
  /**
   * Recovery path for an office document whose engine is not responding (`state: 'busy'`) or crashed:
   * ends its engine process and reloads the document from the newest recovery snapshot (else the last saved
   * file) in a new engine instance. Progress arrives as `updated`/`notice`/`error` events.
   */
  'documents:restartEngine': { req: { docId: string }; res: void };
  /** Acknowledges a `flushRequest` event (pending PDF edits were pushed with pdf:update, or there were none). */
  'documents:flushDone': { req: { requestId: string }; res: void };
}

export interface DocumentEvents {
  'documents:event': DocumentEvent;
}

export const DOCUMENT_CHANNELS = [
  'documents:list',
  'documents:create',
  'documents:openDialog',
  'documents:open',
  'documents:recent',
  'documents:save',
  'documents:exportPdf',
  'documents:close',
  'documents:activate',
  'documents:answerPrompt',
  'documents:print',
  'documents:restartEngine',
  'documents:flushDone',
] as const;
export const DOCUMENT_EVENTS = ['documents:event'] as const;
