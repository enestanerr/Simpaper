/**
 * Windows process guard: a Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (breakaway not
 * allowed) whose only handle is held by this process, so every process in it dies with the app,
 * even when the app crashes. Also kills process trees for engine shutdown. No Electron imports
 * (runs in plain Node/Vitest).
 *
 * Modes:
 * - `adopt` (default): engine processes are added with adopt(pid) right after spawning. Their
 *   later children join the job automatically (verified through libuv's own silent-breakaway job);
 *   children that already exist when adopt() runs are found by a process snapshot.
 * - `self`: the app process itself joins the job, so every descendant is covered without adopt().
 *   Side effect: everything the app starts is killed when it exits: Electron's app.relaunch()
 *   helper, an updater, and programs opened via shell.openExternal/openPath that were not already
 *   running. Therefore opt-in only.
 */
import type { Logger } from '../../log';
import { assertKillablePid, descendantsLeavesFirst, isPathInside, type ProcessEntry } from '../process-tree';
import type { KillTreeOptions, ProcessGuard } from '../types';
import {
  ERROR_INVALID_PARAMETER,
  INVALID_HANDLE_VALUE,
  JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  PROCESS_QUERY_LIMITED_INFORMATION,
  PROCESS_SET_QUOTA,
  PROCESS_TERMINATE,
  SYNCHRONIZE,
  TH32CS_SNAPPROCESS,
  WAIT_OBJECT_0,
  WAIT_TIMEOUT,
} from './constants';
import { callAsync, type ProcessEntry32, type Win32Api } from './ffi';

export type ProcessGuardMode = 'adopt' | 'self';

export interface Win32ProcessGuardOptions {
  mode?: ProcessGuardMode;
  log: Logger;
}

type Handle = bigint;

const DEFAULT_KILL_TIMEOUT_MS = 5000;
/** Exit code for killed processes; LibreOffice's launcher restarts soffice.bin only for 79/81. */
const KILLED_EXIT_CODE = 1;
/** Snapshot passes while killing: catches children a parent spawned before it was terminated. */
const KILL_PASSES = 3;
const MAX_WAIT_OBJECTS = 64;

export class Win32ProcessGuard implements ProcessGuard {
  readonly supported: boolean;
  /** Effective mode (`none` when the job could not be created). */
  readonly mode: ProcessGuardMode | 'none';
  private job: Handle | null = null;

  constructor(
    private readonly api: Win32Api,
    private readonly options: Win32ProcessGuardOptions,
  ) {
    const { kernel32 } = api;
    const log = options.log;
    const job = kernel32.CreateJobObjectW(null, null);
    if (!job) {
      log.error('CreateJobObjectW failed; child processes are not guarded', { win32Error: kernel32.GetLastError() });
      this.supported = false;
      this.mode = 'none';
      return;
    }
    const info = { BasicLimitInformation: { LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE }, IoInfo: {} };
    if (!kernel32.SetInformationJobObject(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS, info, api.sizes.JOBOBJECT_EXTENDED_LIMIT_INFORMATION)) {
      log.error('SetInformationJobObject failed; child processes are not guarded', { win32Error: kernel32.GetLastError() });
      kernel32.CloseHandle(job); // still empty: closing it kills nothing
      this.supported = false;
      this.mode = 'none';
      return;
    }
    this.job = job;
    this.supported = true;
    let mode: ProcessGuardMode = options.mode ?? 'adopt';
    if (mode === 'self' && !kernel32.AssignProcessToJobObject(job, kernel32.GetCurrentProcess())) {
      // E.g. an enclosing job that forbids nesting; adopt() still protects engine processes.
      log.warn('Could not put the app process into its job object; falling back to adopt mode', { win32Error: kernel32.GetLastError() });
      mode = 'adopt';
    }
    this.mode = mode;
    log.info('Process guard ready', { mode });
  }

  adopt(pid: number): void {
    if (!this.job) return;
    try {
      assertKillablePid(pid, process.pid, process.ppid);
    } catch (err) {
      this.options.log.warn('adopt: rejected process id', { pid, error: (err as Error).message });
      return;
    }
    if (!this.adoptOne(pid)) return;
    // Children the process started before it joined the job are not in it yet. The second pass
    // catches grandchildren created while the first pass was assigning their parents.
    for (let pass = 0; pass < 2; pass++) {
      for (const child of descendantsLeavesFirst(pid, this.treeSnapshot(pid))) this.adoptOne(child.pid);
    }
  }

