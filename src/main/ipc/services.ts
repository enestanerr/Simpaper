/** The service surface the IPC handlers call (narrow interfaces so tests can use fakes). */
import type { BrowserWindow } from 'electron';
import type { AppInfo, Settings, WindowState } from '@shared/api/app';
import type {
  CloseOutcome,
  DocumentDescriptor,
  PdfExportOptions,
  PromptAnswer,
  RecentFile,
  SaveOptions,
  SaveResult,
} from '@shared/api/documents';
import type { CssRect } from '@shared/api/engine';
import type { RecoveryEntry } from '@shared/api/recovery';
import type { ModuleKind, OfficeKind } from '@shared/modules';
import type { OpenDocumentRecord } from '../documents/types';
import type { EngineInstance } from '../engine/types';
import type { Logger } from '../log';
import type { PdfService } from '../pdf/types';
import type { ViewHost } from '../platform/types';

export type WindowAction = 'minimize' | 'toggleMaximize' | 'close' | 'toggleFullScreen';

export interface AppController {
  info(): Promise<AppInfo>;
  getSettings(): Settings;
  /** Throws SettingsValidationError for invalid patches. */
  updateSettings(patch: unknown): Promise<Settings>;
  windowAction(action: WindowAction): WindowState;
  windowState(): WindowState;
  openExternal(url: string): Promise<boolean>;
}

export interface DocumentsApi {
  get(docId: string): OpenDocumentRecord | undefined;
  descriptors(): DocumentDescriptor[];
  create(kind: ModuleKind): Promise<DocumentDescriptor>;
  openDialog(kind?: ModuleKind): Promise<DocumentDescriptor[]>;
  open(path: string): Promise<DocumentDescriptor>;
  save(docId: string, options?: SaveOptions): Promise<SaveResult>;
  exportPdf(docId: string, options?: PdfExportOptions): Promise<SaveResult>;
  close(docId: string, force?: boolean): Promise<CloseOutcome>;
  activate(docId: string): void;
  answerPrompt(promptId: string, answer: PromptAnswer): boolean;
  print(docId: string): Promise<void>;
  instanceOf(docId: string): EngineInstance | undefined;
  noteViewRect(docId: string, rect: CssRect): void;
  noteViewVisible(docId: string, visible: boolean): void;
  /** Native activation (view host) + keyboard focus inside the engine (`view.focus`). */
  focusView(docId: string): void;
  restartEngine(docId: string): Promise<void>;
  /** `documents:flushDone`: the renderer pushed the pending PDF edits of a `flushRequest`. */
  flushDone(requestId: string): void;
}

export interface RecoveryApi {
  list(): Promise<RecoveryEntry[]>;
  restore(id: string): Promise<DocumentDescriptor>;
  discard(id: string): Promise<void>;
}

export interface IpcServices {
  app: AppController;
  documents: DocumentsApi;
  recent: { list(): Promise<RecentFile[]> };
  viewHost: ViewHost;
  pdf: () => PdfService | null;
  recovery: RecoveryApi;
  /** Ribbon allow-list (src/shared/commands.ts). */
  isAllowedUnoCommand: (kind: OfficeKind, command: string) => boolean;
  /** Commands whose state the renderer may observe (dispatchable commands plus status items). */
  isSubscribableUnoCommand?: (kind: OfficeKind, command: string) => boolean;
  /** Platform.allowForeground: a dispatched command may open a LibreOffice dialog that must get the focus. */
  allowEngineForeground?: (pid: number) => void;
  /** Platform.focusHost for the main window (view:focusShell). */
  focusShell?: () => Promise<boolean>;
  getWindow: () => BrowserWindow | null;
  log: Logger;
  /** Called once per renderer request (used to detect that the renderer is up). */
  onRendererRequest?: (channel: string) => void;
}
