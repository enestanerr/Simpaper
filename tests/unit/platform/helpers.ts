import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../../../src/main/log';

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
}

/** Logger that records entries instead of printing them. */
export function memoryLogger(entries: LogEntry[] = [], scope = 'test'): Logger & { entries: LogEntry[] } {
  const make = (s: string): Logger => ({
    debug: (message, meta) => void entries.push({ level: 'debug', scope: s, message, meta }),
    info: (message, meta) => void entries.push({ level: 'info', scope: s, message, meta }),
    warn: (message, meta) => void entries.push({ level: 'warn', scope: s, message, meta }),
    error: (message, meta) => void entries.push({ level: 'error', scope: s, message, meta }),
    child: (sub) => make(`${s}/${sub}`),
  });
  return Object.assign(make(scope), { entries });
}

/** Lets queued promise chains and immediates run. */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(probe: () => T | undefined | null | false, timeoutMs: number, what: string): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = probe();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(25);
  }
}

export function isAlive(pid: number): boolean {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Spawns `node -e script` from the repository root (so `require('koffi')` resolves), hidden, stdout piped. */
export function spawnNodeScript(script: string, args: string[] = [], detached = false): ChildProcess & { output: () => string } {
  const child = spawn(process.execPath, ['-e', script, '--', ...args], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached,
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
  return Object.assign(child, { output: () => out });
}

/** Best-effort cleanup for processes a test may have left behind (never pid <= 0: kill(0) targets ourselves on Windows). */
export function killQuietly(...pids: (number | undefined)[]): void {
  for (const pid of pids) {
    if (pid === undefined || !(pid > 0) || pid === process.pid) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}