  /** True when `pid` is in the job. */
  isInJob(pid: number): boolean {
    if (!this.job) return false;
    const { kernel32 } = this.api;
    const h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!h) return false;
    try {
      const result = [0];
      return kernel32.IsProcessInJob(h, this.job, result) && result[0] !== 0;
    } finally {
      kernel32.CloseHandle(h);
    }
  }

  async killTree(pid: number, options: KillTreeOptions = {}): Promise<void> {
    assertKillablePid(pid, process.pid, process.ppid);
    const { kernel32 } = this.api;
    const timeoutMs = options.timeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const imageDir = options.imageDir;
    const accept = imageDir ? (e: ProcessEntry) => isPathInside(e.imagePath, imageDir) : undefined;
    const handles = new Map<number, Handle>();
    const failures: string[] = [];
    try {
      for (let pass = 0; pass < KILL_PASSES; pass++) {
        // Leaves first, the root last; later passes only pick up processes spawned in the meantime.
        const targets = descendantsLeavesFirst(pid, this.treeSnapshot(pid), { accept }).map((e) => e.pid);
        if (pass === 0) targets.push(pid);
        const fresh = targets.filter((p) => !handles.has(p));
        if (pass > 0 && fresh.length === 0) break;
        for (const target of fresh) {
          const h = kernel32.OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, false, target);
          if (!h) {
            const err = kernel32.GetLastError();
            // ERROR_INVALID_PARAMETER: no such process (already gone).
            if (err !== ERROR_INVALID_PARAMETER) failures.push(`${target}: OpenProcess error ${err}`);
            continue;
          }
          handles.set(target, h);
          if (!kernel32.TerminateProcess(h, KILLED_EXIT_CODE)) {
            // ACCESS_DENIED for a process that is already exiting; the wait below decides.
            this.options.log.debug('TerminateProcess failed', { pid: target, win32Error: kernel32.GetLastError() });
          }
        }
      }
      // One worker thread per 64 handles (MAXIMUM_WAIT_OBJECTS) instead of one per process.
      const list = [...handles];
      for (let i = 0; i < list.length; i += MAX_WAIT_OBJECTS) {
        const chunk = new BigUint64Array(list.slice(i, i + MAX_WAIT_OBJECTS).map(([, h]) => BigInt.asUintN(64, h)));
        await callAsync(kernel32.WaitForMultipleObjects, chunk.length, chunk, true, Math.max(0, deadline - Date.now()));
      }
      for (const [target, h] of list) {
        const r = kernel32.WaitForSingleObject(h, 0);
        if (r === WAIT_TIMEOUT) failures.push(`${target}: still running after ${timeoutMs} ms`);
        else if (r !== WAIT_OBJECT_0) failures.push(`${target}: wait failed (${r})`);
      }
    } finally {
      for (const h of handles.values()) kernel32.CloseHandle(h);
    }
    if (failures.length > 0) throw new Error(`killTree(${pid}) incomplete: ${failures.join('; ')}`);
  }

  /**
   * Closes the job handle, which terminates every process in it. Only valid in `adopt` mode (in
   * `self` mode it would terminate this process too); used by tests and as an emergency stop.
   */
  closeJob(): void {
    if (!this.job) return;
    if (this.mode === 'self') throw new Error('closeJob() would terminate the app process (self mode)');
    this.api.kernel32.CloseHandle(this.job);
    this.job = null;
  }

  private adoptOne(pid: number): boolean {
    const { kernel32 } = this.api;
    if (this.isInJob(pid)) return true;
    const h = kernel32.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!h) {
      this.options.log.warn('adopt: cannot open process', { pid, win32Error: kernel32.GetLastError() });
      return false;
    }
    try {
      if (kernel32.AssignProcessToJobObject(this.job, h)) return true;
      this.options.log.warn('adopt: AssignProcessToJobObject failed', { pid, win32Error: kernel32.GetLastError() });
      return false;
    } finally {
      kernel32.CloseHandle(h);
    }
  }

  /** All processes (pid, parent pid) from a Toolhelp snapshot. */
  listProcesses(): ProcessEntry[] {
    const { kernel32 } = this.api;
    const snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (!snap || BigInt(snap) === INVALID_HANDLE_VALUE) throw new Error(`CreateToolhelp32Snapshot failed (${kernel32.GetLastError()})`);
    const entries: ProcessEntry[] = [];
    try {
      const size = this.api.sizes.PROCESSENTRY32W;
      const entry: ProcessEntry32 = { dwSize: size, th32ProcessID: 0, th32ParentProcessID: 0, szExeFile: '' };
      for (let ok = kernel32.Process32FirstW(snap, entry); ok; ok = kernel32.Process32NextW(snap, entry)) {
        entries.push({ pid: entry.th32ProcessID, ppid: entry.th32ParentProcessID });
        entry.dwSize = size;
      }
    } finally {
      kernel32.CloseHandle(snap);
    }
    return entries;
  }

  /** Snapshot with creation times and image paths for `root` and every process reachable from it by parent id. */
  private treeSnapshot(root: number): ProcessEntry[] {
    const entries = this.listProcesses();
    const children = new Map<number, ProcessEntry[]>();
    const byPid = new Map<number, ProcessEntry>();
    for (const e of entries) {
      byPid.set(e.pid, e);
      if (e.ppid === e.pid) continue;
      const list = children.get(e.ppid);
      if (list) list.push(e);
      else children.set(e.ppid, [e]);
    }
    const queue = [root];
    const seen = new Set<number>(queue);
    while (queue.length > 0) {
      const pid = queue.shift()!;
      const entry = byPid.get(pid);
      if (entry) this.addDetails(entry);
      for (const child of children.get(pid) ?? []) {
        if (!seen.has(child.pid)) {
          seen.add(child.pid);
          queue.push(child.pid);
        }
      }
    }
    return entries;
  }

  private addDetails(entry: ProcessEntry): void {
    if (entry.pid <= 0) return;
    const { kernel32 } = this.api;
    const h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, entry.pid);
    if (!h) return;
    try {
      const creation: (bigint | number)[] = [0];
      if (kernel32.GetProcessTimes(h, creation as bigint[], [0n], [0n], [0n])) entry.createdAt = BigInt(creation[0] ?? 0);
      const buf = new Uint16Array(1024);
      const size = [buf.length];
      if (kernel32.QueryFullProcessImageNameW(h, 0, buf, size)) entry.imagePath = String.fromCharCode(...buf.subarray(0, size[0]));
    } finally {
      kernel32.CloseHandle(h);
    }
  }
}
