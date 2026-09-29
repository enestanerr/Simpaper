/** Internal state the DocumentService keeps per open document (extends the shared OpenDocumentRecord). */
import type { DocumentDescriptor } from '@shared/api/documents';
import type { CssRect } from '@shared/api/engine';
import type { FormatId } from '@shared/formats';
import type { EngineInstance } from '../engine/types';
import type { CsvSeparator } from './textImport';
import type { DiskStamp, OpenDocumentRecord } from './types';

export type { DiskStamp } from './types';

/** How the document was loaded (reused when the engine has to reload it after a crash). */
export interface LoadParams {
  filter?: string;
  filterOptions?: string;
}

export type BusyReason = 'saving' | 'loading' | 'dialog';

export interface DocRecord extends OpenDocumentRecord {
  instance?: EngineInstance;
  /** Listener removers of the current engine instance. */
  instanceSubs: Array<() => void>;
  /** Format the `loadFilter` belongs to (the file format at load or last save). */
  filterFormat?: FormatId;
  loadParams: LoadParams;
  hwnd?: string;
  hasMacros: boolean;
  /**
   * The model was loaded directly from a macro-enabled Word/PowerPoint OOXML file (DOCM, PPTM ...), so it still
   * carries the original VBA project that LibreOffice copies into a DOCM/PPTM on save. False after loading an
   * ODF recovery snapshot or any other file: saving to DOCM/PPTM then drops the macros (savePlan.ts).
   */
  vbaPassthrough: boolean;
  /** Opened with a password (kept encrypted on save where the target supports it). */
  encrypted: boolean;
  csvSeparator?: CsvSeparator;
  /** Locale chosen in the CSV import prompt (number/date parsing; reused when the saved CSV is reloaded). */
  csvLocale?: string;
  /** mtime/size of the user's file when it was opened or last saved (external change detection). */
  diskStamp?: DiskStamp;
  /** `path|format` targets whose loss risk the user accepted in this session. */
  acceptedRisks: Set<string>;
  closing: boolean;
  abort: AbortController;
  saveChain: Promise<unknown>;
  busy: Set<BusyReason>;
  crashTimes: number[];
  /** Last CSS rect of the workspace reported by the renderer. */
  rect?: CssRect;
  /** Last `view:setVisible` of the renderer (undefined = not reported yet). */
  viewVisible?: boolean;
  /** The native window stopped responding (hang watch); the descriptor state is `busy` meanwhile. */
  hung: boolean;
  /** Pending or shown offer to restart the hung engine (DocumentServiceDeps.offerEngineRescue). */
  rescue?: { controller: AbortController; timer: ReturnType<typeof setTimeout> | null };
  /** Engine work that is not user-visible (recovery snapshots): the hang watch leaves the view alone. */
  background: number;
  /** A user-requested engine restart is running. */
  restarting: boolean;
  /**
   * doc.load/doc.new (with its password prompts) is running: an engine exit meanwhile is left to that load,
   * which fails on its own (the pending call rejects). Exits at any other time run the crash path.
   */
  engineLoads: number;
}

export function newRecord(descriptor: DocumentDescriptor): DocRecord {
  return {
    descriptor,
    workingCopyPath: null,
    instanceSubs: [],
    loadParams: {},
    hasMacros: false,
    vbaPassthrough: false,
    encrypted: false,
    acceptedRisks: new Set(),
    closing: false,
    abort: new AbortController(),
    saveChain: Promise.resolve(),
    busy: new Set(),
    crashTimes: [],
    hung: false,
    background: 0,
    restarting: false,
    engineLoads: 0,
  };
}

export function stampOf(st: { mtimeMs: number; size: number } | null | undefined): DiskStamp | undefined {
  return st ? { mtimeMs: st.mtimeMs, size: st.size } : undefined;
}
