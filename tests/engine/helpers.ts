/**
 * Shared set-up for the headless engine tests (Vitest project "engine").
 * The tests need the LibreOffice development image (vendor/libreoffice) or SIMPAPER_ENGINE_DIR;
 * without it every suite is skipped with a message. No window is ever shown: all instances run
 * with --headless and documents use `hidden` views.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EngineEvent } from '@shared/engine-protocol';
import { createLogger, setLogSink, type LogLevel } from '../../src/main/log';
import { createEngineManager } from '../../src/main/engine';
import { createTaskkillProcessGuard } from '../../src/main/engine/fallbackGuard';
import { locateEngine } from '../../src/main/engine/locate';
import type { EngineInstance, EngineManager, EngineManagerOptions } from '../../src/main/engine/types';

export const located = locateEngine();
export const engineAvailable = located.ok;
export const skipMessage = located.ok
  ? ''
  : `Engine tests skipped: ${located.error}. Run "npm run engine:fetch" or set SIMPAPER_ENGINE_DIR to a LibreOffice program directory.`;
if (!engineAvailable) console.warn(skipMessage);

export const OUT = resolve('test-output', 'engine');
export const PROFILES = join(OUT, 'profiles');

// Engine logs are useful when a test fails; keep warnings/errors, everything with SIMPAPER_TEST_VERBOSE=1.
const verbose = Boolean(process.env['SIMPAPER_TEST_VERBOSE']);
setLogSink((level: LogLevel, scope, message, meta) => {
  if (verbose || level === 'warn' || level === 'error') console.log(`[${level}] ${scope}: ${message}`, meta ? JSON.stringify(meta) : '');
});
export const log = createLogger('test');

export function outDir(name: string): string {
  const dir = join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function fileUrl(path: string): string {
  return pathToFileURL(path).href;
}

/** A headless manager with its own profile root (managers that run at the same time need distinct roots). */
export function makeManager(profileRoot: string, opts: Partial<EngineManagerOptions> = {}): EngineManager {
  return createEngineManager(
    {
      profilesRoot: join(PROFILES, profileRoot),
      uiLanguage: 'tr',
      documentLocale: 'tr-TR',
      appearance: 'light',
      headless: true,
      warmSpare: false,
      startTimeoutMs: 180_000,
      ...opts,
    },
    { processGuard: createTaskkillProcessGuard(), log: log.child(profileRoot) },
  );
}

/** Collects events of an instance; `waitFor` resolves with the first matching event. */
export class EventLog {
  readonly events: EngineEvent[] = [];
  private readonly waiters: Array<{ match: (e: EngineEvent) => boolean; resolve: (e: EngineEvent) => void }> = [];

  constructor(instance: EngineInstance) {
    instance.onEvent((event) => {
      this.events.push(event);
      for (const waiter of [...this.waiters]) {
        if (waiter.match(event)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(event);
        }
      }
    });
  }

  waitFor(match: (e: EngineEvent) => boolean, timeoutMs = 10_000): Promise<EngineEvent> {
    const found = this.events.find(match);
    if (found) return Promise.resolve(found);
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('event not received in time')), timeoutMs);
      this.waiters.push({
        match,
        resolve: (event) => {
          clearTimeout(timer);
          resolvePromise(event);
        },
      });
    });
  }

  clear(): void {
    this.events.length = 0;
  }
}

/** Measures an async step and records it for the timing report printed by each suite. */
export const timings: Array<{ step: string; ms: number }> = [];
export async function timed<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    timings.push({ step, ms: Math.round(performance.now() - started) });
  }
}

export function printTimings(title: string): void {
  if (!timings.length) return;
  console.log(`\n${title}\n${timings.map((t) => `  ${t.step.padEnd(48)} ${String(t.ms).padStart(7)} ms`).join('\n')}`);
  timings.length = 0;
}

/** The text of every page of a PDF (pdf.js legacy build, as used in Node). */
export async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/**
 * Crash dumps LibreOffice's crash handler wrote into a profile slot (<slot>/crash/*.dmp). The slot's
 * folder is cleared before every start, so a dump found after an instance ended is from that instance.
 * Needed because the handler ends soffice.bin with exit code 0, which looks like a clean shutdown.
 */
export function crashDumps(profileDir: string): string[] {
  const dir = join(profileDir, 'crash');
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.dmp')) : [];
}

/** Turkish sample with every special letter (dotted/dotless i in both cases). */
export const TURKISH = 'Çağrı İşçi ığdır ÖŞÜ';

/**
 * Whether process `pid` has loaded `dll` (Windows `tasklist /M`). Parses the CSV rows only, so the
 * localised "no tasks" message of a Turkish or English Windows does not matter.
 */
export function isModuleLoaded(pid: number, dll: string): Promise<boolean> {
  return new Promise((resolvePromise, reject) => {
    execFile('tasklist', ['/FI', `PID eq ${pid}`, '/M', dll, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 30_000 }, (error, stdout) => {
      if (error) return reject(error);
      resolvePromise(stdout.split(/\r?\n/).some((line) => line.split('","')[1] === String(pid)));
    });
  });
}

export function isProcessAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
