/** Wires a real DocumentService (+ optional RecoveryService) to fakes of the engine, view host and dialogs. */
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '@shared/api/app';
import type { DocumentEvent, Prompt, PromptAnswer } from '@shared/api/documents';
import { createCompatAnalyzer } from '../../../../src/main/compat/analyzer';
import { createFontCatalog } from '../../../../src/main/compat/fonts';
import { RecentFilesStore } from '../../../../src/main/documents/recentFiles';
import { DocumentService, type DocumentServiceDeps } from '../../../../src/main/documents/service';
import { createSafeWriter } from '../../../../src/main/files/safeWrite';
import { WorkingCopyStore } from '../../../../src/main/files/workingCopies';
import { RecoveryService } from '../../../../src/main/recovery/service';
import { FakeDialogs, FakeEngineManager, FakeViewHost, fakeWindow, silentLog } from './fakes';
import { makeTempDir, removeDir } from './tmp';

export type Answerer = (prompt: Prompt) => PromptAnswer | undefined;
/** The renderer's side of the PDF flush protocol: push pending edits, then call `done` (documents:flushDone). */
export type FlushResponder = (request: Extract<DocumentEvent, { type: 'flushRequest' }>, done: () => void) => void;

export interface Harness {
  dir: string;
  docsDir: string;
  engine: FakeEngineManager;
  view: FakeViewHost;
  dialogs: FakeDialogs;
  events: DocumentEvent[];
  prompts: Prompt[];
  settings: Settings;
  service: DocumentService;
  recovery: RecoveryService;
  recent: RecentFilesStore;
  /** Replaces the automatic prompt answerer. */
  answer(fn: Answerer): void;
  /** Replaces the renderer's flush responder (default: confirms every flushRequest at once). */
  onFlush(fn: FlushResponder): void;
  /** Stops timers, closes documents, waits for background writes and removes the folder. */
  dispose(): Promise<void>;
  eventsOf<T extends DocumentEvent['type']>(type: T): Extract<DocumentEvent, { type: T }>[];
}

/** `serviceDeps`: extra DocumentService dependencies (view-mode override, process killer ...). */
export async function createHarness(overrides: Partial<Settings> = {}, serviceDeps: Partial<DocumentServiceDeps> = {}): Promise<Harness> {
  const dir = await makeTempDir('docs');
  const docsDir = join(dir, 'user');
  const settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), verifyAfterSave: false, ...overrides };
  const engine = new FakeEngineManager();
  const view = new FakeViewHost();
  const dialogs = new FakeDialogs();
  const events: DocumentEvent[] = [];
  const prompts: Prompt[] = [];
  let answerer: Answerer = () => undefined;
  let flushResponder: FlushResponder = (_request, done) => queueMicrotask(done);
  const safeWrite = createSafeWriter({ log: silentLog, retry: { attempts: 2, baseDelayMs: 1 } });
  const recent = new RecentFilesStore({ file: join(dir, 'recent.json'), safeWrite, limit: () => settings.recentLimit });
  let service: DocumentService | null = null;
  service = new DocumentService({
    engine,
    viewHost: view,
    compat: createCompatAnalyzer({ fonts: createFontCatalog({ installed: ['Calibri', 'Arial', 'Times New Roman', 'Cambria', 'Carlito'] }) }),
    safeWrite,
    workingCopies: new WorkingCopyStore(join(dir, 'work'), 'sess01', silentLog),
    recent,
    dialogs,
    settings: () => settings,
    getWindow: () => fakeWindow,
    send: (e) => {
      events.push(e);
      if (e.type === 'prompt') {
        prompts.push(e.prompt);
        const p = e.prompt;
        queueMicrotask(() => {
          const a = answerer(p);
          if (a) service?.answerPrompt(p.id, a);
        });
      }
      if (e.type === 'flushRequest') {
        const request = e;
        flushResponder(request, () => service?.flushDone(request.requestId));
      }
    },
    log: silentLog,
    scratchDir: join(dir, 'scratch'),
    defaultDir: () => docsDir,
    ...serviceDeps,
  });
  const recovery = new RecoveryService({ root: join(dir, 'recovery'), sessionId: 'sess01', documents: service, safeWrite, settings: () => settings, log: silentLog });
  service.setLifecycleHooks(recovery);
  return {
    dir,
    docsDir,
    engine,
    view,
    dialogs,
    events,
    prompts,
    settings,
    service,
    recovery,
    recent,
    answer(fn) {
      answerer = fn;
    },
    onFlush(fn) {
      flushResponder = fn;
    },
    async dispose() {
      recovery.stop();
      await service.closeAll();
      await new Promise((r) => setTimeout(r, 20));
      await recent.flush();
      await removeDir(dir);
    },
    eventsOf(type) {
      return events.filter((e) => e.type === type) as never;
    },
  };
}

/** Like waitFor, for asynchronous predicates (file-system state). */
export async function waitForAsync(predicate: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error('waitForAsync timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Resolves when `predicate` holds (polling microtasks/timers), or throws after `timeoutMs`. */
export async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
