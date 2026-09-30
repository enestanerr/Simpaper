/** Fakes for the engine, view host and dialogs used by the main-process tests. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { BrowserWindow } from 'electron';
import JSZip from 'jszip';
import type { CssRect } from '@shared/api/engine';
import { RPC_ERROR, type DocLoadResult, type EngineEvent, type EngineMethod, type EngineMethods, type ViewMode, type ViewParams } from '@shared/engine-protocol';
import type { FormatId } from '@shared/formats';
import type { ModuleKind, OfficeKind } from '@shared/modules';
import type { DocumentDialogs } from '../../../../src/main/documents/ports';
import type { EngineCallOptions, EngineExitInfo, EngineInstance, EngineInstanceInfo, EngineManager, EngineProbe } from '../../../../src/main/engine/types';
import type { Logger } from '../../../../src/main/log';
import type { ViewHost } from '../../../../src/main/platform/types';
import { buildCfb, tinyPdf } from './packages';

export const silentLog: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
};

export function rpcError(code: number, message = 'rpc error'): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

export interface CallRecord {
  method: EngineMethod;
  params: Record<string, unknown>;
}

/** What the fake bridge does; tests override single methods. */
export interface FakeBehavior {
  /** Password the fake requires for doc.load (undefined = none). */
  password?: string;
  loadFilter?: string;
  hasMacros?: boolean;
  /** Fail doc.store with this error. */
  storeError?: Error;
}

