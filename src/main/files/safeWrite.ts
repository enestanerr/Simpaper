/**
 * Safe save pipeline (implements the SafeWriter contract of src/main/documents/types.ts):
 *   temp file next to the target → write callback → fsync → verify → atomic replace.
 * The target is only touched by the final replace step; every failure path removes the temp file.
 * Replace uses ReplaceFileW on Windows (keeps ACLs/attributes of the original) and falls back to
 * rename when the target does not exist yet or koffi is unavailable. Transient sharing/permission
 * errors (antivirus scanners, search indexer, cloud sync clients) are retried with backoff.
 */
import * as fsp from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { SafeWriteOptions, SafeWriter } from '../documents/types';
import type { Logger } from '../log';
import { errorCode, randomToken, removeQuietly, sleep as defaultSleep } from './fsUtil';
import { loadNativeReplace, WIN32, win32ErrorToCode, type NativeReplace } from './win32Replace';

export type SafeWriteStage = 'prepare' | 'write' | 'flush' | 'verify' | 'replace';

export class SafeWriteError extends Error {
  override readonly name = 'SafeWriteError';
  constructor(
    readonly stage: SafeWriteStage,
    /** Node-style error code (`EACCES`, `EBUSY`, `ENOSPC` ...) when known. */
    readonly code: string | undefined,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface SafeWriteFileHandle {
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** File-system primitives used by the writer; injectable for fault-injection tests. */
export interface SafeWriteFs {
  open(path: string, flags: string): Promise<SafeWriteFileHandle>;
  stat(path: string): Promise<{ size: number }>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
}

export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface SafeWriterDeps {
  fs?: Partial<SafeWriteFs>;
  /** `undefined` = load ReplaceFileW lazily on Windows; `null` = always rename. */
  nativeReplace?: NativeReplace | null;
  retry?: Partial<RetryPolicy>;
  log?: Logger;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY: RetryPolicy = { attempts: 6, baseDelayMs: 50, maxDelayMs: 1000 };
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES']);

const nodeFs: SafeWriteFs = {
  open: (p, flags) => fsp.open(p, flags),
  stat: (p) => fsp.stat(p),
  rename: (a, b) => fsp.rename(a, b),
  unlink: (p) => fsp.unlink(p),
  copyFile: (a, b) => fsp.copyFile(a, b),
};

/** Name of the hidden temp/backup siblings: `.~simpaper-<rand>-<name>.<suffix>`. */
export function siblingName(targetPath: string, token: string, suffix: 'tmp' | 'bak'): string {
  const name = basename(targetPath);
  const short = name.length > 60 ? name.slice(name.length - 60) : name;
  return join(dirname(targetPath), `.~simpaper-${token}-${short}.${suffix}`);
}

/**
 * Matches temp/backup files left behind by an interrupted save (e.g. the process was killed). `.~varak-` is the
 * prefix of development builds before the rename (docs/adr/0009-product-name-simpaper.md).
 */
export const STALE_SIBLING = /^\.~(?:simpaper|varak)-[0-9a-f]{12}-.+\.(tmp|bak)$/;

export function createSafeWriter(deps: SafeWriterDeps = {}): SafeWriter {
  const fs: SafeWriteFs = { ...nodeFs, ...deps.fs };
  const retry: RetryPolicy = { ...DEFAULT_RETRY, ...deps.retry };
  const sleep = deps.sleep ?? defaultSleep;
  const native = (): NativeReplace | null => (deps.nativeReplace === undefined ? loadNativeReplace() : deps.nativeReplace);

  const exists = async (p: string): Promise<boolean> => {
    try {
      await fs.stat(p);
      return true;
    } catch (err) {
      if (errorCode(err) === 'ENOENT') return false;
      throw err;
    }
  };

  const unlinkQuietly = async (p: string): Promise<void> => {
    try {
      await fs.unlink(p);
    } catch {
      await removeQuietly(p);
    }
  };

  /** One replace attempt; throws an error with a Node-style `code`. */
  const replaceOnce = async (temp: string, target: string, token: string, keepBackup: boolean): Promise<void> => {
    const replaceApi = native();
    if (!(await exists(target))) {
      await fs.rename(temp, target);
      return;
    }
    if (!replaceApi) {
      if (keepBackup) await fs.copyFile(target, `${target}.bak`);
      await fs.rename(temp, target);
      return;
    }
    // Always pass a backup name: without one, ERROR_UNABLE_TO_MOVE_REPLACEMENT can leave no file at the target.
    const backup = siblingName(target, token, 'bak');
    const res = replaceApi.replace(target, temp, backup);
    if (res.ok) {
      if (keepBackup) await fs.rename(backup, `${target}.bak`);
      else await unlinkQuietly(backup);
      return;
    }
    if (res.win32Error === WIN32.UNABLE_TO_MOVE_REPLACEMENT_2 && !(await exists(target)) && (await exists(backup))) {
      // The original was moved to the backup name but the new file could not take its place: put it back.
      await fs.rename(backup, target);
    }
    if (res.win32Error === WIN32.FILE_NOT_FOUND && !(await exists(target))) {
      await fs.rename(temp, target);
      return;
    }
    const err = new Error(`ReplaceFileW failed (${res.win32Error})`) as Error & { code: string; win32: number };
    err.code = win32ErrorToCode(res.win32Error);
    err.win32 = res.win32Error;
    throw err;
  };

  const replaceWithRetry = async (temp: string, target: string, token: string, keepBackup: boolean, log?: Logger): Promise<void> => {
    for (let attempt = 1; ; attempt++) {
      try {
        await replaceOnce(temp, target, token, keepBackup);
        return;
      } catch (err) {
        const code = errorCode(err);
        if (!code || !TRANSIENT.has(code) || attempt >= retry.attempts) {
          throw new SafeWriteError('replace', code, `Could not replace the target file (${code ?? 'unknown'})`, { cause: err });
        }
        const delay = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (attempt - 1));
        log?.debug('replace retry', { attempt, code, delay });
        await sleep(delay);
      }
    }
  };

  return async function safeWrite(targetPath: string, write: (tempPath: string) => Promise<void>, opts: SafeWriteOptions = {}): Promise<void> {
    const target = resolve(targetPath);
    const token = randomToken(6);
    const temp = siblingName(target, token, 'tmp');
    let committed = false;
    try {
      // prepare: proves the folder is writable before the (possibly slow) write step
      try {
        const probe = await fs.open(temp, 'wx');
        await probe.close();
        await fs.unlink(temp);
      } catch (err) {
        throw new SafeWriteError('prepare', errorCode(err), 'The target folder is not writable', { cause: err });
      }

      try {
        await write(temp);
      } catch (err) {
        throw new SafeWriteError('write', errorCode(err), 'Writing the temporary file failed', { cause: err });
      }

      try {
        const handle = await fs.open(temp, 'r+');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      } catch (err) {
        const code = errorCode(err);
        throw new SafeWriteError(code === 'ENOENT' ? 'write' : 'flush', code, code === 'ENOENT' ? 'The writer produced no file' : 'Flushing the temporary file failed', { cause: err });
      }

      if (opts.verify) {
        try {
          await opts.verify(temp);
        } catch (err) {
          throw new SafeWriteError('verify', errorCode(err), 'The written file did not pass verification', { cause: err });
        }
      }

      await replaceWithRetry(temp, target, token, opts.keepBackup ?? false, deps.log);
      committed = true;
    } finally {
      if (!committed) await unlinkQuietly(temp);
    }
  };
}

/** Default writer (ReplaceFileW on Windows). */
export const safeWrite: SafeWriter = createSafeWriter();
