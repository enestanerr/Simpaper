import { describe, expect, it } from 'vitest';
import { createFallbackPlatform, FallbackProcessGuard, UnsupportedViewHost, type FallbackDeps } from '../../../src/main/platform/fallback';
import { memoryLogger, sleep } from './helpers';

function fakeDeps(platform: NodeJS.Platform, alive: Set<number>, psOutput = '', dies = true) {
  const runs: string[] = [];
  const signals: [number, NodeJS.Signals | 0][] = [];
  const deps: FallbackDeps = {
    platform,
    run: async (file, args) => {
      runs.push([file, ...args].join(' '));
      if (file === 'taskkill' && dies) alive.clear();
      return psOutput;
    },
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      if (!alive.has(pid)) throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      if (signal === 'SIGKILL' && dies) alive.delete(pid);
    },
    sleep: (ms) => sleep(Math.min(ms, 5)),
  };
  return { deps, runs, signals };
}

describe('FallbackProcessGuard', () => {
  it('uses taskkill /T /F on Windows without koffi and waits for the root to exit', async () => {
    const alive = new Set([4321]);
    const { deps, runs } = fakeDeps('win32', alive);
    const guard = new FallbackProcessGuard(memoryLogger(), deps);
    await guard.killTree(4321);
    expect(runs).toEqual(['taskkill /PID 4321 /T /F']);
    expect(guard.supported).toBe(false);
  });

  it('kills a POSIX tree leaves first, then the root, and leaves unrelated processes alone', async () => {
    const alive = new Set([1234, 1300, 1400, 9999]);
    const { deps, signals } = fakeDeps('linux', alive, '    1     0\n 1234     1\n 1300  1234\n 1400  1300\n 9999     1\n');
    await new FallbackProcessGuard(memoryLogger(), deps).killTree(1234);
    expect(signals.filter(([, s]) => s === 'SIGKILL').map(([pid]) => pid)).toEqual([1400, 1300, 1234]);
    expect(alive).toEqual(new Set([9999]));
  });

  it('does not signal a root that ps no longer lists (its PID may have been reused)', async () => {
    const alive = new Set([1300]);
    const { deps, signals } = fakeDeps('linux', alive, ' 1300 1\n');
    await new FallbackProcessGuard(memoryLogger(), deps).killTree(1234);
    expect(signals.filter(([, s]) => s === 'SIGKILL')).toEqual([]);
  });

  it('rejects when a process survives the timeout', async () => {
    const alive = new Set([2000]);
    const { deps } = fakeDeps('linux', alive, ' 2000 1\n', false);
    await expect(new FallbackProcessGuard(memoryLogger(), deps).killTree(2000, { timeoutMs: 40 })).rejects.toThrow(/still running 2000/);
  });

  it('refuses protected process ids', async () => {
    const { deps } = fakeDeps('linux', new Set());
    const guard = new FallbackProcessGuard(memoryLogger(), deps);
    await expect(guard.killTree(0)).rejects.toThrow(RangeError);
    await expect(guard.killTree(process.pid)).rejects.toThrow(RangeError);
    guard.adopt(); // no-op without a job object
  });
});

describe('fallback platform', () => {
  it('has no native views: documents load hidden', async () => {
    const view = new UnsupportedViewHost();
    expect(view.supported).toBe(false);
    expect(view.viewParamsFor()).toEqual({ mode: 'hidden' });
    expect(await view.freeze()).toBeNull();
    expect(view.isForeground()).toBe(false);
    view.attach();
    view.setBounds();
    view.dispose();
  });

  it('assembles the platform without shell keys', async () => {
    const platform = createFallbackPlatform(memoryLogger(), fakeDeps('linux', new Set()).deps);
    expect(platform.viewHost.supported).toBe(false);
    expect(platform.processGuard.supported).toBe(false);
    expect(platform.shellKeys).toBeUndefined();
    expect(await platform.hangDetector.isResponding('123', 100)).toBe(true);
  });
});