async function writeByFilter(path: string, filter: string, kind: OfficeKind, encrypted = false): Promise<void> {
  if (/pdf_Export/.test(filter)) {
    await writeFile(path, tinyPdf());
    return;
  }
  if (filter === 'writer8' || filter === 'calc8' || filter === 'impress8') {
    const mime = { writer8: 'text', calc8: 'spreadsheet', impress8: 'presentation' }[filter];
    const zip = new JSZip();
    zip.file('mimetype', `application/vnd.oasis.opendocument.${mime}`, { compression: 'STORE' });
    zip.file('content.xml', '<office:document-content/>');
    zip.file('META-INF/manifest.xml', '<manifest:manifest/>');
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));
    return;
  }
  if (/Text|csv/.test(filter)) {
    await writeFile(path, 'a;b\n1;2\n', 'utf8');
    return;
  }
  if (encrypted) {
    // Password-protected OOXML: an agile-encrypted compound file (EncryptionInfo + EncryptedPackage).
    await writeFile(path, buildCfb([
      { name: 'EncryptionInfo', type: 'stream', data: Buffer.alloc(64, 1) },
      { name: 'EncryptedPackage', type: 'stream', data: Buffer.alloc(256, 7) },
    ]));
    return;
  }
  const main = kind === 'writer' ? 'word/document.xml' : kind === 'calc' ? 'xl/workbook.xml' : 'ppt/presentation.xml';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<Types><Override PartName="/${main}"/></Types>`);
  zip.file(main, '<root/>');
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));
}

export class FakeInstance implements EngineInstance {
  readonly role = 'document' as const;
  readonly calls: CallRecord[] = [];
  private readonly events = new Set<(e: EngineEvent) => void>();
  private readonly exits = new Set<(i: EngineExitInfo) => void>();
  kind: OfficeKind = 'writer';
  disposed = false;
  /** crash() was called: info().state is `crashed` and calls fail with ENGINE_UNAVAILABLE (like OfficeInstance). */
  crashed = false;
  /** soffice.bin of this fake (EngineInstanceInfo.officePid). */
  officePid = 0;
  /**
   * LibreOffice's modified flag of the document: set by `modified` events (edits) and doc.setModified, cleared by a
   * doc.store with `markSaved` (which also reports the transition like the bridge); doc.info returns it.
   */
  modifiedFlag = false;

  constructor(
    readonly id: string,
    private readonly behavior: FakeBehavior,
    readonly overrides: Partial<Record<EngineMethod, (params: Record<string, unknown>) => unknown>> = {},
  ) {}

  async call<M extends EngineMethod>(method: M, params: EngineMethods[M]['params'], _opts?: EngineCallOptions): Promise<EngineMethods[M]['result']> {
    const p = params as unknown as Record<string, unknown>;
    this.calls.push({ method, params: p });
    if (this.crashed) throw rpcError(RPC_ERROR.ENGINE_UNAVAILABLE, 'engine unavailable');
    const override = this.overrides[method];
    if (override) return (await override(p)) as EngineMethods[M]['result'];
    switch (method) {
      case 'doc.load': {
        const pw = this.behavior.password;
        if (pw !== undefined && p['password'] !== pw) throw rpcError(p['password'] === undefined ? RPC_ERROR.PASSWORD_REQUIRED : RPC_ERROR.WRONG_PASSWORD);
        const res: DocLoadResult = {
          docId: String(p['docId']),
          kind: this.kind,
          title: 'x',
          filterName: (p['filter'] as string | undefined) ?? this.behavior.loadFilter ?? 'MS Word 2007 XML',
          readOnly: false,
          hwnd: '4242',
          hasMacros: this.behavior.hasMacros ?? false,
        };
        return res as EngineMethods[M]['result'];
      }
      case 'doc.new': {
        this.kind = p['kind'] as OfficeKind;
        const res: DocLoadResult = { docId: String(p['docId']), kind: this.kind, title: 'Untitled 1', filterName: '', readOnly: false, hwnd: '4243', hasMacros: false };
        return res as EngineMethods[M]['result'];
      }
      case 'doc.store': {
        if (this.behavior.storeError) throw this.behavior.storeError;
        await writeByFilter(fileURLToPath(String(p['url'])), String(p['filter']), this.kind, typeof p['password'] === 'string');
        if (p['markSaved'] === true && this.modifiedFlag) {
          this.modifiedFlag = false;
          this.emit({ type: 'modified', docId: String(p['docId']), modified: false });
        }
        return { ok: true } as EngineMethods[M]['result'];
      }
      case 'doc.setModified': {
        // The bridge reports transitions of the flag as `modified` events.
        const next = p['modified'] === true;
        if (next !== this.modifiedFlag) this.emit({ type: 'modified', docId: String(p['docId']), modified: next });
        return { ok: true } as EngineMethods[M]['result'];
      }
      case 'doc.info':
        return { docId: String(p['docId']), modified: this.modifiedFlag, title: 'x' } as EngineMethods[M]['result'];
      case 'cmd.subscribe':
        return { states: [] } as unknown as EngineMethods[M]['result'];
      default:
        return { ok: true } as EngineMethods[M]['result'];
    }
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.events.add(listener);
    return () => this.events.delete(listener);
  }

  onExit(listener: (info: EngineExitInfo) => void): () => void {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }

  emit(event: EngineEvent): void {
    if (event.type === 'modified') this.modifiedFlag = event.modified;
    for (const l of [...this.events]) l(event);
  }

  crash(): void {
    this.crashed = true;
    for (const l of [...this.exits]) l({ code: 3221225477, crashed: true });
  }

  callsOf(method: EngineMethod): CallRecord[] {
    return this.calls.filter((c) => c.method === method);
  }

  info(): EngineInstanceInfo {
    const state = this.crashed ? 'crashed' : this.disposed ? 'stopped' : 'ready';
    return { id: this.id, role: 'document', state, profileDir: 'x', ...(this.officePid ? { officePid: this.officePid } : {}) };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

export class FakeEngineManager implements EngineManager {
  readonly behavior: FakeBehavior = {};
  readonly instances = new Map<string, FakeInstance>();
  readonly history: FakeInstance[] = [];
  readonly released: string[] = [];
  readonly conversions: Record<string, unknown>[] = [];
  /** Kind reported for the next doc.load (set by tests). */
  nextKind: OfficeKind = 'writer';
  overrides: Partial<Record<EngineMethod, (params: Record<string, unknown>) => unknown>> = {};
  convertError?: Error;

  async probe(): Promise<EngineProbe> {
    return { available: true, programDir: null, officeVersion: '26.8.0.3' };
  }

  async acquireDocumentInstance(docId: string): Promise<EngineInstance> {
    const inst = new FakeInstance(`i${this.history.length + 1}`, this.behavior, this.overrides);
    inst.kind = this.nextKind;
    inst.officePid = 5000 + this.history.length;
    this.instances.set(docId, inst);
    this.history.push(inst);
    return inst;
  }

  getDocumentInstance(docId: string): EngineInstance | undefined {
    return this.instances.get(docId);
  }

  instance(docId: string): FakeInstance {
    const i = this.instances.get(docId);
    if (!i) throw new Error(`no instance for ${docId}`);
    return i;
  }

  async releaseDocumentInstance(docId: string): Promise<void> {
    this.released.push(docId);
    const i = this.instances.get(docId);
    if (i) await i.dispose();
    this.instances.delete(docId);
  }

  async convert(params: EngineMethods['convert.file']['params']): Promise<void> {
    this.conversions.push(params as unknown as Record<string, unknown>);
    if (this.convertError) throw this.convertError;
    // The input must at least exist and be readable.
    await readFile(fileURLToPath(params.input));
    await writeFile(fileURLToPath(params.output), tinyPdf());
  }

  updateProfileOptions(): void {}

  async dispose(): Promise<void> {}
}

export class FakeViewHost implements ViewHost {
  readonly supported = true;
  readonly log: string[] = [];

  viewParamsFor(_win: BrowserWindow, mode: ViewMode, cssRect?: CssRect): ViewParams {
    this.log.push(`params:${mode}`);
    return { mode, parentHwnd: '100', ...(cssRect ? { bounds: { x: cssRect.x, y: cssRect.y, width: cssRect.width, height: cssRect.height } } : {}) };
  }
  attach(docId: string, _win: BrowserWindow, hwnd: string): void {
    this.log.push(`attach:${docId}:${hwnd}`);
  }
  setBounds(docId: string): void {
    this.log.push(`bounds:${docId}`);
  }
  setVisible(docId: string, visible: boolean): void {
    this.log.push(`visible:${docId}:${visible}`);
  }
  focus(docId: string): void {
    this.log.push(`focus:${docId}`);
  }
  async freeze(docId: string): Promise<string | null> {
    this.log.push(`freeze:${docId}`);
    return 'data:image/png;base64,AAAA';
  }
  unfreeze(docId: string): void {
    this.log.push(`unfreeze:${docId}`);
  }
  /** A test sets it to hold whenShown (a freeze-frame that has not ended yet). */
  shownGate: Promise<void> | null = null;
  whenShown(docId: string): Promise<void> {
    this.log.push(`whenShown:${docId}`);
    return this.shownGate ?? Promise.resolve();
  }
  detach(docId: string): void {
    this.log.push(`detach:${docId}`);
  }
  syncAll(): void {}
  dispose(): void {}
}

/** Dialogs that answer from queues (null = cancelled). */
export class FakeDialogs implements DocumentDialogs {
  readonly saveRequests: Array<{ defaultPath: string; kind: OfficeKind; format: FormatId }> = [];
  readonly pdfRequests: string[] = [];
  saveAnswers: Array<string | null> = [];
  openAnswers: string[][] = [];
  pdfAnswers: Array<string | null> = [];

  async openDocuments(_win: BrowserWindow | null, _kind?: ModuleKind): Promise<string[]> {
    return this.openAnswers.shift() ?? [];
  }
  async saveDocument(_win: BrowserWindow | null, opts: { defaultPath: string; kind: OfficeKind; format: FormatId }): Promise<string | null> {
    this.saveRequests.push(opts);
    return this.saveAnswers.length ? (this.saveAnswers.shift() ?? null) : null;
  }
  async savePdf(_win: BrowserWindow | null, defaultPath: string): Promise<string | null> {
    this.pdfRequests.push(defaultPath);
    return this.pdfAnswers.shift() ?? null;
  }
}

/** A stand-in for the Electron window (only isDestroyed() is used by the services under test). */
export const fakeWindow = { isDestroyed: () => false } as unknown as BrowserWindow;
