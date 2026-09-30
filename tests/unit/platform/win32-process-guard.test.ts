/**
 * Real processes, no windows: node → node trees (the grandchild is detached like soffice.exe →
 * soffice.bin, so only our code can kill it). Every test cleans up after itself.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { win32 } from '../../../src/main/platform/win32/ffi';
import { Win32ProcessGuard } from '../../../src/main/platform/win32/process-guard';
import { isAlive, killQuietly, memoryLogger, spawnNodeScript, waitFor } from './helpers';

const api = win32();
const WAITFOR = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'waitfor.exe');

/** argv: [delayMs, 'node' | 'waitfor', signalName, count]. Prints "G <pid>" for each grandchild it starts. */
const CHILD = `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const [delay, kind, signal, count] = process.argv.slice(1);
setTimeout(() => {
  for (let i = 0; i < Number(count || 1); i++) {
    const g = kind === 'waitfor'
      ? spawn(path.join(process.env.SystemRoot, 'System32', 'waitfor.exe'), ['/t', '60', signal + i], { stdio: 'ignore', windowsHide: true, detached: true })
      : spawn(process.execPath, ['-e', 'setTimeout(function () {}, 60000)'], { stdio: 'ignore', windowsHide: true, detached: true });
    g.unref();
    fs.writeSync(1, 'G ' + g.pid + '\\n');
  }
}, Number(delay || 0));
setTimeout(function () {}, 60000);
`;

const leftovers: number[] = [];

function startTree(delayMs: number, kind: 'node' | 'waitfor' = 'node', count = 1) {
  const child = spawnNodeScript(CHILD, [String(delayMs), kind, `SimpaperPlatformTest${process.pid}${Date.now()}`, String(count)]);
  if (child.pid) leftovers.push(child.pid);
  const grandchildren = async (): Promise<number[]> => {
    const pids = await waitFor(
      () => {
        const found = [...child.output().matchAll(/G (\d+)/g)].map((m) => Number(m[1]));
        return found.length >= count ? found : null;
      },
      20_000,
      `grandchildren of ${child.pid} (${child.output()})`,
    );
    leftovers.push(...pids);
    return pids;
  };
  const grandchild = async (): Promise<number> => (await grandchildren())[0]!;
  return { child, pid: child.pid!, grandchild, grandchildren };
}

afterEach(() => {
  killQuietly(...leftovers.splice(0));
});

describe.skipIf(!api)('Win32ProcessGuard (real processes, headless)', () => {
  const guardFor = (mode: 'adopt' | 'self' = 'adopt') => new Win32ProcessGuard(api!, { mode, log: memoryLogger() });

  it('binds koffi structs with the SDK layouts and lists processes with parent ids', () => {
    expect(api!.sizes.PROCESSENTRY32W).toBe(568);
    expect(api!.sizes.JOBOBJECT_EXTENDED_LIMIT_INFORMATION).toBe(144);
    const self = guardFor().listProcesses().find((e) => e.pid === process.pid);
    expect(self?.ppid).toBe(process.ppid);
  });

  it('killTree kills a node → node tree and resolves once every process is gone', async () => {
    const tree = startTree(0);
    const g = await tree.grandchild();
    expect(isAlive(tree.pid) && isAlive(g)).toBe(true);
    const started = Date.now();
    await guardFor().killTree(tree.pid);
    expect(isAlive(g)).toBe(false);
    expect(isAlive(tree.pid)).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 30_000);

  it('killTree kills a wider tree (parent + 6 detached children) with a single wait', async () => {
    const tree = startTree(0, 'node', 6);
    const kids = await tree.grandchildren();
    expect(kids).toHaveLength(6);
    await guardFor().killTree(tree.pid, { timeoutMs: 8000 });
    expect([tree.pid, ...kids].filter(isAlive)).toEqual([]);
  }, 30_000);

  it('killTree({ imageDir }) spares descendants outside the engine directory', async () => {
    if (!existsSync(WAITFOR)) return; // waitfor.exe ships with Windows 10/11 Pro/Home; skip elsewhere
    const tree = startTree(0, 'waitfor');
    const foreign = await tree.grandchild();
    await guardFor().killTree(tree.pid, { imageDir: dirname(process.execPath) });
    expect(isAlive(tree.pid)).toBe(false);
    expect(isAlive(foreign)).toBe(true); // e.g. a browser the engine opened for a hyperlink
    await guardFor().killTree(foreign);
    expect(isAlive(foreign)).toBe(false);
  }, 30_000);

  it('killTree resolves for a process that has already exited and refuses protected ids', async () => {
    const tree = startTree(0);
    await tree.grandchild();
    const guard = guardFor();
    await guard.killTree(tree.pid);
    await guard.killTree(tree.pid);
    await expect(guard.killTree(process.pid)).rejects.toThrow(RangeError);
    await expect(guard.killTree(process.ppid)).rejects.toThrow(RangeError);
    await expect(guard.killTree(0)).rejects.toThrow(RangeError);
  }, 30_000);

  it('adopt(): the process and the children it starts later are in the job; closing the job kills them', async () => {
    const guard = guardFor('adopt');
    expect(guard.supported).toBe(true);
    expect(guard.mode).toBe('adopt');
    const tree = startTree(1500); // grandchild starts after adoption
    guard.adopt(tree.pid);
    expect(guard.isInJob(tree.pid)).toBe(true);
    const g = await tree.grandchild();
    expect(guard.isInJob(g)).toBe(true);
    guard.closeJob(); // what happens when the app process exits or crashes
    await waitFor(() => !isAlive(tree.pid) && !isAlive(g), 10_000, 'the job to terminate the tree');
  }, 30_000);

  it('adopt(): children that existed before adoption are found by the snapshot', async () => {
    const guard = guardFor('adopt');
    const tree = startTree(0);
    const g = await tree.grandchild(); // already running when adopt() is called
    expect(guard.isInJob(g)).toBe(false);
    guard.adopt(tree.pid);
    expect(guard.isInJob(tree.pid)).toBe(true);
    expect(guard.isInJob(g)).toBe(true);
    guard.closeJob();
    await waitFor(() => !isAlive(tree.pid) && !isAlive(g), 10_000, 'the job to terminate the tree');
  }, 30_000);

  it('self mode: the current process joins the job, so its new children are covered without adopt()', async () => {
    // Affects only this test worker process: its remaining children die with it (intended).
    const guard = guardFor('self');
    if (guard.mode !== 'self') {
      // An enclosing job refused nesting; the guard must have fallen back to adopt mode.
      expect(guard.mode).toBe('adopt');
      return;
    }
    expect(guard.isInJob(process.pid)).toBe(true);
    expect(() => guard.closeJob()).toThrow(/terminate the app process/);
    const tree = startTree(0);
    const g = await tree.grandchild();
    expect(guard.isInJob(tree.pid)).toBe(true);
    expect(guard.isInJob(g)).toBe(true);
    await guard.killTree(tree.pid);
    expect(isAlive(g)).toBe(false);
  }, 30_000);
});
