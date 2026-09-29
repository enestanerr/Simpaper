/**
 * Windows `ReplaceFileW` through koffi. Unlike a rename, it keeps the replaced file's ACLs, attributes,
 * creation time and alternate data streams, which matters for files on shared/managed folders.
 * Loaded lazily so the rest of the app works when koffi (or Windows) is unavailable.
 */
import { createRequire } from 'node:module';

export interface NativeReplaceResult {
  ok: boolean;
  /** Win32 error code when `ok` is false. */
  win32Error: number;
}

export interface NativeReplace {
  /** Replaces `target` with `replacement`; the previous `target` is moved to `backup`. */
  replace(target: string, replacement: string, backup: string): NativeReplaceResult;
}

export const WIN32 = {
  FILE_NOT_FOUND: 2,
  ACCESS_DENIED: 5,
  SHARING_VIOLATION: 32,
  LOCK_VIOLATION: 33,
  HANDLE_DISK_FULL: 39,
  DISK_FULL: 112,
  UNABLE_TO_REMOVE_REPLACED: 1175,
  UNABLE_TO_MOVE_REPLACEMENT: 1176,
  UNABLE_TO_MOVE_REPLACEMENT_2: 1177,
  USER_MAPPED_FILE: 1224,
} as const;

const REPLACEFILE_IGNORE_MERGE_ERRORS = 0x2;

/** Maps Win32 errors of ReplaceFileW onto Node-style codes used by the error mapping. */
export function win32ErrorToCode(code: number): string {
  switch (code) {
    case WIN32.ACCESS_DENIED:
      return 'EACCES';
    case WIN32.SHARING_VIOLATION:
    case WIN32.LOCK_VIOLATION:
    case WIN32.USER_MAPPED_FILE:
    case WIN32.UNABLE_TO_REMOVE_REPLACED:
    case WIN32.UNABLE_TO_MOVE_REPLACEMENT:
    case WIN32.UNABLE_TO_MOVE_REPLACEMENT_2:
      return 'EBUSY';
    case WIN32.DISK_FULL:
    case WIN32.HANDLE_DISK_FULL:
      return 'ENOSPC';
    case WIN32.FILE_NOT_FOUND:
      return 'ENOENT';
    default:
      return `WIN32_${code}`;
  }
}

let cached: NativeReplace | null | undefined;

interface KoffiLike {
  load(path: string): { func(definition: string): (...args: unknown[]) => unknown };
}

export function loadNativeReplace(): NativeReplace | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (process.platform !== 'win32') return cached;
  try {
    const require = createRequire(import.meta.url);
    const koffi = require('koffi') as KoffiLike;
    const kernel32 = koffi.load('kernel32.dll');
    const replaceFileW = kernel32.func(
      'bool __stdcall ReplaceFileW(str16 lpReplacedFileName, str16 lpReplacementFileName, str16 lpBackupFileName, uint32 dwReplaceFlags, void *lpExclude, void *lpReserved)',
    );
    const getLastError = kernel32.func('uint32 __stdcall GetLastError()');
    cached = {
      replace(target, replacement, backup) {
        const ok = Boolean(replaceFileW(target, replacement, backup, REPLACEFILE_IGNORE_MERGE_ERRORS, null, null));
        return { ok, win32Error: ok ? 0 : Number(getLastError()) };
      },
    };
  } catch {
    cached = null;
  }
  return cached;
}
