/**
 * ProcessGuard without a Job Object: cannot adopt processes, but kills process trees.
 * Used by tests and as a fallback; the app uses the Win32 guard from src/main/platform.
 */
import { execFile } from 'node:child_process';
import type { ProcessGuard } from '../platform/types';

export function createTaskkillProcessGuard(): ProcessGuard {
  return {
    supported: false,
    adopt: () => undefined,
    killTree: (pid: number) =>
      new Promise<void>((resolve) => {
        if (!Number.isInteger(pid) || pid <= 0) return resolve();
        if (process.platform !== 'win32') {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // already gone
          }
          return resolve();
        }
        // /T: the whole tree (soffice.exe → soffice.bin, python.exe → python); /F: no WM_CLOSE round trip.
        // Exit code 128 ("not found") just means the process is already gone.
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 }, () => resolve());
      }),
  };
}
