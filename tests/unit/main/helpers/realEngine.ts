/**
 * Real-engine harness for the main-process core (Vitest project "engine", tests/engine/documents-*.test.ts):
 * DocumentService + RecoveryService + SafeWriter + CompatAnalyzer on top of the real EngineManager.
 *
 * No window is ever shown: every engine instance runs `--headless`, the view mode is overridden to `hidden`
 * (as SIMPAPER_VIEW_MODE=hidden does in the app) and the view host is a stub that fails the test if a native
 * view is attached. Each harness has its own folder and engine profiles under test-output/main-core/engine/,
 * and `dispose()` ends every process it started (the tree of each soffice/bridge process whose command line
 * contains the harness folder).
 */
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '@shared/api/app';
import type { DocumentEvent, Prompt, PromptAnswer } from '@shared/api/documents';
import type { FormatId } from '@shared/formats';
import type { ModuleKind, OfficeKind } from '@shared/modules';
import { createCompatAnalyzer } from '../../../../src/main/compat/analyzer';
import { createFontCatalog } from '../../../../src/main/compat/fonts';
import type { DocumentDialogs } from '../../../../src/main/documents/ports';
import { RecentFilesStore } from '../../../../src/main/documents/recentFiles';
import { DocumentService } from '../../../../src/main/documents/service';
import { createEngineManager } from '../../../../src/main/engine';
import { createTaskkillProcessGuard } from '../../../../src/main/engine/fallbackGuard';
import { locateEngine } from '../../../../src/main/engine/locate';
import type { EngineInstance, EngineManager } from '../../../../src/main/engine/types';
import { randomToken } from '../../../../src/main/files/fsUtil';
import { createSafeWriter } from '../../../../src/main/files/safeWrite';
import { WorkingCopyStore } from '../../../../src/main/files/workingCopies';
import { createLogger, setLogSink, type LogLevel } from '../../../../src/main/log';
import type { ViewHost } from '../../../../src/main/platform/types';
import { RecoveryService } from '../../../../src/main/recovery/service';

export const located = locateEngine();
export const engineAvailable = located.ok;
if (!located.ok) {
  console.warn(`Main-core engine tests skipped: ${located.error}. Run "npm run engine:fetch" or set SIMPAPER_ENGINE_DIR.`);
}

export const ROOT = resolve('test-output', 'main-core', 'engine');
export const CORPUS = resolve('tests', 'corpus', 'generated');

// Warnings and errors of the services are useful when a test fails; everything with SIMPAPER_TEST_VERBOSE=1.
const verbose = Boolean(process.env['SIMPAPER_TEST_VERBOSE']);
function metaText(meta: Record<string, unknown> | undefined): string {
  if (!meta) return '';
  try {
    return JSON.stringify(meta, (_k, v: unknown) => (v instanceof Error ? { name: v.name, message: v.message, code: (v as { code?: unknown }).code } : v)).slice(0, 400);
  } catch {
    return '';
  }
}
setLogSink((level: LogLevel, scope, message, meta) => {
  if (verbose || level === 'warn' || level === 'error') console.log(`[${level}] ${scope}: ${message} ${metaText(meta)}`);
});

export type Answerer = (prompt: Prompt) => PromptAnswer | undefined;

/** Native dialogs of a user who accepts every suggested path (or answers from the queues). */
export class ScriptedDialogs implements DocumentDialogs {
  readonly saveRequests: Array<{ defaultPath: string; kind: OfficeKind; format: FormatId }> = [];
  readonly pdfRequests: string[] = [];
  saveAnswers: Array<string | null> = [];

  async openDocuments(_win: unknown, _kind?: ModuleKind): Promise<string[]> {
    return [];
  }
  async saveDocument(_win: unknown, opts: { defaultPath: string; kind: OfficeKind; format: FormatId }): Promise<string | null> {
    this.saveRequests.push(opts);
    return this.saveAnswers.length ? (this.saveAnswers.shift() ?? null) : opts.defaultPath;
  }
  async savePdf(_win: unknown, defaultPath: string): Promise<string | null> {
    this.pdfRequests.push(defaultPath);
    return defaultPath;
  }
}

