/**
 * NDJSON JSON-RPC 2.0 client for the engine bridge (src/shared/engine-protocol.ts).
 * One message per line in both directions; responses carry the request id, notifications use
 * method "event". The bridge's stderr is forwarded to the logger (it never contains document content).
 */
import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { RPC_ERROR, type EngineEvent, type EngineMethod, type EngineMethods, type RpcErrorObject } from '@shared/engine-protocol';
import type { Logger, LogLevel } from '../log';
import type { EngineCallOptions } from './types';

export const DEFAULT_CALL_TIMEOUT_MS = 60_000;
/** A single line larger than this means a broken stream (the biggest legit payloads are document texts). */
const MAX_LINE_CHARS = 256 * 1024 * 1024;

/** Error returned by the bridge (or produced locally: timeout, closed connection). */
export class EngineRpcError extends Error {
  readonly code: number;
  readonly data: RpcErrorObject['data'];
  readonly method: string | undefined;

  constructor(code: number, message: string, data?: RpcErrorObject['data'], method?: string) {
    super(message);
    this.name = 'EngineRpcError';
    this.code = code;
    this.data = data;
    this.method = method;
  }
}

export function isEngineRpcError(value: unknown, code?: number): value is EngineRpcError {
  return value instanceof EngineRpcError && (code === undefined || value.code === code);
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  cleanup: () => void;
}

/** Splits a text stream into lines; tolerates chunks that end in the middle of a line or a UTF-8 sequence. */
export class LineSplitter {
  private readonly decoder = new StringDecoder('utf8');
  private buffer = '';

  constructor(private readonly onLine: (line: string) => void, private readonly maxChars = MAX_LINE_CHARS) {}

  push(chunk: Buffer | string): void {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.onLine(line);
      index = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.maxChars) throw new Error('line too long');
  }

  end(): void {
    const rest = (this.buffer + this.decoder.end()).replace(/\r$/, '');
    this.buffer = '';
    if (rest) this.onLine(rest);
  }
}

const BRIDGE_LEVELS: Record<string, LogLevel> = { DEBUG: 'debug', INFO: 'info', WARNING: 'warn', ERROR: 'error', CRITICAL: 'error' };

/** Forwards "LEVEL logger: message" lines (Python logging format of the bridge) to the logger. */
export function forwardLogLine(log: Logger, line: string): void {
  const match = /^(DEBUG|INFO|WARNING|ERROR|CRITICAL) ([\w.]+): (.*)$/.exec(line);
  if (match) {
    const level = BRIDGE_LEVELS[match[1] ?? ''] ?? 'info';
    log[level](match[3] ?? '', { source: match[2] });
  } else {
    // Tracebacks and interpreter messages: keep them, but only at debug level unless they look like errors.
    log[/Traceback|Error/.test(line) ? 'warn' : 'debug'](line);
  }
}

export class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private readonly splitter: LineSplitter;
  private closedReason: string | null = null;

  constructor(
    private readonly input: Writable,
    output: Readable,
    private readonly log: Logger,
    stderr?: Readable,
  ) {
    this.splitter = new LineSplitter((line) => this.onLine(line));
    output.on('data', (chunk: Buffer) => {
      try {
        this.splitter.push(chunk);
      } catch (error) {
        this.log.error('bridge output is not line-delimited JSON', { error: String(error) });
        this.close('invalid bridge output');
      }
    });
    output.on('end', () => {
      this.splitter.end();
      this.close('bridge closed its output');
    });
    output.on('error', (error) => this.close(`bridge output error: ${error.message}`));
    input.on('error', (error) => this.close(`bridge input error: ${error.message}`));
    if (stderr) {
      const errLines = new LineSplitter((line) => forwardLogLine(this.log, line), 1024 * 1024);
      stderr.on('data', (chunk: Buffer) => {
        try {
          errLines.push(chunk);
        } catch {
          // An overlong stderr line is dropped; it is diagnostics only.
        }
      });
      stderr.on('end', () => errLines.end());
    }
  }

  get closed(): boolean {
    return this.closedReason !== null;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  call<M extends EngineMethod>(method: M, params: EngineMethods[M]['params'], opts: EngineCallOptions = {}): Promise<EngineMethods[M]['result']> {
    if (this.closedReason !== null) {
      return Promise.reject(new EngineRpcError(RPC_ERROR.ENGINE_UNAVAILABLE, `engine unavailable: ${this.closedReason}`, undefined, method));
    }
    const { signal } = opts;
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    const line = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;

    return new Promise<EngineMethods[M]['result']>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle(id, new EngineRpcError(RPC_ERROR.TIMEOUT, `${method} timed out after ${timeoutMs} ms`, undefined, method));
      }, timeoutMs);
      const onAbort = (): void => this.settle(id, abortReason(signal));
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        },
      });
      this.input.write(line, (error) => {
        if (error) this.settle(id, new EngineRpcError(RPC_ERROR.ENGINE_UNAVAILABLE, `cannot send ${method}: ${error.message}`, undefined, method));
      });
    });
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Rejects all pending calls; later calls fail immediately with ENGINE_UNAVAILABLE. */
  close(reason: string): void {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    for (const id of [...this.pending.keys()]) {
      const method = this.pending.get(id)?.method;
      this.settle(id, new EngineRpcError(RPC_ERROR.ENGINE_UNAVAILABLE, `engine unavailable: ${reason}`, undefined, method));
    }
  }

  private settle(id: number, error: unknown, result?: unknown): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.cleanup();
    if (error !== undefined) entry.reject(error);
    else entry.resolve(result);
  }

  private onLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.log.warn('ignoring a malformed line from the bridge', { length: line.length });
      return;
    }
    if (!message || typeof message !== 'object') return;
    const msg = message as { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: RpcErrorObject };
    if (msg.method === 'event') {
      this.dispatchEvent(msg.params as EngineEvent);
      return;
    }
    if (typeof msg.id !== 'number') {
      if (msg.error) this.log.warn('bridge reported a request error', { code: msg.error.code, message: msg.error.message });
      return;
    }
    const entry = this.pending.get(msg.id);
    if (!entry) return; // timed out or aborted earlier
    if (msg.error) {
      const { code, message: text, data } = msg.error;
      this.settle(msg.id, new EngineRpcError(typeof code === 'number' ? code : RPC_ERROR.INTERNAL, String(text ?? 'engine error'), data, entry.method));
    } else {
      this.settle(msg.id, undefined, msg.result);
    }
  }

  private dispatchEvent(event: EngineEvent): void {
    if (!event || typeof event !== 'object' || typeof (event as { type?: unknown }).type !== 'string') return;
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.log.error('engine event listener failed', { type: event.type, error: String(error) });
      }
    }
  }
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError');
}
