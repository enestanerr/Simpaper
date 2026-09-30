/**
 * DocumentService: open/create/save/export/close lifecycle of all four modules, and the
 * DocumentRegistry the PDF and recovery services build on.
 *
 * Office documents run in their own engine instance (EngineManager.acquireDocumentInstance) on a
 * working copy; the user's file is only written by the safe-save pipeline. PDFs get a working copy
 * and a descriptor; their editing is done by the PDF service.
 */
import { access, constants as fsConstants, mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Settings } from '@shared/api/app';
import type {
  CloseOutcome,
  CompatFinding,
  DocumentDescriptor,
  DocumentEvent,
  PdfExportOptions,
  Prompt,
  PromptAnswer,
  SaveOptions,
  SaveResult,
} from '@shared/api/documents';
import type { CssRect } from '@shared/api/engine';
import { RPC_ERROR, type DocLoadResult, type EngineEvent, type UnoArg, type ViewMode, type ViewParams } from '@shared/engine-protocol';
import { getFormat, PDF_EXPORT_FILTER, type FormatId, type FormatInfo } from '@shared/formats';
import { isOfficeKind, type ModuleKind, type OfficeKind } from '@shared/modules';
import type { CompatAnalyzer } from '../compat/analyzer';
import { makeFinding, normalizeFindings } from '../compat/findings';
import type { EngineExitInfo, EngineInstance, EngineManager } from '../engine/types';
import { STALE_SIBLING } from '../files/safeWrite';
import { ensurePdfExtension, randomToken, removeQuietly, samePath, sanitizeFileName, statOrNull, toFileUrl, withExtension, withNameSuffix } from '../files/fsUtil';
import type { WorkingCopyStore } from '../files/workingCopies';
import type { Logger } from '../log';
import type { PdfService } from '../pdf/types';
import type { HangDetector, ViewHost } from '../platform/types';
import { CANCELLED, DocumentError, engineErrorCode, openErrorInfo, saveErrorInfo } from './errors';
import { startHangWatch, type HangTarget, type HangWatch } from './hangWatch';
import { handleIntercept } from './intercepts';
import { copySuffix, UntitledNamer } from './names';
import type { CrashSnapshot, DocumentDialogs, DocumentLifecycleHooks, RecoveredDocumentInput } from './ports';
import { PromptBroker, type AnswerOf, type PromptKind, type PromptOf } from './prompts';
import type { RecentFilesStore } from './recentFiles';
import { newRecord, stampOf, type BusyReason, type DiskStamp, type DocRecord } from './record';
import {
  assessSaveRisk,
  chooseFilter,
  decideSaveTarget,
  defaultPdfPath,
  defaultSavePath,
  isVbaPassthroughFormat,
  ODF_FORMAT,
  reloadParams,
  resolveSavePath,
  riskKey,
  supportsEncryption,
  type FilterChoice,
} from './savePlan';
import {
  buildCsvImportOptions,
  defaultImportSeparator,
  isCsvLocale,
  isCsvSeparator,
  previewLines,
  readTextSample,
  textFilterOptions,
} from './textImport';
import type { DocumentRegistry, OpenDocumentRecord, SafeWriter } from './types';
import { verifyPdfFile, verifySavedFile } from './verify';

export interface DocumentServiceDeps {
  engine: EngineManager;
  viewHost: ViewHost;
  compat: CompatAnalyzer;
  safeWrite: SafeWriter;
  workingCopies: WorkingCopyStore;
  recent: RecentFilesStore;
  dialogs: DocumentDialogs;
  settings: () => Settings;
  getWindow: () => BrowserWindow | null;
  /** Delivers `documents:event` to the renderer. */
  send: (event: DocumentEvent) => void;
  log: Logger;
  /** Folder for throwaway files (verification PDFs). */
  scratchDir: string;
  /** Folder offered by Save As for documents that have no path yet. */
  defaultDir: () => string;
  /** `.uno:Quit` inside a document starts the app's quit flow. */
  requestQuit?: () => void;
  /**
   * View mode for new views; defaults to `settings.engine.viewMode`. Tests and the smoke run pass
   * `() => 'hidden'` (SIMPAPER_VIEW_MODE=hidden) so that no native window is ever created.
   */
  viewMode?: () => ViewMode;
  /**
   * Ends a process and its descendants at once (ProcessGuard.killTree). Used to restart an engine that
   * does not respond; without it the instance is disposed gracefully (slower).
   */
  killProcessTree?: (pid: number) => Promise<void>;
  /** How long a PDF flush request waits for the renderer's `documents:flushDone` (default 10 s). */
  flushTimeoutMs?: number;
  /**
   * Offers to restart a hung engine in a window of its own. While LibreOffice's window inside the Simpaper window
   * hangs, Windows holds back mouse and keyboard input for the whole Simpaper window (their input queues are
   * attached), so the message bar's "Restart engine" can't be clicked; a window without an owner still gets input.
   * Resolves with the user's choice; `signal` withdraws the offer (the engine answers again, the document is
   * closed or restarted).
   */
  offerEngineRescue?: (offer: EngineRescueOffer, signal: AbortSignal) => Promise<'restart' | 'wait'>;
  /** How long an engine hangs before the rescue is offered (default 8 s), and again after "wait" (default 60 s). */
  rescueTiming?: { delayMs?: number; repeatMs?: number };
}

export interface EngineRescueOffer {
  docId: string;
  fileName: string;
  /**
   * What a restart loses: nothing (no unsaved changes), the changes after the autosave at `snapshotAt`, those
   * since the last save, or everything (never saved and no autosave).
   */
  loss: 'none' | 'sinceSnapshot' | 'sinceSave' | 'all';
  snapshotAt: string | null;
}

/** Size limit for the optional re-open verification (settings.verifyAfterSave). */
const REOPEN_VERIFY_LIMIT = 50 * 1024 * 1024;
const FLUSH_TIMEOUT_MS = 10_000;
const MAX_AUTO_RESTARTS = 2;
const RESTART_WINDOW_MS = 10 * 60 * 1000;
const RESCUE_DELAY_MS = 8_000;
const RESCUE_REPEAT_MS = 60_000;
const RESTART_FOCUS_DELAY_MS = 400;
const SNAPSHOT_FILTER_FORMAT: Record<OfficeKind, FormatId> = ODF_FORMAT;

export function documentLocale(lang: Settings['language']): string {
  return lang === 'tr' ? 'tr-TR' : 'en-US';
}

/** Engine call timeout scaled by file size: 2 min + 2 s per MiB, at most 15 min. */
function timeoutFor(bytes: number): number {
  return Math.min(15 * 60_000, 120_000 + Math.ceil(bytes / (1024 * 1024)) * 2_000);
}

function newDocId(): string {
  return `d${randomToken(8)}`;
}

const isSaved = (r: SaveResult) => r.outcome === 'saved' || r.outcome === 'savedCopy';

export type ShellKeyName = Extract<DocumentEvent, { type: 'shellKey' }>['key'];
/** F10 can arrive twice (engine key handler + platform keyboard hook); repeats within this window are one press. */
const SHELL_KEY_DEDUP_MS = 400;

export class DocumentService implements DocumentRegistry {
  private readonly records = new Map<string, DocRecord>();
  private readonly opening = new Map<string, Promise<DocumentDescriptor>>();
  /** Pending PDF flush requests (`flushRequest` events) by request id. */
  private readonly flushes = new Map<string, () => void>();
  private readonly prompts: PromptBroker;
  private readonly names = new UntitledNamer();
  private pdf: PdfService | null = null;
  private hooks: DocumentLifecycleHooks | null = null;
  private activeId: string | null = null;
  private lastRect: CssRect | undefined;
  private lastF10 = 0;
  private readonly log: Logger;

  constructor(private readonly deps: DocumentServiceDeps) {
    this.log = deps.log;
    this.prompts = new PromptBroker((e) => this.deps.send(e));
  }

  setPdfService(pdf: PdfService): void {
    this.pdf = pdf;
  }

  setLifecycleHooks(hooks: DocumentLifecycleHooks): void {
    this.hooks = hooks;
  }

  // ------------------------------------------------------------------------------ registry

  get(docId: string): OpenDocumentRecord | undefined {
    return this.records.get(docId);
  }

  list(): OpenDocumentRecord[] {
    return [...this.records.values()];
  }

  descriptors(): DocumentDescriptor[] {
    return [...this.records.values()].map((r) => r.descriptor);
  }