/** View host stub: documents must never get a native view in these tests. */
export class NoViewHost implements ViewHost {
  readonly supported = false;
  readonly attached: string[] = [];
  viewParamsFor(): never {
    throw new Error('viewParamsFor must not be called: views are hidden');
  }
  attach(docId: string): void {
    this.attached.push(docId);
  }
  setBounds(): void {}
  setVisible(): void {}
  focus(): void {}
  async freeze(): Promise<string | null> {
    return null;
  }
  unfreeze(): void {}
  detach(): void {}
  syncAll(): void {}
  dispose(): void {}
}

export interface RealHarness {
  dir: string;
  docsDir: string;
  engine: EngineManager;
  service: DocumentService;
  recovery: RecoveryService;
  dialogs: ScriptedDialogs;
  views: NoViewHost;
  settings: Settings;
  events: DocumentEvent[];
  prompts: Prompt[];
  answer(fn: Answerer): void;
  eventsOf<T extends DocumentEvent['type']>(type: T): Extract<DocumentEvent, { type: T }>[];
  instance(docId: string): EngineInstance;
  /** A second DocumentService + RecoveryService (a later app session) on the same engine and folders. */
  nextSession(sessionId: string): Promise<{ service: DocumentService; recovery: RecoveryService; events: DocumentEvent[]; prompts: Prompt[]; answer(fn: Answerer): void }>;
  /** Closes everything, disposes the engine and kills leftovers; resolves with the processes that had to be killed. */
  dispose(): Promise<LeftoverProcess[]>;
}

interface SessionParts {
  service: DocumentService;
  recovery: RecoveryService;
  events: DocumentEvent[];
  prompts: Prompt[];
  answer(fn: Answerer): void;
}

/** Copies a corpus file (tests/corpus/generated) into `dir`; null when the corpus was not generated. */
export function copyCorpus(name: string, dir: string, as = name.split('/').pop() ?? name): string | null {
  const src = join(CORPUS, name);
  if (!existsSync(src)) return null;
  const target = join(dir, as);
  copyFileSync(src, target);
  return target;
}

export interface LeftoverProcess {
  pid: number;
  name: string;
}

