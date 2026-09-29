/** Process-tree computations shared by the Windows guard and the non-Windows fallback (pure). */

export interface ProcessEntry {
  pid: number;
  /** Parent PID as recorded when the process was created (the parent may have exited since). */
  ppid: number;
  /** Creation time in any monotonic unit (FILETIME ticks on Windows); undefined when unknown. */
  createdAt?: bigint;
  /** Full executable path, when known. */
  imagePath?: string;
}

export interface DescendantOptions {
  /**
   * Follow edges whose creation times are unknown. Off by default: PIDs are reused, and a process
   * created before its supposed parent belongs to an earlier owner of that PID.
   */
  allowUnverified?: boolean;
  /** Children rejected here are neither returned nor walked. */
  accept?: (child: ProcessEntry) => boolean;
}

function isVerifiedEdge(parent: ProcessEntry, child: ProcessEntry, allowUnverified: boolean): boolean {
  if (parent.createdAt === undefined || child.createdAt === undefined) return allowUnverified;
  return child.createdAt >= parent.createdAt;
}

/**
 * Descendants of `rootPid` in kill order: every process comes after all of its own descendants
 * ("leaves first"). The root itself is not included. Returns [] when the root is not in `entries`.
 */
export function descendantsLeavesFirst(rootPid: number, entries: readonly ProcessEntry[], options: DescendantOptions = {}): ProcessEntry[] {
  const allowUnverified = options.allowUnverified ?? false;
  const byPid = new Map<number, ProcessEntry>();
  const children = new Map<number, ProcessEntry[]>();
  for (const e of entries) {
    if (!Number.isInteger(e.pid) || e.pid <= 0) continue;
    byPid.set(e.pid, e);
    if (e.ppid === e.pid) continue;
    const list = children.get(e.ppid);
    if (list) list.push(e);
    else children.set(e.ppid, [e]);
  }
  const root = byPid.get(rootPid);
  if (!root) return [];

  const out: ProcessEntry[] = [];
  const visited = new Set<number>([rootPid]);
  // Iterative post-order DFS (process trees can be deep; no recursion limits).
  const stack: { node: ProcessEntry; next: number }[] = [{ node: root, next: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const kids = children.get(frame.node.pid) ?? [];
    if (frame.next < kids.length) {
      const child = kids[frame.next++]!;
      if (visited.has(child.pid)) continue;
      if (!isVerifiedEdge(frame.node, child, allowUnverified)) continue;
      if (options.accept && !options.accept(child)) continue;
      visited.add(child.pid);
      stack.push({ node: child, next: 0 });
    } else {
      stack.pop();
      if (frame.node.pid !== rootPid) out.push(frame.node);
    }
  }
  return out;
}

/** True when `imagePath` lies inside `dir` (case-insensitive, separator-agnostic, Windows-style paths). */
export function isPathInside(imagePath: string | undefined, dir: string): boolean {
  if (!imagePath || !dir) return false;
  const norm = (p: string): string => p.replace(/[\\/]+/g, '\\').replace(/\\$/, '').toLowerCase();
  const d = norm(dir);
  const p = norm(imagePath);
  return p.startsWith(`${d}\\`);
}

/** Parses `ps -A -o pid=,ppid=` output (non-Windows fallback). */
export function parsePsOutput(text: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) entries.push({ pid: Number(m[1]), ppid: Number(m[2]) });
  }
  return entries;
}

/**
 * Rejects PIDs that must never be killed: invalid values (process.kill(0) would even target our own
 * process on Windows), init (1), System (4), ourselves and our parent.
 */
export function assertKillablePid(pid: number, self: number, parent: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new RangeError(`Invalid process id: ${String(pid)}`);
  if (pid === 1 || pid === 4 || pid === self || pid === parent) throw new RangeError(`Refusing to kill protected process ${pid}`);
}