  update(docId: string, patch: Partial<DocumentDescriptor>): DocumentDescriptor {
    const record = this.records.get(docId);
    if (!record) throw new DocumentError('errors.ipc.unknownDocument');
    const prev = record.descriptor;
    const next: Record<string, unknown> = { ...prev };
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'docId' || k === 'kind') continue;
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    record.descriptor = next as unknown as DocumentDescriptor;
    this.emit({ type: 'updated', doc: record.descriptor });
    // PDFs are saved by the PDF service: mirror what afterSave does for office documents.
    const d = record.descriptor;
    if (d.kind === 'pdf' && prev.modified && d.modified === false && d.path) {
      this.hooks?.documentSaved(docId);
      if (!prev.path || !samePath(prev.path, d.path)) void this.deps.recent.add(d.path, 'pdf', 'pdf');
    }
    return record.descriptor;
  }

  emit(event: DocumentEvent): void {
    try {
      this.deps.send(event);
    } catch (err) {
      this.log.warn('event delivery failed', { type: event.type, error: err });
    }
  }

  prompt<P extends Prompt>(prompt: Omit<P, 'id'>): Promise<PromptAnswer> {
    return this.prompts.ask(prompt as unknown as Omit<PromptOf<PromptKind>, 'id'> & { kind: PromptKind });
  }

  /** Time of the newest recovery snapshot of a document (closeStuck prompts), or null. */
  async lastSnapshotAt(docId: string): Promise<string | null> {
    return (await this.hooks?.lastSnapshotAt?.(docId).catch(() => null)) ?? null;
  }

  answerPrompt(promptId: string, answer: PromptAnswer): boolean {
    return this.prompts.answer(promptId, answer);
  }

  /** Answers pending prompts with "cancel" (window closing); pending PDF flushes end (nobody can answer). */
  cancelPrompts(): void {
    this.prompts.cancelAll();
    this.settleFlushes();
  }

  /**
   * Re-sends pending prompts after a renderer reload. Pending PDF flushes end: the reloaded renderer has no
   * pdf.js edits left to push.
   */
  resendPrompts(): void {
    this.prompts.resend();
    this.settleFlushes();
  }

  private settleFlushes(): void {
    for (const done of [...this.flushes.values()]) done();
  }

  get activeDocId(): string | null {
    return this.activeId;
  }

  instanceOf(docId: string): EngineInstance | undefined {
    return this.records.get(docId)?.instance;
  }

  isBusy(docId: string): boolean {
    const r = this.records.get(docId);
    return !r || r.closing || r.busy.size > 0 || r.descriptor.state !== 'ready';
  }

  modifiedDocuments(): DocumentDescriptor[] {
    return this.descriptors().filter((d) => d.modified && d.state !== 'closed');
  }

  findByPath(path: string): DocRecord | undefined {
    for (const r of this.records.values()) if (r.descriptor.path && samePath(r.descriptor.path, path)) return r;
    return undefined;
  }

  diskStampOf(docId: string): DiskStamp | undefined {
    return this.records.get(docId)?.diskStamp;
  }

  setDiskStamp(docId: string, stamp: DiskStamp | undefined): void {
    const r = this.records.get(docId);
    if (r) r.diskStamp = stamp;
  }

  /**
   * PDF flush protocol: pdf.js keeps form and annotation edits in the renderer until its (debounced) byte sync
   * (pdf:update). Before a PDF is saved, closed or the app quits, the renderer is asked to push them
   * (`flushRequest` event) and answers with `documents:flushDone`. Resolves on that answer, or after `timeoutMs`
   * with a warning (a renderer that hangs or reloads must not block the save or the quit); never rejects.
   */
  requestFlush(docId: string, timeoutMs = this.deps.flushTimeoutMs ?? FLUSH_TIMEOUT_MS): Promise<void> {
    const record = this.records.get(docId);
    // Only PDFs keep edits in the renderer; without a window nobody could answer.
    if (!record || record.descriptor.kind !== 'pdf' || !this.win()) return Promise.resolve();
    const requestId = `f${randomToken(6)}`;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.flushes.delete(requestId);
        this.log.warn('the renderer did not confirm the PDF flush in time', { docId, timeoutMs });
        resolve();
      }, timeoutMs);
      timer.unref?.();
      this.flushes.set(requestId, () => {
        clearTimeout(timer);
        this.flushes.delete(requestId);
        resolve();
      });
      this.emit({ type: 'flushRequest', docId, requestId });
    });
  }

  /** `documents:flushDone`; unknown or expired request ids are ignored. */
  flushDone(requestId: string): void {
    this.flushes.get(requestId)?.();
  }

  /** Quit: every open PDF pushes its pending edits before the modified documents are listed. */
  async flushPdfEdits(): Promise<void> {
    const pdfs = [...this.records.values()].filter((r) => r.descriptor.kind === 'pdf' && !r.closing);
    await Promise.all(pdfs.map((r) => this.requestFlush(r.descriptor.docId)));
  }

  /** Workspace rect reported by the renderer (initial bounds for documents opened later). */
  noteViewRect(docId: string, rect: CssRect): void {
    const r = this.records.get(docId);
    if (r) r.rect = rect;
    this.lastRect = rect;
  }

  /**
   * Keys the shell handles itself (KeyTips, F6 region cycling ...) pressed while a native document window
   * had the focus: from the engine's key handler or from the platform keyboard hook (Alt/F10).
   */
  emitShellKey(docId: string, key: ShellKeyName): void {
    if (!this.records.has(docId)) return;
    if (key === 'F10') {
      const now = Date.now();
      if (now - this.lastF10 < SHELL_KEY_DEDUP_MS) return;
      this.lastF10 = now;
    }
    this.emit({ type: 'shellKey', docId, key });
  }

  /** Whether any document has a native window attached (owned/child views). */
  hasNativeViews(): boolean {
    for (const r of this.records.values()) if (r.hwnd) return true;
    return false;
  }

  /** Visibility of the document's view as requested by the renderer (`view:setVisible`; hang watch targets). */
  noteViewVisible(docId: string, visible: boolean): void {
    const r = this.records.get(docId);
    if (r) r.viewVisible = visible;
  }

  /**
   * `view:focus`: activates the native window (owned mode, only while Simpaper is in the foreground) and asks
   * the engine to put the keyboard focus into the document (VCL decides focus inside LibreOffice).
   */
  focusView(docId: string): void {
    const record = this.records.get(docId);
    if (!record) return;
    try {
      this.deps.viewHost.focus(docId);
    } catch {
      // not attached
    }
    const instance = record.instance;
    if (!instance || !record.hwnd || record.hung || record.closing || record.descriptor.state !== 'ready') return;
    // After a popup or prompt over the document the view is still frozen (hidden) for a moment: LibreOffice would
    // not give the keyboard to it.
    const shown = this.deps.viewHost.whenShown?.(docId) ?? Promise.resolve();
    void shown
      .then(() => {
        if (record.instance !== instance || record.hung || record.closing) return;
        return instance.call('view.focus', { docId }, { timeoutMs: 5_000 });
      })
      .catch((err: unknown) => this.log.debug('view.focus failed', { docId, error: err }));
  }

  /**
   * Runs engine work the user does not wait for (recovery snapshots): the hang watch does not count the
   * window as hung meanwhile (a large store keeps LibreOffice's message loop busy).
   */
  async runBackground<T>(docId: string, fn: () => Promise<T>): Promise<T> {
    const record = this.records.get(docId);
    if (record) record.background++;
    try {
      return await fn();
    } finally {
      if (record) record.background--;
    }
  }

  // ------------------------------------------------------------------------------ helpers

  private ask<K extends PromptKind>(prompt: Omit<PromptOf<K>, 'id'> & { kind: K }, owner?: string): Promise<AnswerOf<K>> {
    return this.prompts.ask(prompt, owner);
  }

  private win(): BrowserWindow | null {
    const w = this.deps.getWindow();
    return w && !w.isDestroyed() ? w : null;
  }

  private locale(): string {
    return documentLocale(this.deps.settings().language);
  }

  private setBusy(record: DocRecord, reason: BusyReason, busy: boolean): void {
    if (busy) record.busy.add(reason);
    else record.busy.delete(reason);
    this.emit({ type: 'busy', docId: record.descriptor.docId, busy, reason });
  }

  private notice(docId: string | null, noticeKey: string, detail?: string): void {
    this.emit({ type: 'notice', docId, noticeKey, ...(detail ? { detail } : {}) });
  }

  private error(docId: string | null, errorKey: string, detail?: string): void {
    if (errorKey === CANCELLED) return;
    this.emit({ type: 'error', docId, errorKey, ...(detail ? { detail } : {}) });
  }

  private checkAlive(record: DocRecord): void {
    if (record.closing || !this.records.has(record.descriptor.docId)) throw new DocumentError(CANCELLED);
  }

  private register(descriptor: DocumentDescriptor): DocRecord {
    const record = newRecord(descriptor);
    this.records.set(descriptor.docId, record);
    this.emit({ type: 'opened', doc: descriptor });
    this.activate(descriptor.docId);
    return record;
  }

  private viewParams(record: DocRecord): ViewParams {
    const mode = this.deps.viewMode?.() ?? this.deps.settings().engine.viewMode;
    const win = this.win();
    if (mode === 'hidden' || !win || !this.deps.viewHost.supported) return { mode: 'hidden' };
    try {
      return this.deps.viewHost.viewParamsFor(win, mode, record.rect ?? this.lastRect);
    } catch (err) {
      this.log.warn('view params unavailable; loading hidden', { error: err });
      return { mode: 'hidden' };
    }
  }

  private async acquire(record: DocRecord): Promise<EngineInstance> {
    const docId = record.descriptor.docId;
    const instance = await this.deps.engine.acquireDocumentInstance(docId);
    this.dropInstanceSubs(record);
    record.instance = instance;
    record.instanceSubs.push(
      instance.onEvent((e) => this.onEngineEvent(docId, instance, e)),
      instance.onExit((info) => void this.onEngineExit(docId, instance, info)),
    );
    return instance;
  }

  private dropInstanceSubs(record: DocRecord): void {
    for (const off of record.instanceSubs.splice(0)) {
      try {
        off();
      } catch {
        // listener already gone
      }
    }
  }

  /**
   * Runs a load of the document into its engine (doc.load with its password prompts, doc.new, a restore): an
   * engine exit meanwhile is left to that flow, which fails on its own (the pending call rejects) or checks the
   * instance before the document becomes `ready`. Exits at any other time run the crash path (onEngineExit).
   */
  private async engineLoad<T>(record: DocRecord, fn: () => Promise<T>): Promise<T> {
    record.engineLoads++;
    try {
      return await fn();
    } finally {
      record.engineLoads--;
    }
  }

  /** The record still uses `instance` and its processes run. */
  private engineAlive(record: DocRecord, instance: EngineInstance): boolean {
    const state = instance.info().state;
    return record.instance === instance && (state === 'ready' || state === 'busy');
  }

  /** soffice.bin of an instance that may still run; a crashed or stopped instance has ended its processes already. */
  private killablePid(instance: EngineInstance): number | undefined {
    const info = instance.info();
    return info.state === 'crashed' || info.state === 'stopped' ? undefined : info.officePid;
  }

  /** A document restored from a snapshot is modified in the engine too; a dead engine is an error, not ignored. */
  private async markRestoredModified(docId: string, instance: EngineInstance): Promise<void> {
    try {
      await instance.call('doc.setModified', { docId, modified: true });
    } catch (err) {
      if (engineErrorCode(err) === RPC_ERROR.ENGINE_UNAVAILABLE) throw err;
      this.log.warn('doc.setModified failed after a restore', { docId, error: err });
    }
  }

  private attachView(record: DocRecord, result: DocLoadResult, params: ViewParams): void {
    const win = this.win();
    if (!result.hwnd || !win || params.mode === 'hidden') return;
    record.hwnd = result.hwnd;
    const docId = record.descriptor.docId;
    try {
      this.deps.viewHost.attach(docId, win, result.hwnd, params.mode);
      // The visibility the renderer asked for last (it does not repeat it when an engine restart re-attaches the
      // view of a background document); before any bounds, so a hidden document never appears for a moment.
      this.deps.viewHost.setVisible(docId, record.viewVisible ?? docId === this.activeId);
      if (record.rect) this.deps.viewHost.setBounds(docId, record.rect);
    } catch (err) {
      this.log.error('attaching the document view failed', { docId: record.descriptor.docId, error: err });
    }
  }

  private detachView(docId: string): void {
    try {
      this.deps.viewHost.detach(docId);
    } catch {
      // not attached
    }
  }

  private async askPassword(record: DocRecord, retry: boolean): Promise<string> {
    const answer = await this.ask({ kind: 'password', fileName: record.descriptor.title, retry }, record.descriptor.docId);
    this.checkAlive(record);
    if (answer.password === null) throw new DocumentError(CANCELLED);
    return answer.password;
  }

  /** doc.load with the password prompt loop (PASSWORD_REQUIRED / WRONG_PASSWORD). */
  private async loadWithPassword(
    record: DocRecord,
    instance: EngineInstance,
    params: { url: string; baseUrl?: string; filter?: string; filterOptions?: string },
    size: number,
    knownEncrypted: boolean,
    presetPassword?: string,
  ): Promise<{ result: DocLoadResult; password?: string; view: ViewParams }> {
    let password = presetPassword;
    if (knownEncrypted && password === undefined) password = await this.askPassword(record, false);
    for (;;) {
      this.checkAlive(record);
      const view = this.viewParams(record);
      try {
        const result = await instance.call(
          'doc.load',
          {
            docId: record.descriptor.docId,
            url: params.url,
            ...(params.baseUrl ? { baseUrl: params.baseUrl } : {}),
            ...(params.filter ? { filter: params.filter } : {}),
            ...(params.filterOptions ? { filterOptions: params.filterOptions } : {}),
            ...(password !== undefined ? { password } : {}),
            readOnly: false,
            view,
          },
          { timeoutMs: timeoutFor(size), signal: record.abort.signal },
        );
        return { result, view, ...(password !== undefined ? { password } : {}) };
      } catch (err) {
        const code = engineErrorCode(err);
        if (code !== RPC_ERROR.PASSWORD_REQUIRED && code !== RPC_ERROR.WRONG_PASSWORD) throw err;
        this.checkAlive(record);
        password = await this.askPassword(record, code === RPC_ERROR.WRONG_PASSWORD || password !== undefined);
      }
    }
  }

  private applyLoadResult(record: DocRecord, result: DocLoadResult, view: ViewParams, filterFormat: FormatId | undefined): void {
    record.loadFilter = result.filterName;
    record.filterFormat = filterFormat;
    record.hasMacros = result.hasMacros;
    this.attachView(record, result, view);
    const patch: Partial<DocumentDescriptor> = {};
    if (result.readOnly && !record.descriptor.readOnly) patch.readOnly = true;
    const compat = record.descriptor.compat;
    const extra: CompatFinding[] = [];
    const kind = record.descriptor.kind;
    if (isOfficeKind(kind)) {
      if (result.hasMacros && !compat?.findings.some((f) => f.id === 'macros')) extra.push(makeFinding('macros', kind));
      if (record.encrypted && !compat?.findings.some((f) => f.id === 'encryption')) extra.push(makeFinding('encryption', kind));
    }
    if (extra.length && compat) patch.compat = { ...compat, findings: normalizeFindings([...compat.findings, ...extra]) };
    if (Object.keys(patch).length) this.update(record.descriptor.docId, patch);
    if (result.hasMacros) this.notice(record.descriptor.docId, 'errors.notice.macrosDisabled');
  }

  // ------------------------------------------------------------------------------ open / create

  async open(inputPath: string): Promise<DocumentDescriptor> {
    const path = resolve(inputPath);
    const existing = this.findByPath(path);
    if (existing) {
      this.activate(existing.descriptor.docId);
      return existing.descriptor;
    }
    const key = process.platform === 'win32' ? path.toLowerCase() : path;
    const inflight = this.opening.get(key);
    if (inflight) return inflight;
    const task = this.doOpen(path).finally(() => this.opening.delete(key));
    this.opening.set(key, task);
    return task;
  }

  /** Open dialog → open every chosen file; failures are reported as events. */
  async openDialog(kind?: ModuleKind): Promise<DocumentDescriptor[]> {
    const paths = await this.deps.dialogs.openDocuments(this.win(), kind);
    const opened: DocumentDescriptor[] = [];
    for (const p of paths) {
      try {
        opened.push(await this.open(p));
      } catch (err) {
        const info = openErrorInfo(err);
        this.error(null, info.errorKey, basename(p));
      }
    }
    return opened;
  }

  private async doOpen(path: string): Promise<DocumentDescriptor> {
    const st = await statOrNull(path);
    if (!st) throw new DocumentError('errors.open.notFound');
    if (!st.isFile()) throw new DocumentError('errors.open.unsupported');
    let inspection;
    try {
      inspection = await this.deps.compat.inspect(path);
    } catch (err) {
      throw new DocumentError(openErrorInfo(err).errorKey, { cause: err });
    }
    const format = inspection.format;
    if (!format) throw new DocumentError('errors.open.unsupported');
    if (inspection.irm) throw new DocumentError('errors.open.irm');
    if (inspection.unsupportedEncryption) throw new DocumentError('errors.open.encryptedPpt');
    const readOnly = await access(path, fsConstants.W_OK).then(
      () => false,
      () => true,
    );

    const record = this.register({
      docId: newDocId(),
      kind: format.kind,
      title: basename(path),
      path,
      format: format.id,
      readOnly,
      modified: false,
      compat: inspection.report,
      state: 'loading',
    });
    const docId = record.descriptor.docId;
    this.setBusy(record, 'loading', true);
    try {
      record.workingCopyPath = await this.deps.workingCopies.create(docId, path);
      this.checkAlive(record);
      if (isOfficeKind(format.kind)) await this.loadOfficeFile(record, format, st.size, inspection.encrypted);
      record.diskStamp = stampOf(st);
      this.update(docId, { state: 'ready' });
      if (readOnly) this.notice(docId, 'errors.notice.readOnly');
      void this.deps.recent.add(path, format.kind, format.id);
      this.log.info('document opened', { docId, format: format.id, bytes: st.size });
      return record.descriptor;
    } catch (err) {
      await this.discard(record);
      const info = openErrorInfo(err);
      if (info.errorKey !== CANCELLED) this.log.warn('open failed', { docId, format: format.id, errorKey: info.errorKey, error: err });
      throw err instanceof DocumentError ? err : new DocumentError(info.errorKey, { cause: err, ...(info.detail ? { detail: info.detail } : {}) });
    } finally {
      this.setBusy(record, 'loading', false);
    }
  }

  private async loadOfficeFile(record: DocRecord, format: FormatInfo, size: number, encrypted: boolean): Promise<void> {
    const workingCopy = record.workingCopyPath;
    if (!workingCopy) throw new DocumentError('errors.open.failed');
    const settings = this.deps.settings();
    const locale = this.locale();
    const filter = format.editImportFilter ?? format.importFilter;
    let filterOptions: string | undefined;

    if (format.id === 'csv' || format.id === 'tsv') {
      const sample = await readTextSample(workingCopy, locale);
      const lines = previewLines(sample.text);
      const defaultSeparator = defaultImportSeparator(settings.csv.importSeparator, format.id === 'tsv', lines, locale);
      const answer = await this.ask({ kind: 'csvImport', fileName: record.descriptor.title, defaultSeparator, preview: lines }, record.descriptor.docId);
      this.checkAlive(record);
      if (answer.separator === null) throw new DocumentError(CANCELLED);
      const separator = isCsvSeparator(answer.separator) ? answer.separator : defaultSeparator;
      const csvLocale = isCsvLocale(answer.locale) ? answer.locale : locale;
      // Legacy text uses the code page the preview was decoded with (the UI locale), whatever number format is chosen.
      filterOptions = buildCsvImportOptions(separator, csvLocale, sample.encoding, locale);
      record.csvSeparator = separator;
      record.csvLocale = csvLocale;
    } else if (format.importFilterOptions) {
      const sample = await readTextSample(workingCopy, locale);
      filterOptions = textFilterOptions(format.importFilterOptions, locale, sample.encoding);
    }
    record.loadParams = { ...(filter ? { filter } : {}), ...(filterOptions ? { filterOptions } : {}) };
    record.encrypted = encrypted;
    // Loaded straight from a DOCM/PPTM (…): the model keeps the VBA project a DOCM/PPTM save copies back.
    record.vbaPassthrough = isVbaPassthroughFormat(format);

    const instance = await this.acquire(record);
    this.checkAlive(record);
    const { result, password, view } = await this.engineLoad(record, () =>
      this.loadWithPassword(
        record,
        instance,
        { url: toFileUrl(workingCopy), ...(record.descriptor.path ? { baseUrl: toFileUrl(record.descriptor.path) } : {}), ...(filter ? { filter } : {}), ...(filterOptions ? { filterOptions } : {}) },
        size,
        encrypted,
      ),
    );
    if (password !== undefined) {
      record.password = password;
      record.encrypted = true;
    }
    this.applyLoadResult(record, result, view, format.id);
  }

  async create(kind: ModuleKind): Promise<DocumentDescriptor> {
    if (!isOfficeKind(kind)) throw new DocumentError('errors.create.pdfUnsupported');
    const settings = this.deps.settings();
    const record = this.register({
      docId: newDocId(),
      kind,
      title: this.names.next(kind, settings.language),
      path: null,
      format: null,
      readOnly: false,
      modified: false,
      compat: null,
      state: 'loading',
    });
    const docId = record.descriptor.docId;
    this.setBusy(record, 'loading', true);
    try {
      const instance = await this.acquire(record);
      this.checkAlive(record);
      const view = this.viewParams(record);
      const result = await this.engineLoad(record, () => instance.call('doc.new', { docId, kind, view }, { signal: record.abort.signal }));
      this.applyLoadResult(record, result, view, undefined);
      this.update(docId, { state: 'ready' });
      this.log.info('document created', { docId, kind });
      return record.descriptor;
    } catch (err) {
      await this.discard(record);
      const info = openErrorInfo(err);
      throw err instanceof DocumentError ? err : new DocumentError(info.errorKey === 'errors.open.failed' ? 'errors.create.failed' : info.errorKey, { cause: err });
    } finally {
      this.setBusy(record, 'loading', false);
    }
  }

  /** Opens a recovery snapshot as a new document tied to the original path/format (recovery:restore). */
  async openRecovered(input: RecoveredDocumentInput): Promise<DocumentDescriptor> {
    const st = await statOrNull(input.snapshotPath);
    if (!st) throw new DocumentError('errors.recovery.notFound');
    const record = this.register({
      docId: newDocId(),
      kind: input.kind,
      title: input.title,
      path: input.originalPath,
      format: input.originalFormat,
      readOnly: false,
      modified: true,
      compat: null,
      state: 'loading',
      recoveredAt: input.snapshotAt,
    });
    const docId = record.descriptor.docId;
    record.diskStamp = input.originalStamp;
    this.setBusy(record, 'loading', true);
    try {
      if (!isOfficeKind(input.kind)) {
        record.workingCopyPath = await this.deps.workingCopies.create(docId, input.snapshotPath, `${sanitizeFileName(input.title, 80)}.pdf`);
      } else {
        const odf = getFormat(SNAPSHOT_FILTER_FORMAT[input.kind]);
        record.workingCopyPath = await this.deps.workingCopies.create(docId, input.snapshotPath, `recovered.${odf.extensions[0]}`);
        record.encrypted = input.encrypted;
        // An ODF snapshot has no VBA project to copy into a DOCM/PPTM (savePlan.ts, isVbaPassthroughFormat).
        record.vbaPassthrough = false;
        const workingCopy = record.workingCopyPath;
        // The whole engine phase counts as the load: this flow handles an engine that ends meanwhile itself
        // (the check below; the document is then discarded and the recovery entry kept).
        await this.engineLoad(record, async () => {
          const instance = await this.acquire(record);
          const { result, password, view } = await this.loadWithPassword(
            record,
            instance,
            {
              url: toFileUrl(workingCopy),
              ...(input.originalPath ? { baseUrl: toFileUrl(input.originalPath) } : {}),
              ...(odf.exportFilter ? { filter: odf.exportFilter } : {}),
            },
            st.size,
            input.encrypted,
          );
          if (password !== undefined) record.password = password;
          this.applyLoadResult(record, result, view, odf.id);
          await this.markRestoredModified(docId, instance);
          if (input.originalPath && (await statOrNull(input.originalPath))) {
            const inspection = await this.deps.compat.inspect(input.originalPath).catch(() => null);
            if (inspection?.report) this.update(docId, { compat: inspection.report });
            if (inspection?.encrypted) record.encrypted = true;
          }
          if (!this.engineAlive(record, instance)) throw new DocumentError('errors.recovery.restoreFailed');
        });
      }
      this.update(docId, { state: 'ready', modified: true });
      this.log.info('recovery snapshot opened', { docId, kind: input.kind });
      return record.descriptor;
    } catch (err) {
      await this.discard(record);
      const info = openErrorInfo(err);
      throw err instanceof DocumentError ? err : new DocumentError(info.errorKey === 'errors.open.failed' ? 'errors.recovery.restoreFailed' : info.errorKey, { cause: err });
    } finally {
      this.setBusy(record, 'loading', false);
    }
  }

  // ------------------------------------------------------------------------------ save

  save(docId: string, options: SaveOptions = {}): Promise<SaveResult> {
    const record = this.records.get(docId);
    if (!record) return Promise.resolve({ outcome: 'failed', errorKey: 'errors.save.notFound' });
    const run = () => this.doSave(record, options);
    const next = record.saveChain.then(run, run);
    record.saveChain = next.catch(() => undefined);
    return next;
  }

  private async doSave(record: DocRecord, options: SaveOptions): Promise<SaveResult> {
    const docId = record.descriptor.docId;
    const kind = record.descriptor.kind;
    if (!isOfficeKind(kind)) {
      if (!this.pdf) return { outcome: 'failed', errorKey: 'errors.save.failed' };
      return this.pdf.save(docId, Boolean(options.saveAs), this.win());
    }
    const instance = record.instance;
    if (!instance || record.descriptor.state !== 'ready' || record.closing) return { outcome: 'failed', errorKey: 'errors.save.notReady' };

    this.setBusy(record, 'saving', true);
    try {
      const settings = this.deps.settings();
      const lang = settings.language;
      const decision = decideSaveTarget(record.descriptor, options);
      let outcome: 'saved' | 'savedCopy' = 'saved';
      let target = await this.pickTarget(record, decision.format, options.path ? resolve(options.path) : null, decision.needsDialog);
      if (!target) return { outcome: 'cancelled' };

      const source = record.descriptor.format ? getFormat(record.descriptor.format) : null;
      const findings = assessSaveRisk({
        kind,
        report: record.descriptor.compat,
        source,
        target: target.format,
        hasMacros: record.hasMacros,
        encrypted: record.encrypted,
        vbaPassthrough: record.vbaPassthrough,
      });
      if (findings.length && !record.acceptedRisks.has(riskKey(target.path, target.format))) {
        const answer = await this.ask({ kind: 'saveRisk', docId, fileName: basename(target.path), format: target.format.id, findings });
        if (answer.choice === 'cancel') return { outcome: 'cancelled' };
        if (answer.choice === 'saveCopy') {
          target = await this.pickTarget(record, target.format, null, true, withNameSuffix(target.path, copySuffix(lang)));
          if (!target) return { outcome: 'cancelled' };
          outcome = 'savedCopy';
        } else if (answer.choice === 'saveOdf') {
          const odf = getFormat(ODF_FORMAT[kind]);
          target = await this.pickTarget(record, odf, null, true, withExtension(target.path, odf.extensions[0] ?? odf.id));
          if (!target) return { outcome: 'cancelled' };
        }
        record.acceptedRisks.add(riskKey(target.path, target.format));
      }

      // The file changed on disk since it was opened/saved (another program or a sync client wrote it).
      if (record.descriptor.path && record.diskStamp && samePath(target.path, record.descriptor.path)) {
        const st = await statOrNull(target.path);
        if (st && (st.mtimeMs !== record.diskStamp.mtimeMs || st.size !== record.diskStamp.size)) {
          const answer = await this.ask({ kind: 'overwriteNewer', docId, fileName: basename(target.path) });
          if (answer.choice === 'cancel') return { outcome: 'cancelled' };
          if (answer.choice === 'saveCopy') {
            target = await this.pickTarget(record, target.format, null, true, withNameSuffix(target.path, copySuffix(lang)));
            if (!target) return { outcome: 'cancelled' };
            outcome = 'savedCopy';
          }
        }
      }

      const other = this.findByPath(target.path);
      if (other && other !== record) return { outcome: 'failed', errorKey: 'errors.save.targetOpen' };

      const written = await this.writeOfficeFile(record, instance, target.path, target.format, settings);
      await this.afterSave(record, instance, target.path, target.format, written);
      this.log.info('document saved', { docId, format: target.format.id, outcome });
      return { outcome, path: target.path, format: target.format.id };
    } catch (err) {
      if (err instanceof DocumentError && err.errorKey === CANCELLED) return { outcome: 'cancelled' };
      const info = saveErrorInfo(err);
      this.log.warn('save failed', { docId, errorKey: info.errorKey, detail: info.detail, error: err });
      return { outcome: 'failed', errorKey: info.errorKey, ...(info.detail ? { errorDetail: info.detail } : {}) };
    } finally {
      this.setBusy(record, 'saving', false);
    }
  }

  /** Target path + format: explicit path, the document's own path, or the Save As dialog. */
  private async pickTarget(
    record: DocRecord,
    format: FormatInfo,
    explicitPath: string | null,
    needsDialog: boolean,
    suggested?: string,
  ): Promise<{ path: string; format: FormatInfo } | null> {
    const kind = record.descriptor.kind as OfficeKind;
    if (explicitPath) return resolveSavePath(explicitPath, kind, format);
    if (!needsDialog && record.descriptor.path) return { path: record.descriptor.path, format };
    const defaultPath = suggested ?? defaultSavePath(record.descriptor, format, this.deps.defaultDir());
    const chosen = await this.deps.dialogs.saveDocument(this.win(), { defaultPath, kind, format: format.id });
    if (!chosen) return null;
    return resolveSavePath(chosen, kind, format);
  }

  /**
   * Stores the document into a temp sibling of `path`, verifies it and replaces the user's file.
   *
   * The engine clears its modified flag in the same job as the store (`markSaved`), so an edit made while the
   * file is verified sets it again (and emits `modified: true`); the descriptor follows the engine's real state
   * afterwards (afterSave). When anything after the store fails, the flag is set again: the user's file does not
   * have these changes.
   */
  private async writeOfficeFile(record: DocRecord, instance: EngineInstance, path: string, format: FormatInfo, settings: Settings): Promise<FilterChoice> {
    const docId = record.descriptor.docId;
    const kind = record.descriptor.kind as OfficeKind;
    const choice = chooseFilter({
      target: format,
      ...(record.loadFilter ? { loadFilter: record.loadFilter } : {}),
      ...(record.filterFormat ? { filterFormat: record.filterFormat } : {}),
      locale: this.locale(),
      csv: settings.csv,
      ...(record.csvSeparator ? { csvSeparator: record.csvSeparator } : {}),
    });
    const { filter, filterOptions } = choice;
    const password = record.password !== undefined && supportsEncryption(format) ? record.password : undefined;
    const workingSize = (record.workingCopyPath ? (await statOrNull(record.workingCopyPath))?.size : 0) ?? 0;
    // Never re-open an encrypted document into a verification PDF: the throwaway file would hold its content in
    // plain text. The structural checks (compound file with EncryptedPackage, encrypted ODF package) still run.
    const deepVerify = settings.verifyAfterSave && password === undefined && format.family !== 'text';
    let flagCleared = false;
    let wasModified = false;
    await this.sweepStaleSiblings(dirname(path));
    try {
      await this.deps.safeWrite(
        path,
        async (tmp) => {
          wasModified = record.descriptor.modified;
          await instance.call(
            'doc.store',
            { docId, url: toFileUrl(tmp), filter, ...(filterOptions ? { filterOptions } : {}), ...(password !== undefined ? { password } : {}), markSaved: true },
            { timeoutMs: timeoutFor(workingSize) },
          );
          flagCleared = true;
        },
        {
          verify: async (tmp) => {
            const size = (await statOrNull(tmp))?.size ?? 0;
            const reopen = deepVerify && size < REOPEN_VERIFY_LIMIT ? (p: string) => this.reopenCheck(p, kind) : undefined;
            await verifySavedFile(tmp, { format, encrypted: password !== undefined, ...(reopen ? { reopen } : {}) });
          },
        },
      );
    } catch (err) {
      if (flagCleared && wasModified) {
        await instance.call('doc.setModified', { docId, modified: true }).catch((e) => this.log.warn('doc.setModified failed after a failed save', { docId, error: e }));
      }
      throw err;
    }
    return choice;
  }

  /** Deep verification of an unencrypted file: the headless conversion instance must be able to load it. */
  private async reopenCheck(path: string, kind: OfficeKind): Promise<void> {
    await mkdir(this.deps.scratchDir, { recursive: true });
    const out = join(this.deps.scratchDir, `verify-${randomToken(6)}.pdf`);
    try {
      await this.deps.engine.convert({ input: toFileUrl(path), output: toFileUrl(out), filter: PDF_EXPORT_FILTER[kind] }, { timeoutMs: 180_000 });
      await verifyPdfFile(out);
    } finally {
      await removeQuietly(out);
    }
  }

  /** Whether the engine's document is modified (doc.info); undefined when the engine cannot tell. */
  private async engineModified(record: DocRecord, instance: EngineInstance): Promise<boolean | undefined> {
    const docId = record.descriptor.docId;
    try {
      const info = await instance.call('doc.info', { docId });
      return typeof info.modified === 'boolean' ? info.modified : undefined;
    } catch (err) {
      this.log.warn('doc.info failed after saving', { docId, error: err });
      return undefined;
    }
  }

  private async afterSave(record: DocRecord, instance: EngineInstance, path: string, format: FormatInfo, written: FilterChoice): Promise<void> {
    const docId = record.descriptor.docId;
    record.loadFilter = written.filter;
    record.filterFormat = format.id;
    // A crash before the next snapshot reloads this file: with the filter and options of what was written.
    record.loadParams = reloadParams(format, written, record.csvLocale ?? this.locale());
    record.diskStamp = stampOf(await statOrNull(path));
    // The engine cleared its flag together with the store; an edit made since then (e.g. while the file was
    // verified) set it again. Unknown (engine gone): keep the current state; closing then still asks.
    const modified = (await this.engineModified(record, instance)) ?? record.descriptor.modified;
    this.update(docId, { path, format: format.id, title: basename(path), modified, readOnly: false, recoveredAt: undefined });
    void this.deps.recent.add(path, record.descriptor.kind, format.id);
    this.hooks?.documentSaved(docId);
    // The report now describes the file on disk (e.g. macros are gone after DOCM → DOCX).
    void this.deps.compat
      .inspect(path)
      .then((r) => {
        if (this.records.get(docId) === record && r.report) this.update(docId, { compat: r.report });
      })
      .catch(() => undefined);
  }

  /** Removes temp/backup siblings of interrupted saves (older than 10 minutes) from a folder. */
  private async sweepStaleSiblings(dir: string): Promise<void> {
    try {
      const now = Date.now();
      for (const name of await readdir(dir)) {
        if (!STALE_SIBLING.test(name)) continue;
        const full = join(dir, name);
        const st = await statOrNull(full);
        if (st && now - st.mtimeMs > 10 * 60_000) await removeQuietly(full);
      }
    } catch {
      // folder not listable: the safe writer reports the real problem
    }
  }

  // ------------------------------------------------------------------------------ export / print

  async exportPdf(docId: string, options: PdfExportOptions = {}): Promise<SaveResult> {
    const record = this.records.get(docId);
    if (!record) return { outcome: 'failed', errorKey: 'errors.save.notFound' };
    const kind = record.descriptor.kind;
    if (!isOfficeKind(kind)) return { outcome: 'failed', errorKey: 'errors.export.notSupported' };
    const instance = record.instance;
    if (!instance || record.descriptor.state !== 'ready') return { outcome: 'failed', errorKey: 'errors.save.notReady' };
    this.setBusy(record, 'saving', true);
    try {
      // `options.path` is for callers inside the main process only (IPC rejects it); it gets `.pdf` like a dialog result.
      const chosen = options.path ? resolve(options.path) : await this.deps.dialogs.savePdf(this.win(), defaultPdfPath(record.descriptor, this.deps.defaultDir()));
      if (!chosen) return { outcome: 'cancelled' };
      const path = ensurePdfExtension(chosen);
      if (this.findByPath(path)) return { outcome: 'failed', errorKey: 'errors.save.targetOpen' };
      const filterData: Record<string, UnoArg> = {
        SelectPdfVersion: options.pdfA ? 2 : 0,
        UseTaggedPDF: options.taggedPdf ?? true,
        ExportBookmarks: options.bookmarks ?? true,
        IsAddStream: options.hybrid ?? false,
      };
      const size = (record.workingCopyPath ? (await statOrNull(record.workingCopyPath))?.size : 0) ?? 0;
      await this.sweepStaleSiblings(dirname(path));
      await this.deps.safeWrite(
        path,
        async (tmp) => {
          await instance.call('doc.store', { docId, url: toFileUrl(tmp), filter: PDF_EXPORT_FILTER[kind], filterData }, { timeoutMs: timeoutFor(size) });
        },
        { verify: verifyPdfFile },
      );
      this.log.info('pdf exported', { docId, pdfA: Boolean(options.pdfA), hybrid: Boolean(options.hybrid) });
      if (options.openAfter) {
        this.open(path).catch((err) => this.error(null, openErrorInfo(err).errorKey, basename(path)));
      }
      return { outcome: 'saved', path, format: 'pdf' };
    } catch (err) {
      const info = saveErrorInfo(err);
      this.log.warn('pdf export failed', { docId, errorKey: info.errorKey, error: err });
      return { outcome: 'failed', errorKey: info.errorKey === 'errors.save.failed' ? 'errors.export.failed' : info.errorKey, ...(info.detail ? { errorDetail: info.detail } : {}) };
    } finally {
      this.setBusy(record, 'saving', false);
    }
  }

  async print(docId: string): Promise<void> {
    const record = this.records.get(docId);
    if (!record) throw new DocumentError('errors.ipc.unknownDocument');
    if (!isOfficeKind(record.descriptor.kind)) {
      if (!this.pdf) throw new DocumentError('errors.print.failed');
      await this.pdf.print(docId, this.win());
      return;
    }
    if (!record.instance || record.descriptor.state !== 'ready') throw new DocumentError('errors.save.notReady');
    // .uno:Print is not intercepted: the engine shows its own print dialog (reported as a dialog event).
    await record.instance.call('cmd.dispatch', { docId, command: '.uno:Print' });
  }

  // ------------------------------------------------------------------------------ activate / close

  activate(docId: string): void {
    if (!this.records.has(docId)) return;
    this.activeId = docId;
    for (const r of this.records.values()) {
      if (r.descriptor.docId !== docId && r.hwnd) {
        r.viewVisible = false;
        try {
          this.deps.viewHost.setVisible(r.descriptor.docId, false);
        } catch {
          // view gone
        }
      }
    }
    this.emit({ type: 'activated', docId });
  }

  async close(docId: string, force = false): Promise<CloseOutcome> {
    const record = this.records.get(docId);
    if (!record) return 'closed';
    if (record.descriptor.state === 'loading') {
      // Cancels the load; the open flow cleans up and reports `closed`.
      record.closing = true;
      record.abort.abort();
      this.prompts.cancelFor(docId);
      return 'closed';
    }
    // PDF edits pdf.js has not pushed yet count before deciding whether to ask (flush protocol).
    if (!force && record.descriptor.kind === 'pdf') {
      await this.requestFlush(docId);
      if (this.records.get(docId) !== record || record.closing) return 'closed';
    }
    // A crashed or hung engine cannot save; its recovery snapshot is kept instead (see discard()). Say what is lost.
    const stuck = record.descriptor.state === 'crashed' || record.descriptor.state === 'busy';
    if (!force && record.descriptor.modified && stuck) {
      this.activate(docId);
      const snapshotAt = await this.lastSnapshotAt(docId);
      const answer = await this.ask({ kind: 'closeStuck', docId, fileName: record.descriptor.title, snapshotAt });
      if (answer.choice !== 'close') return 'cancelled';
    } else if (!force && record.descriptor.modified) {
      this.activate(docId);
      const answer = await this.ask({ kind: 'unsavedChanges', docId, fileName: record.descriptor.title });
      if (answer.choice === 'cancel') return 'cancelled';
      if (answer.choice === 'save') {
        const result = await this.save(docId);
        if (!isSaved(result)) {
          if (result.outcome === 'failed' && result.errorKey) this.error(docId, result.errorKey, result.errorDetail);
          return 'cancelled';
        }
      }
    }
    await this.discard(record);
    return 'closed';
  }

  /** Releases everything a document holds and reports `closed` (no prompts). */
  private async discard(record: DocRecord): Promise<void> {
    const docId = record.descriptor.docId;
    if (this.records.get(docId) !== record) return;
    const keepSnapshot = record.descriptor.modified && (record.descriptor.state === 'crashed' || record.descriptor.state === 'busy');
    record.closing = true;
    record.abort.abort();
    this.cancelRescue(record);
    // Closing the engine takes a moment; tell the renderer now so its pollers stop querying this document.
    this.update(docId, { state: 'closed' });
    this.records.delete(docId);
    this.prompts.cancelFor(docId);
    if (keepSnapshot) await this.hooks?.engineCrashed(docId).catch(() => null);
    this.dropInstanceSubs(record);
    const instance = record.instance;
    record.instance = undefined;
    // Never a PID of an instance that already ended (Windows may have reused it).
    const pid = instance ? this.killablePid(instance) : undefined;
    const killer = record.hung && pid ? this.deps.killProcessTree : undefined;
    if (killer && pid) {
      // A hung engine answers neither doc.close nor a graceful shutdown: end it at once, and before its view is
      // detached (hiding a hung window that has the keyboard focus makes Windows wait for it).
      await killer(pid).catch((err) => this.log.warn('killing the engine process failed', { docId, error: err }));
    }
    this.detachView(docId);
    if (instance) {
      if (!killer) await instance.call('doc.close', { docId }, { timeoutMs: 5_000 }).catch(() => undefined);
      await this.deps.engine.releaseDocumentInstance(docId).catch((err) => this.log.warn('engine release failed', { docId, error: err }));
    }
    await this.deps.workingCopies.remove(docId);
    this.hooks?.documentClosed(docId);
    if (this.activeId === docId) this.activeId = null;
    this.emit({ type: 'closed', docId });
  }

  /** Shutdown: releases every document without prompting (the quit flow asked already). */
  async closeAll(): Promise<void> {
    this.prompts.cancelAll();
    await Promise.all([...this.records.values()].map((r) => this.discard(r)));
  }

  /**
   * Native views the hang watch probes: every visible view of a loaded office document (the renderer's last
   * `view:setVisible`; the active document when it has not reported yet), plus views currently reported as
   * hung. Documents that are loading, saving or being snapshotted are left alone: those operations keep
   * LibreOffice's message loop busy on purpose and have their own timeouts.
   */
  hangTargets(): HangTarget[] {
    const out: HangTarget[] = [];
    for (const r of this.records.values()) {
      if (!r.hwnd || !r.instance || r.closing || r.restarting) continue;
      if (r.hung) {
        if (r.descriptor.state === 'busy') out.push({ docId: r.descriptor.docId, hwnd: r.hwnd });
        continue;
      }
      if (r.descriptor.state !== 'ready' || r.busy.has('saving') || r.busy.has('loading') || r.background > 0) continue;
      const visible = r.viewVisible ?? r.descriptor.docId === this.activeId;
      if (visible) out.push({ docId: r.descriptor.docId, hwnd: r.hwnd });
    }
    return out;
  }

  /**
   * Hang watchdog (docs/dev/platform.md §2.6): a document whose window stops responding becomes `busy` with
   * `errors.engine.notResponding` and `ready` again (`errors.engine.responding`) when it answers. Recovery
   * paths for the user: wait, close the document (`closeStuck` prompt; its recovery snapshot is kept and
   * listed), or `restartEngine` (documents:restartEngine, or the rescue offer in a window of its own when the
   * hang outlasts `rescueTiming.delayMs`: the Simpaper window itself may not get input meanwhile).
   */
  watchHangs(detector: HangDetector, timing: { intervalMs?: number; timeoutMs?: number; strikes?: number } = {}): HangWatch {
    return startHangWatch({
      ...timing,
      detector,
      targets: () => this.hangTargets(),
      onChange: (docId, responding) => {
        const r = this.records.get(docId);
        // A probe of a window whose engine is being restarted or closed can end either way (a killed window may
        // "answer"): only the current window of a running engine counts.
        if (!r || r.closing || r.restarting || !r.hwnd || !r.instance) return;
        if (!responding && !r.hung && r.descriptor.state === 'ready') {
          r.hung = true;
          this.log.warn('engine window not responding', { docId });
          this.update(docId, { state: 'busy' });
          this.error(docId, 'errors.engine.notResponding');
          this.scheduleRescue(r, this.deps.rescueTiming?.delayMs ?? RESCUE_DELAY_MS);
        } else if (responding && r.hung) {
          r.hung = false;
          this.cancelRescue(r);
          if (r.descriptor.state === 'busy') {
            this.update(docId, { state: 'ready' });
            this.notice(docId, 'errors.engine.responding');
          }
        }
      },
    });
  }

  /** Offers the engine rescue (deps.offerEngineRescue) if the document still hangs after `delayMs`. */
  private scheduleRescue(record: DocRecord, delayMs: number): void {
    if (!this.deps.offerEngineRescue || record.rescue) return;
    const rescue: NonNullable<DocRecord['rescue']> = { controller: new AbortController(), timer: null };
    rescue.timer = setTimeout(() => {
      rescue.timer = null;
      void this.offerRescue(record, rescue);
    }, delayMs);
    record.rescue = rescue;
  }

  /** Withdraws a pending or shown rescue offer (the engine answers again, is restarted, or the document closes). */
  private cancelRescue(record: DocRecord): void {
    const rescue = record.rescue;
    if (!rescue) return;
    record.rescue = undefined;
    if (rescue.timer) clearTimeout(rescue.timer);
    rescue.controller.abort();
  }

  private stillHung(record: DocRecord): boolean {
    return this.records.get(record.descriptor.docId) === record && record.hung && !record.closing && !record.restarting && record.descriptor.state === 'busy';
  }

  private async offerRescue(record: DocRecord, rescue: NonNullable<DocRecord['rescue']>): Promise<void> {
    const offer = this.deps.offerEngineRescue;
    if (!offer || record.rescue !== rescue || !this.stillHung(record)) return;
    const docId = record.descriptor.docId;
    const snapshotAt = record.descriptor.modified ? await this.lastSnapshotAt(docId) : null;
    const loss: EngineRescueOffer['loss'] = !record.descriptor.modified ? 'none' : snapshotAt ? 'sinceSnapshot' : record.descriptor.path ? 'sinceSave' : 'all';
    if (record.rescue !== rescue || rescue.controller.signal.aborted) return;
    this.log.warn('offering to restart the hung engine', { docId, loss });
    let answer: 'restart' | 'wait';
    try {
      answer = await offer({ docId, fileName: record.descriptor.title, loss, snapshotAt }, rescue.controller.signal);
    } catch (err) {
      this.log.warn('engine rescue offer failed', { docId, error: err });
      answer = 'wait';
    }
    if (record.rescue !== rescue || rescue.controller.signal.aborted) return;
    record.rescue = undefined;
    if (!this.stillHung(record)) return;
    if (answer === 'restart') {
      await this.restartEngine(docId).catch((err) => this.log.warn('engine restart from the rescue offer failed', { docId, error: err }));
    } else {
      this.scheduleRescue(record, this.deps.rescueTiming?.repeatMs ?? RESCUE_REPEAT_MS);
    }
  }

  /**
   * Recovery path for a document whose engine hangs (`busy`) or crashed without being restored: ends the
   * engine processes and reloads the document from its newest recovery snapshot, else from the last saved
   * file (same path as an automatic restart after a crash). Unsaved changes after the snapshot are lost,
   * which is why this only runs on the user's request.
   */
  async restartEngine(docId: string): Promise<void> {
    const record = this.records.get(docId);
    if (!record) throw new DocumentError('errors.ipc.unknownDocument');
    if (!isOfficeKind(record.descriptor.kind)) throw new DocumentError('errors.ipc.invalidRequest');
    const state = record.descriptor.state;
    if (record.closing || (state !== 'busy' && state !== 'crashed')) throw new DocumentError('errors.engine.restartNotNeeded');
    if (record.restarting) return;
    record.restarting = true;
    this.cancelRescue(record);
    try {
      this.log.warn('engine restart requested', { docId, state });
      // The user asked for it: the limit of automatic restarts does not apply.
      record.crashTimes = [];
      const instance = record.instance;
      if (instance) await this.stopInstance(record, instance);
      if (!this.records.has(docId) || record.closing) return;
      record.hung = false;
      this.update(docId, { state: 'crashed' });
      await this.restoreAfterCrash(record);
    } finally {
      record.restarting = false;
    }
    // The user restarted it to go on working: the restored document gets the keyboard back (the window that had it is
    // gone, and Windows gave the focus to the view container). LibreOffice ignores a focus request for a window that is
    // not shown yet, and the view host shows the new one a moment after the load; never while another app is in front.
    const refocus = setTimeout(() => {
      const win = this.deps.getWindow();
      if (this.activeId !== docId || this.records.get(docId) !== record || record.descriptor.state !== 'ready') return;
      if (win && this.deps.viewHost.isForeground?.(win) === false) return;
      this.focusView(docId);
    }, RESTART_FOCUS_DELAY_MS);
    refocus.unref?.();
  }

  /** Detaches a document from its engine instance and ends the instance (fast kill when possible). */
  private async stopInstance(record: DocRecord, instance: EngineInstance): Promise<void> {
    const docId = record.descriptor.docId;
    this.dropInstanceSubs(record);
    record.instance = undefined;
    record.hwnd = undefined;
    record.busy.delete('dialog');
    // Never a PID of an instance that already ended (Windows may have reused it). The kill comes before the view
    // is detached: hiding a hung window that has the keyboard focus makes Windows wait for it (WM_KILLFOCUS).
    const pid = this.killablePid(instance);
    if (pid && this.deps.killProcessTree) {
      await this.deps.killProcessTree(pid).catch((err) => this.log.warn('killing the engine process failed', { docId, error: err }));
    }
    this.detachView(docId);
    await this.deps.engine.releaseDocumentInstance(docId).catch((err) => this.log.warn('engine release failed', { docId, error: err }));
  }

  // ------------------------------------------------------------------------------ engine events

  private onEngineEvent(docId: string, instance: EngineInstance, e: EngineEvent): void {
    const record = this.records.get(docId);
    if (!record || record.instance !== instance) return;
    switch (e.type) {
      case 'state':
        this.emit({ type: 'state', docId, command: e.command, enabled: e.enabled, value: e.value });
        break;
      case 'modified':
        // While saving, `false` only means that the store cleared the flag (markSaved); the file may still fail
        // verification. afterSave takes the engine's real state once the user's file is replaced.
        if (!e.modified && record.busy.has('saving')) break;
        if (record.descriptor.modified !== e.modified) this.update(docId, { modified: e.modified });
        break;
      case 'context':
        this.emit({ type: 'context', docId, context: e.context });
        break;
      case 'dialog':
        if (e.open) record.busy.add('dialog');
        else record.busy.delete('dialog');
        this.emit({ type: 'busy', docId, busy: e.open, reason: 'dialog' });
        break;
      case 'key':
        this.emitShellKey(docId, e.key);
        break;
      case 'intercept':
        void handleIntercept(this.interceptTarget(), docId, e.command).catch((err) => {
          this.log.warn('intercepted command failed', { docId, command: e.command, error: err });
          this.error(docId, openErrorInfo(err).errorKey);
        });
        break;
      case 'closed':
        // The bridge intercepts every close command; a frame closing on its own is treated like a crash.
        if (!record.closing) void this.onEngineExit(docId, instance, { code: null, crashed: false });
        break;
      case 'log':
        (e.level === 'error' ? this.log.error : e.level === 'warn' ? this.log.warn : this.log.debug).call(this.log, `bridge: ${e.message}`, { docId });
        break;
      case 'selection':
        break;
    }
  }

  private interceptTarget() {
    return {
      kindOf: (docId: string) => this.records.get(docId)?.descriptor.kind,
      save: (docId: string, options?: SaveOptions) => this.save(docId, options),
      exportPdf: (docId: string) => this.exportPdf(docId),
      openDialog: (kind?: ModuleKind) => this.openDialog(kind),
      create: (kind: ModuleKind) => this.create(kind),
      close: (docId: string) => this.close(docId),
      modifiedDocIds: () => this.modifiedDocuments().map((d) => d.docId),
      quit: () => this.deps.requestQuit?.(),
      emit: (event: DocumentEvent) => this.emit(event),
    };
  }

  private async onEngineExit(docId: string, instance: EngineInstance, info: EngineExitInfo): Promise<void> {
    const record = this.records.get(docId);
    if (!record || record.instance !== instance || record.closing) return;
    // A load into this instance is running (engineLoad): it fails on its own and cleans up (open) or checks the
    // instance before the document becomes ready (restores). Any other exit, including one right after a load,
    // runs the crash path.
    if (record.engineLoads > 0) return;
    this.dropInstanceSubs(record);
    record.instance = undefined;
    record.hwnd = undefined;
    record.hung = false;
    this.cancelRescue(record);
    record.busy.delete('dialog');
    this.detachView(docId);
    this.log.error('engine instance ended unexpectedly', { docId, crashed: info.crashed, code: info.code });
    this.update(docId, { state: 'crashed' });
    this.error(docId, 'errors.engine.crashed');
    await this.deps.engine.releaseDocumentInstance(docId).catch(() => undefined);
    await this.restoreAfterCrash(record);
  }

  /** Reloads a crashed document into a new instance: newest snapshot, else the last saved file. */
  private async restoreAfterCrash(record: DocRecord): Promise<void> {
    const docId = record.descriptor.docId;
    const kind = record.descriptor.kind;
    if (!isOfficeKind(kind)) return;
    const now = Date.now();
    record.crashTimes = [...record.crashTimes.filter((t) => now - t < RESTART_WINDOW_MS), now];
    let snapshot: CrashSnapshot | null = null;
    try {
      snapshot = (await this.hooks?.engineCrashed(docId)) ?? null;
    } catch (err) {
      this.log.warn('crash snapshot lookup failed', { docId, error: err });
    }
    if (record.crashTimes.length > MAX_AUTO_RESTARTS) {
      this.error(docId, 'errors.engine.restartLimit');
      return;
    }
    const savedPath = record.descriptor.path && (await statOrNull(record.descriptor.path)) ? record.descriptor.path : null;
    if (!snapshot && !savedPath) {
      this.error(docId, 'errors.engine.restoreUnavailable');
      return;
    }
    const wasModified = record.descriptor.modified;
    const prevFilter = { loadFilter: record.loadFilter, filterFormat: record.filterFormat };
    this.setBusy(record, 'loading', true);
    this.update(docId, { state: 'loading' });
    let instance: EngineInstance | undefined;
    /** The new engine ended while the document was restored into it (its exit was left to this flow). */
    let ended = false;
    record.engineLoads++;
    try {
      await this.deps.workingCopies.remove(docId);
      const snapFormat = getFormat(SNAPSHOT_FILTER_FORMAT[kind]);
      const source = snapshot ? snapshot.path : (savedPath as string);
      record.workingCopyPath = await this.deps.workingCopies.create(docId, source, snapshot ? `recovered.${snapFormat.extensions[0]}` : basename(source));
      const size = (await statOrNull(record.workingCopyPath))?.size ?? 0;
      const loaded = await this.acquire(record);
      instance = loaded;
      const filter = snapshot ? snapFormat.exportFilter : record.loadParams.filter;
      const { result, view } = await this.loadWithPassword(
        record,
        loaded,
        {
          url: toFileUrl(record.workingCopyPath),
          ...(record.descriptor.path ? { baseUrl: toFileUrl(record.descriptor.path) } : {}),
          ...(filter ? { filter } : {}),
          ...(!snapshot && record.loadParams.filterOptions ? { filterOptions: record.loadParams.filterOptions } : {}),
        },
        size,
        snapshot ? snapshot.encrypted : record.encrypted,
        record.password,
      );
      this.applyLoadResult(record, result, view, snapshot ? snapFormat.id : record.descriptor.format ?? undefined);
      // An ODF snapshot has no VBA project for a DOCM/PPTM save; the saved file brings its own (if any).
      const format = record.descriptor.format ? getFormat(record.descriptor.format) : null;
      record.vbaPassthrough = !snapshot && format !== null && isVbaPassthroughFormat(format);
      // Keep the original file's filter so saving keeps its OOXML flavour.
      if (snapshot && prevFilter.filterFormat) {
        record.loadFilter = prevFilter.loadFilter;
        record.filterFormat = prevFilter.filterFormat;
      }
      if (snapshot) await this.markRestoredModified(docId, loaded);
      if (!this.engineAlive(record, loaded)) {
        ended = true;
      } else if (snapshot) {
        this.update(docId, { state: 'ready', modified: true, recoveredAt: snapshot.snapshotAt });
        this.notice(docId, 'errors.engine.restored', snapshot.snapshotAt);
      } else {
        this.update(docId, { state: 'ready', modified: false });
        this.notice(docId, wasModified ? 'errors.engine.restoredFromSaved' : 'errors.engine.restarted');
      }
      if (!ended) {
        this.hooks?.crashRecovered(docId);
        this.log.info('document restored after engine crash', { docId, fromSnapshot: Boolean(snapshot) });
      }
    } catch (err) {
      if (!this.records.has(docId)) return;
      if (record.closing) {
        // Closed while restoring: release what the restore acquired.
        await this.discard(record);
        return;
      }
      if (instance && record.instance === instance && !this.engineAlive(record, instance)) {
        ended = true;
      } else {
        this.log.error('restoring after crash failed', { docId, error: err });
        this.update(docId, { state: 'crashed' });
        this.error(docId, 'errors.engine.restoreFailed');
      }
    } finally {
      record.engineLoads--;
      this.setBusy(record, 'loading', false);
    }
    // The new engine is gone as well: the crash path again (restart limit included), never `ready` on a dead engine.
    if (ended && instance) await this.onEngineExit(docId, instance, { code: null, crashed: true });
  }
}
