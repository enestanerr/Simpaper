/**
 * Hand-written payload validators for IPC requests. Every request from the renderer is treated as
 * untrusted input: unknown keys, wrong types and oversized values are rejected before a service runs.
 */
import { isAbsolute } from 'node:path';
import type { UnoArg } from '@shared/engine-protocol';

export class IpcValidationError extends Error {
  override readonly name = 'IpcValidationError';
  constructor(readonly path: string) {
    super('errors.ipc.invalidRequest');
  }
}

export type Validator<T> = (value: unknown, path: string) => T;

const fail = (path: string): never => {
  throw new IpcValidationError(path);
};

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);

export function str(opts: { min?: number; max?: number; pattern?: RegExp } = {}): Validator<string> {
  const { min = 0, max = 10_000, pattern } = opts;
  return (v, path) => {
    if (typeof v !== 'string' || v.length < min || v.length > max || (pattern && !pattern.test(v))) fail(path);
    return v as string;
  };
}

export const bool: Validator<boolean> = (v, path) => (typeof v === 'boolean' ? v : fail(path));

export function num(min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): Validator<number> {
  return (v, path) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(path));
}

export function int(min = 0, max = Number.MAX_SAFE_INTEGER): Validator<number> {
  return (v, path) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fail(path));
}

export function oneOf<T extends string>(values: readonly T[]): Validator<T> {
  return (v, path) => (typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : fail(path));
}

export function nullable<T>(inner: Validator<T>): Validator<T | null> {
  return (v, path) => (v === null ? null : inner(v, path));
}

export function arr<T>(item: Validator<T>, max: number): Validator<T[]> {
  return (v, path) => {
    if (!Array.isArray(v) || v.length > max) fail(path);
    return (v as unknown[]).map((x, i) => item(x, `${path}[${i}]`));
  };
}

export function bytes(maxBytes: number): Validator<Uint8Array> {
  return (v, path) => (v instanceof Uint8Array && v.byteLength <= maxBytes ? v : fail(path));
}

type Shape = Record<string, { v: Validator<unknown>; optional?: boolean }>;
type ShapeOut<S extends Shape> = { [K in keyof S as S[K]['optional'] extends true ? never : K]: ReturnType<S[K]['v']> } & {
  [K in keyof S as S[K]['optional'] extends true ? K : never]?: ReturnType<S[K]['v']>;
};

export const req = <T>(v: Validator<T>) => ({ v, optional: false as const });
export const opt = <T>(v: Validator<T>) => ({ v, optional: true as const });

/** Object with exactly the given keys (unknown keys are rejected; `undefined` optional values are dropped). */
export function obj<S extends Shape>(shape: S): Validator<ShapeOut<S>> {
  return (v, path) => {
    if (!isRecord(v)) fail(path);
    const input = v as Record<string, unknown>;
    for (const k of Object.keys(input)) if (!(k in shape)) fail(`${path}.${k}`);
    const out: Record<string, unknown> = {};
    for (const [k, spec] of Object.entries(shape)) {
      const value = input[k];
      if (value === undefined) {
        if (!spec.optional) fail(`${path}.${k}`);
        continue;
      }
      out[k] = spec.v(value, `${path}.${k}`);
    }
    return out as ShapeOut<S>;
  };
}

/** Any plain object; the caller validates its content with a more specific validator. */
export const plainObject: Validator<Record<string, unknown>> = (v, path) => (isRecord(v) ? v : fail(path));

/** Channels without a request payload accept `undefined`/`null` only. */
export const none: Validator<void> = (v, path) => {
  if (v !== undefined && v !== null) fail(path);
};

/** `{}`-or-undefined payloads with optional fields. */
export function optionalObj<S extends Shape>(shape: S): Validator<ShapeOut<S>> {
  const inner = obj(shape);
  return (v, path) => (v === undefined || v === null ? ({} as ShapeOut<S>) : inner(v, path));
}

export const docId = str({ min: 1, max: 64, pattern: /^[A-Za-z0-9_-]+$/ });
// Hyphens occur in shape commands (.uno:BasicShapes.round-rectangle, .uno:ArrowShapes.left-right-arrow).
const UNO_NAME = /^\.uno:[A-Za-z][A-Za-z0-9_.-]*$/;

/** `.uno:Name`, optionally with URL-style arguments (`.uno:StyleApply?Style:string=Heading 1`). */
export const unoCommand: Validator<string> = (v, path) => {
  if (typeof v !== 'string' || v.length < 6 || v.length > 2000) fail(path);
  const s = v as string;
  const q = s.indexOf('?');
  if (!UNO_NAME.test(q >= 0 ? s.slice(0, q) : s)) fail(path);
  for (const ch of s) if ((ch.codePointAt(0) ?? 0) < 32) fail(path);
  return s;
};

/**
 * A command to execute: `.uno:Name` only. The URL form with arguments (`.uno:X?Name:string=…`) is refused, since
 * dispatch arguments are checked against the allow-list of src/shared/commands.ts (isAllowedUnoArgs).
 */
export const unoDispatchCommand: Validator<string> = (v, path) => {
  const s = unoCommand(v, path);
  if (s.includes('?')) fail(path);
  return s;
};

/** Absolute local path (no NUL bytes, bounded length). */
export const absolutePath: Validator<string> = (v, path) => {
  if (typeof v !== 'string' || v.length === 0 || v.length > 32_767 || v.includes('\0') || !isAbsolute(v)) fail(path);
  return v as string;
};

export const cssRect = obj({
  x: req(num(-1e6, 1e6)),
  y: req(num(-1e6, 1e6)),
  width: req(num(0, 1e6)),
  height: req(num(0, 1e6)),
});

const MAX_UNO_DEPTH = 4;

function unoValue(v: unknown, path: string, depth: number): UnoArg {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fail(path);
  if (typeof v === 'string') return v.length <= 100_000 ? v : fail(path);
  if (depth >= MAX_UNO_DEPTH) fail(path);
  if (Array.isArray(v)) {
    if (v.length > 1000) fail(path);
    return v.map((x, i) => unoValue(x, `${path}[${i}]`, depth + 1));
  }
  if (isRecord(v)) {
    const type = v['type'];
    const keys = Object.keys(v);
    if (keys.length !== 2 || !('value' in v) || typeof type !== 'string') fail(path);
    const value = v['value'];
    switch (type) {
      case 'float':
      case 'double':
      case 'byte':
      case 'short':
      case 'long':
      case 'hyper':
        if (typeof value !== 'number' || !Number.isFinite(value)) fail(path);
        return { type, value: value as number };
      case 'string':
        if (typeof value !== 'string' || value.length > 100_000) fail(path);
        return { type, value: value as string };
      case 'boolean':
        if (typeof value !== 'boolean') fail(path);
        return { type, value: value as boolean };
      default:
        return fail(path);
    }
  }
  return fail(path);
}

/** `.uno:` dispatch arguments (JSON-friendly UNO values, see engine-protocol.ts). */
export const unoArgs: Validator<Record<string, UnoArg>> = (v, path) => {
  if (!isRecord(v)) fail(path);
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 50) fail(path);
  const out: Record<string, UnoArg> = {};
  for (const [k, x] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(k)) fail(`${path}.${k}`);
    out[k] = unoValue(x, `${path}.${k}`, 0);
  }
  return out;
};
