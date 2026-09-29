/**
 * Platform used where native views are unavailable (macOS/Linux, or Windows without koffi):
 * documents can still be loaded headless (`hidden` views), processes are killed with the OS tools.
 */
import { execFile } from 'node:child_process';
import type { ViewParams } from '@shared/engine-protocol';
import type { Logger } from '../log';
import { assertKillablePid, descendantsLeavesFirst, parsePsOutput } from './process-tree';
import type { HangDetector, KillTreeOptions, Platform, ProcessGuard, ViewHost } from './types';

export interface FallbackDeps {
  platform: NodeJS.Platform;
  /** Runs a program and resolves with its stdout (rejects on failure). */
  run(file: string, args: string[]): Promise<string>;
  /** process.kill semantics: throws ESRCH when the process does not exist. */
  kill(pid: number, signal: NodeJS.Signals | 0): void;
  sleep(ms: number): Promise<void>;
}

const DEFAULT_KILL_TIMEOUT_MS = 5000;
const POLL_MS = 50;

export const defaultFallbackDeps: FallbackDeps = {
  platform: process.platform,
  run: (file, args) =>
    new Promise((resolve, reject) => {
      execFile(file, args, { timeout: 5000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
    }),
  kill: (pid, signal) => process.kill(pid, signal),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** No native document views: the engine runs documents in `hidden` mode. */
export class UnsupportedViewHost implements ViewHost {
  readonly supported = false;
  viewParamsFor(): ViewParams {
    return { mode: 'hidden' };
  }
  attach(): void {}
  setBounds(): void {}
  setVisible(): void {}
  focus(): void {}
  freeze(): Promise<string | null> {
    return Promise.resolve(null);
  }
  unfreeze(): void {}
  detach(): void {}
  syncAll(): void {}
  dispose(): void {}
  isForeground(): boolean {
    return false;
  }
}

/** Kills trees with `taskkill /T` (Windows) or `ps` + SIGKILL (POSIX); no job object, so `supported` is false. */
export class FallbackProcessGuard implements ProcessGuard {
  readonly supported = false;

  constructor(
    private readonly log: Logger,
    private readonly deps: FallbackDeps = defaultFallbackDeps,
  ) {}

  adopt(): void {}

  async killTree(pid: number, options: KillTreeOptions = {}): Promise<void> {
    assertKillablePid(pid, process.pid, process.ppid);
    const timeoutMs = options.timeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;
    let targets: number[];
    if (this.deps.platform === 'win32') {
      await this.deps.run('taskkill', ['/PID', String(pid), '/T', '/F']).catch((err: unknown) => {
        this.log.debug('taskkill failed', { pid, error: err instanceof Error ? err.message : String(err) });
      });
      targets = [pid];
    } else {
      // POSIX re-parents orphans, so a living process' ppid is always its current parent and the
      // edges need no creation-time check.
      const entries = parsePsOutput(await this.deps.run('ps', ['-A', '-o', 'pid=,ppid=']).catch(() => ''));
      const listed = entries.length === 0 || entries.some((e) => e.pid === pid);
      targets = [...descendantsLeavesFirst(pid, entries, { allowUnverified: true }).map((e) => e.pid), ...(listed ? [pid] : [])];
      for (const target of targets) this.signal(target);
    }
    const deadline = Date.now() + timeoutMs;
    let alive = targets.filter((p) => this.exists(p));
    while (alive.length > 0 && Date.now() < deadline) {
      await this.deps.sleep(POLL_MS);
      alive = alive.filter((p) => this.exists(p));
    }
    if (alive.length > 0) throw new Error(`killTree(${pid}) incomplete: still running ${alive.join(', ')}`);
  }

  private signal(pid: number): void {
    try {
      this.deps.kill(pid, 'SIGKILL');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') this.log.debug('kill failed', { pid, error: (err as Error).message });
    }
  }

  private exists(pid: number): boolean {
    try {
      this.deps.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  }
}

/** Without native windows there is nothing to watch; always responsive. */
export const fallbackHangDetector: HangDetector = {
  isResponding: () => Promise.resolve(true),
};

export function createFallbackPlatform(log: Logger, deps: FallbackDeps = defaultFallbackDeps): Platform {
  return {
    viewHost: new UnsupportedViewHost(),
    processGuard: new FallbackProcessGuard(log.child('process'), deps),
    hangDetector: fallbackHangDetector,
    allowForeground: () => undefined,
  };
}
