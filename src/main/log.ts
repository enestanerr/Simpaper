/**
 * Minimal structured logger for the main process.
 * Privacy rule: never log document content; log docIds, formats, sizes and error codes instead.
 */
import { closeSync, fstatSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export type LogSink = (level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>) => void;

let sink: LogSink = (level, scope, message, meta) => {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${scope}: ${message}`;
  if (level === 'error' || level === 'warn') console.error(line, meta ?? '');
  else if (process.env['VARAK_DEBUG']) console.log(line, meta ?? '');
};

/** Replaces the output (the app installs a rotating file sink at startup). */
export function setLogSink(next: LogSink): void {
  sink = next;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, meta) => sink('debug', scope, m, meta),
    info: (m, meta) => sink('info', scope, m, meta),
    warn: (m, meta) => sink('warn', scope, m, meta),
    error: (m, meta) => sink('error', scope, m, meta),
    child: (sub) => createLogger(`${scope}/${sub}`),
  };
}

// ---------------------------------------------------------------------------------------------
// Rotating file sink

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_STRING = 500;
const MAX_DEPTH = 5;

/**
 * Serialises log metadata defensively: binary data is replaced by its length (it may be document
 * bytes), long strings are truncated, errors keep name/code/message/stack, cycles are cut.
 */
export function serializeMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  const seen = new WeakSet<object>();
  const walk = (value: unknown, depth: number): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(${value.length})` : value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) return `[${value.byteLength} bytes]`;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      const err = value as Error & { code?: unknown; errno?: unknown; syscall?: unknown };
      return {
        name: err.name,
        message: walk(err.message, depth + 1),
        ...(err.code !== undefined ? { code: err.code } : {}),
        ...(err.syscall !== undefined ? { syscall: err.syscall } : {}),
        ...(err.stack ? { stack: walk(err.stack.split('\n').slice(0, 6).join('\n'), depth + 1) } : {}),
      };
    }
    if (typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      if (depth >= MAX_DEPTH) return '[Object]';
      seen.add(value);
      if (Array.isArray(value)) return value.slice(0, 50).map((v) => walk(v, depth + 1));
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) out[k] = walk(v, depth + 1);
      return out;
    }
    return String(value);
  };
  try {
    return JSON.stringify(walk(meta, 0));
  } catch {
    return '"[unserialisable meta]"';
  }
}

export function formatLogLine(level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>, now = new Date()): string {
  const m = serializeMeta(meta);
  return `${now.toISOString()} ${level.toUpperCase().padEnd(5)} ${scope}: ${message}${m ? ` ${m}` : ''}\n`;
}

export interface RotatingFileSinkOptions {
  dir: string;
  /** File name without extension; rotated files are `<base>.1.log` … `<base>.<maxFiles-1>.log`. */
  baseName?: string;
  maxBytes?: number;
  maxFiles?: number;
  minLevel?: LogLevel;
  /** Also print warnings/errors (and everything when VARAK_DEBUG is set) to the console. */
  mirrorToConsole?: boolean;
}

export interface RotatingFileSink {
  readonly sink: LogSink;
  readonly path: string;
  close(): void;
}

/**
 * Appends one line per record to `<dir>/<base>.log` and rotates by size. Writes are synchronous so the
 * last records before a crash are on disk; logging never throws.
 */
export function createRotatingFileSink(opts: RotatingFileSinkOptions): RotatingFileSink {
  const base = opts.baseName ?? 'varak';
  const maxBytes = Math.max(4096, opts.maxBytes ?? 1024 * 1024);
  const maxFiles = Math.max(1, opts.maxFiles ?? 5);
  const minLevel = LEVEL_ORDER[opts.minLevel ?? 'info'];
  const current = join(opts.dir, `${base}.log`);
  const rotated = (i: number) => join(opts.dir, `${base}.${i}.log`);
  let fd: number | null = null;
  let size = 0;
  let broken = false;

  const ensureOpen = (): number => {
    if (fd === null) {
      mkdirSync(opts.dir, { recursive: true });
      fd = openSync(current, 'a');
      size = fstatSync(fd).size;
    }
    return fd;
  };

  const rotate = () => {
    if (fd !== null) closeSync(fd);
    fd = null;
    rmSync(rotated(maxFiles - 1), { force: true });
    for (let i = maxFiles - 2; i >= 1; i--) {
      try {
        renameSync(rotated(i), rotated(i + 1));
      } catch {
        // missing generation
      }
    }
    if (maxFiles > 1) renameSync(current, rotated(1));
    else rmSync(current, { force: true });
  };

  const write: LogSink = (level, scope, message, meta) => {
    if (opts.mirrorToConsole && (level === 'error' || level === 'warn' || process.env['VARAK_DEBUG'])) {
      const line = `${level.toUpperCase()} ${scope}: ${message}`;
      if (level === 'error' || level === 'warn') console.error(line, meta ?? '');
      else console.log(line, meta ?? '');
    }
    if (broken || LEVEL_ORDER[level] < minLevel) return;
    try {
      const buf = Buffer.from(formatLogLine(level, scope, message, meta), 'utf8');
      ensureOpen();
      if (size > 0 && size + buf.length > maxBytes) rotate();
      writeSync(ensureOpen(), buf);
      size += buf.length;
    } catch (err) {
      broken = true;
      console.error('Varak log sink disabled:', err);
    }
  };

  return {
    sink: write,
    path: current,
    close: () => {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // already closed
        }
      }
      fd = null;
    },
  };
}
