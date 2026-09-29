/** Files passed on the command line (first launch, or forwarded by a second instance). */
import { isAbsolute, resolve } from 'node:path';
import { formatFromPath } from '@shared/formats';

export interface SecondInstanceData {
  argv: string[];
  cwd: string;
}

export function isSecondInstanceData(v: unknown): v is SecondInstanceData {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return Array.isArray(d['argv']) && d['argv'].every((a) => typeof a === 'string') && typeof d['cwd'] === 'string';
}

/**
 * Supported document paths in `argv`. The executable (and, unpackaged, the app path argument) and
 * every switch are skipped; relative paths resolve against `cwd`.
 */
export function filesFromArgv(argv: readonly string[], cwd: string, isPackaged: boolean): string[] {
  const out: string[] = [];
  let skipAppPath = !isPackaged;
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue;
    if (skipAppPath) {
      skipAppPath = false;
      continue;
    }
    if (arg.includes('\0') || /^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) continue;
    const full = isAbsolute(arg) ? arg : resolve(cwd, arg);
    if (!formatFromPath(full)) continue;
    const key = process.platform === 'win32' ? full.toLowerCase() : full;
    if (!out.some((p) => (process.platform === 'win32' ? p.toLowerCase() : p) === key)) out.push(full);
  }
  return out;
}