/** Processes whose command line contains `token` (Windows; empty elsewhere). */
export function processesMatching(token: string): Promise<LeftoverProcess[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const escaped = token.replace(/'/g, "''");
  // `$PID`: the PowerShell process running this query has the token in its own command line.
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('${escaped}') } | ForEach-Object { "$($_.ProcessId)|$($_.Name)" }`;
  return new Promise((resolvePids) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 60_000 }, (error, stdout) => {
      if (error) return resolvePids([]);
      const out: LeftoverProcess[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        const [pid, name] = line.trim().split('|');
        const n = Number(pid);
        if (Number.isInteger(n) && n > 0 && n !== process.pid) out.push({ pid: n, name: name ?? '' });
      }
      resolvePids(out);
    });
  });
}

export function killTree(pid: number): Promise<void> {
  return createTaskkillProcessGuard().killTree(pid);
}

function makeSession(opts: {
  sessionId: string;
  dir: string;
  docsDir: string;
  engine: EngineManager;
  settings: Settings;
  dialogs: ScriptedDialogs;
  views: NoViewHost;
  recoveryRoot: string;
}): SessionParts {
  const log = createLogger(`mc-${opts.sessionId}`);
  const events: DocumentEvent[] = [];
  const prompts: Prompt[] = [];
  let answerer: Answerer = () => undefined;
  const safeWrite = createSafeWriter({ log: log.child('safeWrite') });
  let svc: DocumentService | null = null;
  svc = new DocumentService({
    engine: opts.engine,
    viewHost: opts.views,
    compat: createCompatAnalyzer({ fonts: createFontCatalog(), log: log.child('compat') }),
    safeWrite,
    workingCopies: new WorkingCopyStore(join(opts.dir, 'work'), opts.sessionId, log.child('work')),
    recent: new RecentFilesStore({ file: join(opts.dir, `recent-${opts.sessionId}.json`), safeWrite, limit: () => 20 }),
    dialogs: opts.dialogs,
    settings: () => opts.settings,
    getWindow: () => null,
    send: (e) => {
      events.push(e);
      if (e.type === 'prompt') {
        prompts.push(e.prompt);
        const p = e.prompt;
        queueMicrotask(() => {
          const a = answerer(p);
          if (a) svc?.answerPrompt(p.id, a);
        });
      }
    },
    log: log.child('documents'),
    scratchDir: join(opts.dir, 'scratch'),
    defaultDir: () => opts.docsDir,
    viewMode: () => 'hidden',
    killProcessTree: killTree,
  });
  const service = svc;
  const recovery = new RecoveryService({ root: opts.recoveryRoot, sessionId: opts.sessionId, documents: service, safeWrite, settings: () => opts.settings, log: log.child('recovery') });
  service.setLifecycleHooks(recovery);
  return {
    service,
    recovery,
    events,
    prompts,
    answer(fn) {
      answerer = fn;
    },
  };
}

export async function createRealHarness(name: string, overrides: Partial<Settings> = {}): Promise<RealHarness> {
  // Folders of earlier runs of this suite (kept for inspection until now).
  if (existsSync(ROOT)) for (const old of readdirSync(ROOT)) if (old.startsWith(`${name}-`)) rmSync(join(ROOT, old), { recursive: true, force: true });
  // A unique folder name: the leftover-process check matches it in command lines.
  const dir = join(ROOT, `${name}-${randomToken(3)}`);
  const docsDir = join(dir, 'user');
  mkdirSync(docsDir, { recursive: true });
  const settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), verifyAfterSave: true, autosaveMinutes: 0, ...overrides };
  const engine = createEngineManager(
    {
      profilesRoot: join(dir, 'profiles'),
      uiLanguage: 'tr',
      documentLocale: 'tr-TR',
      appearance: 'light',
      headless: true,
      warmSpare: false,
      startTimeoutMs: 180_000,
    },
    { processGuard: createTaskkillProcessGuard(), log: createLogger(`mc-${name}/engine`) },
  );
  const dialogs = new ScriptedDialogs();
  const views = new NoViewHost();
  const recoveryRoot = join(dir, 'recovery');
  const sessions: SessionParts[] = [];
  const first = makeSession({ sessionId: 'sessA', dir, docsDir, engine, settings, dialogs, views, recoveryRoot });
  sessions.push(first);
  await first.recovery.start();

  return {
    dir,
    docsDir,
    engine,
    service: first.service,
    recovery: first.recovery,
    dialogs,
    views,
    settings,
    events: first.events,
    prompts: first.prompts,
    answer: (fn) => first.answer(fn),
    eventsOf(type) {
      return first.events.filter((e) => e.type === type) as never;
    },
    instance(docId) {
      const inst = first.service.instanceOf(docId) ?? sessions.map((s) => s.service.instanceOf(docId)).find(Boolean);
      if (!inst) throw new Error(`no engine instance for ${docId}`);
      return inst;
    },
    async nextSession(sessionId) {
      const s = makeSession({ sessionId, dir, docsDir, engine, settings, dialogs, views, recoveryRoot });
      sessions.push(s);
      await s.recovery.start();
      return s;
    },
    async dispose() {
      for (const s of sessions) {
        s.recovery.stop();
        await s.service.closeAll().catch(() => undefined);
      }
      await engine.dispose().catch(() => undefined);
      // Give exiting processes a moment, then end anything that is still there.
      await new Promise((r) => setTimeout(r, 1_000));
      const token = dir.slice(ROOT.length + 1);
      const left = await processesMatching(token);
      for (const p of left) await killTree(p.pid);
      if (left.length) console.log(`[harness] processes outlived the engine manager and were killed: ${left.map((p) => `${p.pid} ${p.name}`).join(', ')}`);
      return left;
    },
  };
}

/** Polls `predicate` until it holds (or throws after `timeoutMs`). */
export async function until(predicate: () => boolean, timeoutMs = 60_000, what = 'condition'): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
