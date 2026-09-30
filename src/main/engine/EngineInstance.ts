/**
 * One engine instance: an unmodified soffice (own profile, random named pipe) plus the simpaper_bridge
 * process that talks UNO to it and NDJSON JSON-RPC to us.
 *
 * Process tree on Windows: soffice.exe (launcher) → soffice.bin; python.exe (launcher) → python (bridge).
 * Killing a launcher does not end its child, so every kill is a tree kill (ProcessGuard.killTree).
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { ENGINE_PROTOCOL_VERSION, RPC_ERROR, type EngineEvent, type EngineMethod, type EngineMethods } from '@shared/engine-protocol';
import type { Logger } from '../log';
import type { ProcessGuard } from '../platform/types';
import type { EngineLaunchOptions } from './launch';
import type { EnginePaths } from './locate';
import { profileUrl } from './profiles';
import { EngineRpcError, RpcClient, forwardLogLine, LineSplitter } from './rpc';
import type { EngineCallOptions, EngineExitInfo, EngineInstance, EngineInstanceInfo, EngineInstanceState, EngineRole } from './types';

/** soffice.bin asks its launcher for a restart with this exit code (EXITHELPER_NORMAL_RESTART). */
export const RESTART_EXIT_CODE = 81;
/**
 * The bridge exits with this code when its URP connection to soffice is lost although nobody asked soffice
 * to end (EXIT_CONNECTION_LOST in engine/bridge/simpaper_bridge/protocol.py): soffice died, or binaryurp gave
 * up on the connection while soffice keeps running. The instance is unusable either way: it ends as crashed.
 */
export const BRIDGE_EXIT_CONNECTION_LOST = 3;
const SHUTDOWN_CALL_TIMEOUT_MS = 10_000;
const EXIT_GRACE_MS = 8_000;
/** How long ProcessGuard.killTree may wait for the killed processes to disappear. */
const KILL_TIMEOUT_MS = 10_000;
const STRIPPED_ENV = new Set(['UNO_PATH', 'URE_BOOTSTRAP', 'PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP', 'PYTHONUSERBASE', 'PYTHONEXECUTABLE', 'ELECTRON_RUN_AS_NODE']);

export interface InstanceConfig {
  id: string;
  role: EngineRole;
  paths: EnginePaths;
  profileDir: string;
  /** --headless: no windows at all (conversion instance, tests). */
  headless: boolean;
  startTimeoutMs: number;
  bridgeLogLevel?: 'debug' | 'info' | 'warn' | 'error';
  env?: NodeJS.ProcessEnv;
  /** Start-up overrides for soffice (src/main/engine/launch.ts). */
  launch?: EngineLaunchOptions;
}

export interface InstanceDeps {
  processGuard: ProcessGuard;
  log: Logger;
}

export class EngineStartError extends Error {
  readonly exitCode: number | null;

  constructor(message: string, exitCode: number | null = null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EngineStartError';
    this.exitCode = exitCode;
  }
}

/** Environment without inherited UNO/Python settings (the launchers set their own). */
export function cleanEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !STRIPPED_ENV.has(key.toUpperCase())) env[key] = value;
  }
  return env;
}

export function officeArguments(profileDir: string, pipe: string, pidFile: string, headless: boolean): string[] {
  return [
    `-env:UserInstallation=${profileUrl(profileDir)}`,
    `--accept=pipe,name=${pipe};urp;StarOffice.ComponentContext`,
    '--norestore',
    '--nologo',
    '--nodefault',
    '--nolockcheck',
    `--pidfile=${pidFile}`,
    ...(headless ? ['--headless'] : []),
  ];
}

function exited(child: ChildProcess | null): boolean {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Image name of a running process (Windows), to avoid killing a reused PID. */
function processImageName(pid: number): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      if (error) return resolve(null);
      const match = /^"([^"]+)","(\d+)"/m.exec(stdout);
      resolve(match && Number(match[2]) === pid ? (match[1] ?? null) : null);
    });
  });
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms).unref());

