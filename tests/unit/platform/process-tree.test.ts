import { describe, expect, it } from 'vitest';
import { assertKillablePid, descendantsLeavesFirst, isPathInside, parsePsOutput, type ProcessEntry } from '../../../src/main/platform/process-tree';

const p = (pid: number, ppid: number, createdAt?: number, imagePath?: string): ProcessEntry => ({
  pid,
  ppid,
  createdAt: createdAt === undefined ? undefined : BigInt(createdAt),
  imagePath,
});

describe('descendantsLeavesFirst', () => {
  // electron(100) → soffice.exe(200) → soffice.bin(300) → helper(400); python(210) → python-core(310)
  const tree = [p(100, 1, 10), p(200, 100, 20), p(300, 200, 30), p(400, 300, 40), p(210, 100, 21), p(310, 210, 31), p(999, 1, 5)];

  it('returns every descendant after its own descendants, without the root', () => {
    const order = descendantsLeavesFirst(100, tree).map((e) => e.pid);
    expect(order.sort()).toEqual([200, 210, 300, 310, 400].sort());
    const pos = (pid: number) => descendantsLeavesFirst(100, tree).findIndex((e) => e.pid === pid);
    expect(pos(400)).toBeLessThan(pos(300));
    expect(pos(300)).toBeLessThan(pos(200));
    expect(pos(310)).toBeLessThan(pos(210));
  });

  it('returns [] for a process that does not exist', () => {
    expect(descendantsLeavesFirst(12345, tree)).toEqual([]);
  });

  it('does not follow a reused PID: a "child" older than its parent belongs to a previous owner of that PID', () => {
    // 350 was started by an earlier process that also had PID 200 and has exited since.
    const entries = [p(200, 1, 100), p(350, 200, 50), p(360, 200, 150)];
    expect(descendantsLeavesFirst(200, entries).map((e) => e.pid)).toEqual([360]);
  });

  it('skips edges with unknown creation times unless allowed', () => {
    const entries = [p(200, 1, 100), p(300, 200)];
    expect(descendantsLeavesFirst(200, entries)).toEqual([]);
    expect(descendantsLeavesFirst(200, entries, { allowUnverified: true }).map((e) => e.pid)).toEqual([300]);
  });

  it('neither returns nor walks children rejected by the filter', () => {
    const entries = [
      p(200, 1, 1, 'C:\\Simpaper\\engine\\program\\soffice.exe'),
      p(300, 200, 2, 'C:\\Simpaper\\engine\\program\\soffice.bin'),
      p(310, 300, 3, 'C:\\Program Files\\Browser\\browser.exe'), // opened from a hyperlink
      p(320, 310, 4, 'C:\\Program Files\\Browser\\browser.exe'),
    ];
    const accept = (e: ProcessEntry) => isPathInside(e.imagePath, 'C:\\Simpaper\\engine\\program');
    expect(descendantsLeavesFirst(200, entries, { accept }).map((e) => e.pid)).toEqual([300]);
  });

  it('survives cycles and self-parented entries (System Idle Process has ppid 0)', () => {
    const entries = [p(0, 0), p(10, 20, 1), p(20, 10, 1), p(30, 30, 1)];
    expect(descendantsLeavesFirst(10, entries).map((e) => e.pid)).toEqual([20]);
    expect(descendantsLeavesFirst(30, entries)).toEqual([]);
  });

  it('handles deep chains without recursion limits', () => {
    const chain = Array.from({ length: 20_000 }, (_, i) => p(i + 2, i + 1, i));
    chain.push(p(1, 0, -1));
    const out = descendantsLeavesFirst(1, chain);
    expect(out).toHaveLength(20_000);
    expect(out[0]!.pid).toBe(20_001);
  });
});

describe('isPathInside', () => {
  it('compares directories case-insensitively and separator-agnostically', () => {
    expect(isPathInside('C:\\Simpaper\\Engine\\program\\soffice.bin', 'c:/simpaper/engine/program')).toBe(true);
    expect(isPathInside('C:\\Simpaper\\engine\\program\\python-core-3.13.15\\bin\\python.exe', 'C:\\Simpaper\\engine\\program\\')).toBe(true);
    expect(isPathInside('C:\\Simpaper\\engine\\programs\\x.exe', 'C:\\Simpaper\\engine\\program')).toBe(false);
    expect(isPathInside('C:\\Simpaper\\engine\\program', 'C:\\Simpaper\\engine\\program')).toBe(false);
    expect(isPathInside(undefined, 'C:\\x')).toBe(false);
    expect(isPathInside('C:\\x\\y.exe', '')).toBe(false);
  });
});

describe('parsePsOutput', () => {
  it('parses "pid ppid" lines and ignores anything else', () => {
    expect(parsePsOutput('    1     0\n  200     1\r\n garbage\n\n 300 200 \n')).toEqual([
      { pid: 1, ppid: 0 },
      { pid: 200, ppid: 1 },
      { pid: 300, ppid: 200 },
    ]);
  });
});

describe('assertKillablePid', () => {
  it('rejects values that would hit the wrong process', () => {
    for (const bad of [0, -1, 1, 4, 1.5, Number.NaN, 2 ** 60, 777, 888]) {
      expect(() => assertKillablePid(bad, 777, 888), String(bad)).toThrow(RangeError);
    }
    expect(() => assertKillablePid(1234, 777, 888)).not.toThrow();
  });
});
