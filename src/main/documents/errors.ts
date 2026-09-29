/**
 * Error model of the document services. User-facing failures carry an i18n key (`errors.*`,
 * src/renderer/i18n/locales/<lang>/errors.json); IPC rejections use the key as the message.
 */
import { RPC_ERROR } from '@shared/engine-protocol';
import { SafeWriteError } from '../files/safeWrite';

export class DocumentError extends Error {
  override readonly name = 'DocumentError';
  readonly detail: string | undefined;

  constructor(
    readonly errorKey: string,
    options?: { cause?: unknown; detail?: string },
  ) {
    super(errorKey, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.detail = options?.detail;
  }
}

/** Key for user cancellations (the renderer shows nothing). */
export const CANCELLED = 'errors.open.cancelled';

/** JSON-RPC error code carried by an engine call failure, if any. */
export function engineErrorCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { code?: unknown; rpcCode?: unknown; error?: { code?: unknown } };
  for (const c of [e.code, e.rpcCode, e.error?.code]) if (typeof c === 'number') return c;
  return undefined;
}

export function isTimeoutError(err: unknown): boolean {
  if (engineErrorCode(err) === RPC_ERROR.TIMEOUT) return true;
  const e = err as { name?: unknown; message?: unknown } | null;
  return !!e && (e.name === 'TimeoutError' || (typeof e.message === 'string' && /timed? ?out/i.test(e.message)));
}

/** The engine process could not be started (EngineStartError of src/main/engine). */
function isEngineStartFailure(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'EngineStartError';
}

function nodeCode(err: unknown): string | undefined {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

function fsKey(code: string | undefined): string | undefined {
  switch (code) {
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return 'errors.save.accessDenied';
    case 'EBUSY':
      return 'errors.save.locked';
    case 'ENOSPC':
    case 'EDQUOT':
      return 'errors.save.diskFull';
    case 'ENAMETOOLONG':
      return 'errors.save.pathTooLong';
    case 'ENOENT':
      return 'errors.save.folderMissing';
    default:
      return undefined;
  }
}

function engineKey(err: unknown, fallback: string): string {
  if (isEngineStartFailure(err)) return 'errors.engine.unavailable';
  if (isTimeoutError(err)) return 'errors.engine.timeout';
  switch (engineErrorCode(err)) {
    case RPC_ERROR.ENGINE_UNAVAILABLE:
      return 'errors.engine.unavailable';
    case RPC_ERROR.BUSY:
      return 'errors.engine.busy';
    case RPC_ERROR.STORE_FAILED:
      return 'errors.save.engineFailed';
    case RPC_ERROR.UNSUPPORTED:
      return 'errors.save.formatNotWritable';
    default:
      return fallback;
  }
}

export interface ErrorInfo {
  errorKey: string;
  detail?: string;
}

/** Maps any failure of the save/export pipeline to an i18n key. */
export function saveErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof DocumentError) return { errorKey: err.errorKey, ...(err.detail ? { detail: err.detail } : {}) };
  if (err instanceof SafeWriteError) {
    const detail = err.code ? `${err.stage}:${err.code}` : err.stage;
    if (err.stage === 'verify') return { errorKey: 'errors.save.verifyFailed', detail };
    if (err.stage === 'write') {
      const byFs = fsKey(nodeCode(err.cause) ?? err.code);
      return { errorKey: byFs ?? engineKey(err.cause, 'errors.save.engineFailed'), detail };
    }
    return { errorKey: fsKey(err.code) ?? 'errors.save.failed', detail };
  }
  const code = nodeCode(err);
  return { errorKey: fsKey(code) ?? engineKey(err, 'errors.save.failed'), ...(code ? { detail: code } : {}) };
}

/** Maps a failure while opening/loading to an i18n key. */
export function openErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof DocumentError) return { errorKey: err.errorKey, ...(err.detail ? { detail: err.detail } : {}) };
  const code = nodeCode(err);
  if (code === 'ENOENT') return { errorKey: 'errors.open.notFound', detail: code };
  if (code === 'EACCES' || code === 'EPERM') return { errorKey: 'errors.open.accessDenied', detail: code };
  if (code === 'EBUSY') return { errorKey: 'errors.open.locked', detail: code };
  if (isEngineStartFailure(err)) return { errorKey: 'errors.engine.unavailable' };
  if (isTimeoutError(err)) return { errorKey: 'errors.engine.timeout' };
  switch (engineErrorCode(err)) {
    case RPC_ERROR.ENGINE_UNAVAILABLE:
      return { errorKey: 'errors.engine.unavailable' };
    case RPC_ERROR.UNSUPPORTED:
      return { errorKey: 'errors.open.unsupported' };
    case RPC_ERROR.LOAD_FAILED:
      return { errorKey: 'errors.open.failed' };
    default:
      return { errorKey: 'errors.open.failed', ...(code ? { detail: code } : {}) };
  }
}