export class OfficeInstance implements EngineInstance {
  readonly id: string;
  readonly role: EngineRole;
  private state: EngineInstanceState = 'starting';
  private readonly log: Logger;
  private readonly guard: ProcessGuard;
  private readonly pipe = `simpaper_${randomBytes(8).toString('hex')}`;
  private readonly pidFile: string;
  private office: ChildProcess | null = null;
  private bridge: ChildProcess | null = null;
  private rpc: RpcClient | null = null;
  private officePid: number | undefined;
  private bridgePid: number | undefined;
  private officeVersion: string | undefined;
  private officeExitCode: number | null = null;
  private restartUsed = false;
  private stopping = false;
  private startedInMs: number | undefined;
  private failStartup: ((error: Error) => void) | null = null;
  private exitInfo: EngineExitInfo | null = null;
  private disposal: Promise<void> | null = null;
  private readonly eventListeners = new Set<(event: EngineEvent) => void>();
  private readonly exitListeners = new Set<(info: EngineExitInfo) => void>();

  private constructor(private readonly config: InstanceConfig, deps: InstanceDeps) {
    this.id = config.id;
    this.role = config.role;
    this.log = deps.log.child(config.id);
    this.guard = deps.processGuard;
    this.pidFile = join(config.profileDir, 'soffice.pid');
  }

  /** Starts soffice and the bridge and completes the engine.hello handshake. */
  static async start(config: InstanceConfig, deps: InstanceDeps): Promise<OfficeInstance> {
    const instance = new OfficeInstance(config, deps);
    try {
      await instance.boot();
      return instance;
    } catch (error) {
      instance.stopping = true;
      instance.rpc?.close('start-up failed');
      await instance.killProcesses();
      instance.state = 'stopped';
      throw error instanceof EngineStartError ? error : new EngineStartError(`engine start failed: ${String((error as Error)?.message ?? error)}`, null, { cause: error });
    }
  }

  private async boot(): Promise<void> {
    const started = Date.now();
    const failure = new Promise<never>((_resolve, reject) => {
      this.failStartup = reject;
    });
    failure.catch(() => undefined);
    this.spawnOffice();
    this.spawnBridge();
    const rpc = this.rpc;
    if (!rpc) throw new EngineStartError('bridge did not start');
    const hello = await Promise.race([
      rpc.call('engine.hello', { protocol: ENGINE_PROTOCOL_VERSION }, { timeoutMs: this.config.startTimeoutMs }),
      failure,
    ]);
    this.failStartup = null;
    if (hello.protocol !== ENGINE_PROTOCOL_VERSION) throw new EngineStartError(`bridge speaks protocol ${hello.protocol}`);
    this.officeVersion = hello.officeVersion;
    this.officePid = hello.officePid;
    this.bridgePid = hello.bridgePid;
    for (const pid of [this.officePid, this.bridgePid]) if (pid) this.adopt(pid);
    this.startedInMs = Date.now() - started;
    this.state = 'ready';
    this.log.info('engine instance ready', { role: this.role, ms: this.startedInMs, officeVersion: this.officeVersion, headless: this.config.headless });
  }

  private adopt(pid: number): void {
    try {
      this.guard.adopt(pid);
    } catch (error) {
      this.log.warn('process guard could not adopt a process', { pid, error: String(error) });
    }
  }

  private spawnOffice(): void {
    const { paths, profileDir, headless } = this.config;
    const env = { ...cleanEnvironment(this.config.env ?? process.env), ...this.config.launch?.env };
    // No windowsHide for document instances: soffice passes its STARTUPINFO on to soffice.bin, where
    // SW_HIDE would apply to the first document window.
    const args = [...officeArguments(profileDir, this.pipe, this.pidFile, headless), ...(this.config.launch?.args ?? [])];
    const child = spawn(paths.sofficeExe, args, {
      cwd: paths.programDir,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: headless,
    });
    this.office = child;
    if (child.pid) this.adopt(child.pid);
    const lines = new LineSplitter((line) => this.log.debug(`soffice: ${line}`), 64 * 1024);
    child.stderr?.on('data', (chunk: Buffer) => {
      try {
        lines.push(chunk);
      } catch {
        // diagnostics only
      }
    });
    child.on('error', (error) => this.onStartupProblem(new EngineStartError(`cannot start soffice: ${error.message}`, null, { cause: error })));
    child.on('exit', (code) => this.onOfficeExit(child, code));
  }

  private spawnBridge(): void {
    const { paths, startTimeoutMs } = this.config;
    const env = cleanEnvironment(this.config.env ?? process.env);
    env['PYTHONPATH'] = paths.bridgeDir;
    env['PYTHONIOENCODING'] = 'utf-8';
    env['PYTHONUTF8'] = '1';
    env['PYTHONUNBUFFERED'] = '1';
    env['PYTHONDONTWRITEBYTECODE'] = '1';
    env['PYTHONNOUSERSITE'] = '1';
    const args = [
      '-m', 'simpaper_bridge',
      '--pipe', this.pipe,
      '--log-level', this.config.bridgeLogLevel ?? 'info',
      '--connect-timeout', String(Math.max(5, Math.ceil(startTimeoutMs / 1000))),
      '--office-pid-file', this.pidFile,
    ];
    const child = spawn(paths.pythonExe, args, { cwd: paths.bridgeDir, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.bridge = child;
    if (child.pid) this.adopt(child.pid);
    const bridgeLog = this.log.child('bridge');
    if (!child.stdin || !child.stdout) throw new EngineStartError('bridge has no stdio');
    const rpc = new RpcClient(child.stdin, child.stdout, bridgeLog, child.stderr ?? undefined);
    rpc.onEvent((event) => this.onBridgeEvent(event));
    this.rpc = rpc;
    child.on('error', (error) => this.onStartupProblem(new EngineStartError(`cannot start the bridge: ${error.message}`, null, { cause: error })));
    child.on('exit', (code) => this.onBridgeExit(code));
  }

  private onStartupProblem(error: EngineStartError): void {
    if (this.state === 'starting' && this.failStartup) this.failStartup(error);
    else this.log.error(error.message);
  }

  private onOfficeExit(child: ChildProcess, code: number | null): void {
    if (child !== this.office) return;
    this.officeExitCode = code;
    if (this.stopping) return;
    if (this.state === 'starting') {
      if (code === RESTART_EXIT_CODE && !this.restartUsed) {
        this.restartUsed = true;
        this.log.info('soffice requested a restart during start-up; relaunching once');
        this.spawnOffice();
        return;
      }
      this.onStartupProblem(new EngineStartError(`soffice exited during start-up (code ${code})`, code));
      return;
    }
    this.crashed(code, 'soffice exited unexpectedly');
  }

  private onBridgeExit(code: number | null): void {
    this.rpc?.close(`bridge exited (code ${code})`);
    if (this.stopping) return;
    if (this.state === 'starting') {
      this.onStartupProblem(new EngineStartError(`bridge exited during start-up (code ${code})`, code));
      return;
    }
    // Also when soffice itself still runs (lost URP connection): crashed() kills it, and the document
    // layer restores the document into a new instance.
    this.crashed(this.officeExitCode ?? code, code === BRIDGE_EXIT_CONNECTION_LOST ? 'the bridge lost its connection to soffice' : 'bridge exited unexpectedly');
  }

  private crashed(code: number | null, reason: string): void {
    if (this.state === 'crashed' || this.state === 'stopped') return;
    this.state = 'crashed';
    this.stopping = true;
    this.log.error('engine instance crashed', { reason, code });
    this.rpc?.close(reason);
    void this.killProcesses().finally(() => this.emitExit({ code, crashed: true }));
  }

  private onBridgeEvent(event: EngineEvent): void {
    if (event.type === 'log') {
      forwardLogLine(this.log, `${event.level === 'warn' ? 'WARNING' : event.level.toUpperCase()} bridge: ${event.message}`);
      return;
    }
    for (const listener of [...this.eventListeners]) {
      try {
        listener(event);
      } catch (error) {
        this.log.error('engine event listener failed', { type: event.type, error: String(error) });
      }
    }
  }

  private emitExit(info: EngineExitInfo): void {
    if (this.exitInfo) return;
    this.exitInfo = info;
    for (const listener of [...this.exitListeners]) {
      try {
        listener(info);
      } catch (error) {
        this.log.error('engine exit listener failed', { error: String(error) });
      }
    }
  }

  // ---------------------------------------------------------------- EngineInstance
  call<M extends EngineMethod>(method: M, params: EngineMethods[M]['params'], opts?: EngineCallOptions): Promise<EngineMethods[M]['result']> {
    if (!this.rpc || this.stopping || (this.state !== 'ready' && this.state !== 'busy')) {
      return Promise.reject(new EngineRpcError(RPC_ERROR.ENGINE_UNAVAILABLE, `engine instance ${this.id} is ${this.stopping ? 'stopping' : this.state}`, undefined, method));
    }
    return this.rpc.call(method, params, opts);
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onExit(listener: (info: EngineExitInfo) => void): () => void {
    if (this.exitInfo) {
      const info = this.exitInfo;
      queueMicrotask(() => listener(info));
      return () => undefined;
    }
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  info(): EngineInstanceInfo {
    const busy = this.state === 'ready' && (this.rpc?.pendingCount ?? 0) > 0;
    return {
      id: this.id,
      role: this.role,
      state: busy ? 'busy' : this.state,
      officePid: this.officePid,
      bridgePid: this.bridgePid,
      officeVersion: this.officeVersion,
      profileDir: this.config.profileDir,
      startedInMs: this.startedInMs,
    };
  }

  dispose(): Promise<void> {
    this.disposal ??= this.shutdown();
    return this.disposal;
  }

  private async shutdown(): Promise<void> {
    const graceful = !this.stopping && this.state === 'ready' && this.rpc !== null && !this.rpc.closed;
    this.stopping = true;
    if (graceful && this.rpc) {
      try {
        await this.rpc.call('engine.shutdown', {}, { timeoutMs: SHUTDOWN_CALL_TIMEOUT_MS });
      } catch (error) {
        this.log.warn('engine.shutdown failed; killing the processes', { error: String(error) });
      }
      await this.waitForExit(EXIT_GRACE_MS);
    }
    await this.killProcesses();
    this.rpc?.close('instance disposed');
    if (this.state !== 'crashed') this.state = 'stopped';
    this.emitExit({ code: this.officeExitCode, crashed: false });
  }

  private async waitForExit(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !(exited(this.office) && exited(this.bridge))) await delay(50);
  }

  /**
   * Kills launcher trees that are still running, then orphaned children (checked by image name).
   * `imageDir` limits the walk to processes of the engine's program folder, so programs LibreOffice
   * opened for the user (e.g. a browser for a hyperlink) survive.
   */
  private killTree(pid: number): Promise<void> {
    return this.guard
      .killTree(pid, { imageDir: this.config.paths.programDir, timeoutMs: KILL_TIMEOUT_MS })
      .catch((error: unknown) => this.log.warn('killTree failed', { pid, error: String(error) }));
  }

  private async killProcesses(): Promise<void> {
    const kills: Promise<void>[] = [];
    for (const child of [this.bridge, this.office]) {
      if (child?.pid && !exited(child)) kills.push(this.killTree(child.pid));
    }
    await Promise.all(kills);
    const orphans: Array<[number | undefined, RegExp]> = [
      [this.officePid, /^soffice\.bin$/i],
      [this.bridgePid, /^python(\.exe)?$/i],
    ];
    for (const [pid, image] of orphans) {
      if (!pid || !isAlive(pid)) continue;
      const name = await processImageName(pid);
      if (name && image.test(name)) {
        await this.killTree(pid);
      }
    }
  }
}
