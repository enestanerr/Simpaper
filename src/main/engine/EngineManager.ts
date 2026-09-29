/**
 * Process model (docs/ARCHITECTURE.md): one engine instance per open office document, an optional
 * warm spare to make "open" fast, and one serialised headless instance for conversions.
 */
import { RPC_ERROR, type EngineMethods } from '@shared/engine-protocol';
import type { Logger } from '../log';
import type { ProcessGuard } from '../platform/types';
import { EngineStartError, OfficeInstance } from './EngineInstance';
import { resolveLaunchOptions, type EngineLaunchOptions } from './launch';
import { locateEngine, type EnginePaths } from './locate';
import { ProfileStore, type ProfileSettings } from './profiles';
import { EngineRpcError, isEngineRpcError } from './rpc';
import type { EngineCallOptions, EngineInstance, EngineManager, EngineManagerOptions, EngineProbe, EngineRole } from './types';
import { readPeFileVersion } from './version';

export const DEFAULT_START_TIMEOUT_MS = 120_000;
export const DEFAULT_CONVERT_TIMEOUT_MS = 300_000;
const START_ATTEMPTS = 2;

export interface EngineManagerDeps {
  processGuard: ProcessGuard;
  log: Logger;
}

function isLive(instance: EngineInstance): boolean {
  const { state } = instance.info();
  return state === 'ready' || state === 'busy';
}

function unavailable(message: string): EngineRpcError {
  return new EngineRpcError(RPC_ERROR.ENGINE_UNAVAILABLE, message);
}

/** The engine.programDir setting as locateEngine uses it: '' and blanks mean auto-detect, like no setting. */
function programDirSetting(dir: string | undefined): string | undefined {
  const trimmed = dir?.trim();
  return trimmed ? trimmed : undefined;
}

type ProfileOptions = Partial<Pick<EngineManagerOptions, 'uiLanguage' | 'documentLocale' | 'appearance' | 'programDir'>>;

export class DefaultEngineManager implements EngineManager {
  private opts: EngineManagerOptions;
  private readonly log: Logger;
  private readonly guard: ProcessGuard;
  private paths: EnginePaths | null = null;
  private launch: EngineLaunchOptions | null = null;
  private profiles: ProfileStore | null = null;
  private probeResult: Promise<EngineProbe> | null = null;
  private readonly documents = new Map<string, EngineInstance>();
  private readonly acquiring = new Map<string, Promise<EngineInstance>>();
  private readonly running = new Set<OfficeInstance>();
  private spare: Promise<OfficeInstance | null> | null = null;
  private conversion: OfficeInstance | null = null;
  private conversionStarting: Promise<OfficeInstance> | null = null;
  private conversionQueue: Promise<unknown> = Promise.resolve();
  private counter = 0;
  private disposed = false;
  private disposal: Promise<void> | null = null;

  constructor(opts: EngineManagerOptions, deps: EngineManagerDeps) {
    const { programDir, ...rest } = opts;
    const dir = programDirSetting(programDir);
    this.opts = dir ? { ...rest, programDir: dir } : rest;
    this.log = deps.log;
    this.guard = deps.processGuard;
    if (opts.warmSpare) setTimeout(() => this.ensureSpare(), 0).unref();
  }

  // ---------------------------------------------------------------- paths & profiles
  private resolvePaths(): EnginePaths {
    if (this.paths) return this.paths;
    const located = locateEngine({ programDir: this.opts.programDir });
    if (!located.ok) throw unavailable(`${located.error} (searched: ${located.tried.join(', ')})`);
    this.paths = located.paths;
    this.launch = resolveLaunchOptions(located.paths.programDir);
    for (const note of this.launch.notes) this.log.info(`engine start-up: ${note}`);
    return this.paths;
  }

  private profileStore(paths: EnginePaths): ProfileStore {
    this.profiles ??= new ProfileStore(this.opts.profilesRoot, paths.profileTemplateDir);
    return this.profiles;
  }

  private settings(): ProfileSettings {
    return { uiLanguage: this.opts.uiLanguage, documentLocale: this.opts.documentLocale, appearance: this.opts.appearance };
  }

  private async startInstance(role: EngineRole, headless: boolean): Promise<OfficeInstance> {
    const paths = this.resolvePaths();
    const profiles = this.profileStore(paths);
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= START_ATTEMPTS && !this.disposed; attempt++) {
      const slot = profiles.acquire(role === 'conversion' ? 'conversion' : 'document');
      try {
        await profiles.prepare(slot, this.settings());
        const instance = await OfficeInstance.start(
          {
            id: `${role === 'conversion' ? 'conv' : 'doc'}-${++this.counter}`,
            role,
            paths,
            profileDir: slot.dir,
            headless,
            startTimeoutMs: this.opts.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS,
            ...(this.launch ? { launch: this.launch } : {}),
          },
          { processGuard: this.guard, log: this.log },
        );
        this.running.add(instance);
        instance.onExit(() => {
          this.running.delete(instance);
          slot.release();
        });
        return instance;
      } catch (error) {
        slot.release();
        lastError = error;
        // Exit code 0 right after start: another soffice owns this profile and took our request.
        if (error instanceof EngineStartError && error.exitCode === 0) profiles.retire(slot.name);
        this.log.warn('engine start failed', { role, attempt, slot: slot.name, error: String((error as Error)?.message ?? error) });
      }
    }
    if (this.disposed) throw unavailable('engine manager disposed');
    throw lastError instanceof Error ? lastError : new EngineStartError('engine start failed');
  }

  // ---------------------------------------------------------------- EngineManager
  probe(): Promise<EngineProbe> {
    this.probeResult ??= (async (): Promise<EngineProbe> => {
      const located = locateEngine({ programDir: this.opts.programDir });
      if (!located.ok) return { available: false, programDir: null, officeVersion: null, error: located.error };
      const officeVersion = await readPeFileVersion(located.paths.sofficeExe);
      return { available: true, programDir: located.paths.programDir, officeVersion };
    })();
    return this.probeResult;
  }

  acquireDocumentInstance(docId: string): Promise<EngineInstance> {
    if (this.disposed) return Promise.reject(unavailable('engine manager disposed'));
    const existing = this.documents.get(docId);
    if (existing && isLive(existing)) return Promise.resolve(existing);
    const pending = this.acquiring.get(docId);
    if (pending) return pending;
    const promise = (async () => {
      const instance = (await this.takeSpare()) ?? (await this.startInstance('document', this.opts.headless ?? false));
      if (this.disposed) {
        await instance.dispose();
        throw unavailable('engine manager disposed');
      }
      this.documents.set(docId, instance);
      this.ensureSpare();
      return instance;
    })();
    this.acquiring.set(docId, promise);
    const clear = (): void => {
      if (this.acquiring.get(docId) === promise) this.acquiring.delete(docId);
    };
    promise.then(clear, clear);
    return promise;
  }

  getDocumentInstance(docId: string): EngineInstance | undefined {
    return this.documents.get(docId);
  }

  async releaseDocumentInstance(docId: string): Promise<void> {
    const pending = this.acquiring.get(docId);
    if (pending) await pending.catch(() => undefined);
    const instance = this.documents.get(docId);
    if (!instance) return;
    this.documents.delete(docId);
    await instance.dispose();
  }

  convert(params: EngineMethods['convert.file']['params'], opts: EngineCallOptions = {}): Promise<void> {
    const run = async (): Promise<void> => {
      for (let attempt = 1; ; attempt++) {
        if (this.disposed) throw unavailable('engine manager disposed');
        const instance = await this.conversionInstance();
        try {
          await instance.call('convert.file', params, { timeoutMs: opts.timeoutMs ?? DEFAULT_CONVERT_TIMEOUT_MS, signal: opts.signal });
          return;
        } catch (error) {
          if (isEngineRpcError(error, RPC_ERROR.TIMEOUT) || isEngineRpcError(error, RPC_ERROR.BUSY)) {
            // The instance may still be working on the abandoned conversion: replace it.
            this.dropConversionInstance(instance);
          }
          if (attempt === 1 && isEngineRpcError(error, RPC_ERROR.ENGINE_UNAVAILABLE) && !this.disposed) {
            this.log.warn('conversion instance lost; retrying once on a new instance');
            this.dropConversionInstance(instance);
            continue;
          }
          throw error;
        }
      }
    };
    const result = this.conversionQueue.then(run, run);
    this.conversionQueue = result.catch(() => undefined);
    return result;
  }

  /**
   * Language/theme changes apply to instances started from now on; the idle spare and conversion instance
   * are replaced. A changed program folder is applied lazily and never starts a process by itself
   * (docs/dev/engine.md §7): the old idle helpers end, and the new folder is used by the next instance a
   * request needs (the app passes the setting at start-up; the renderer cannot change it).
   * The ProfileStore is always kept: slots do not depend on the program folder, and its used/retired sets
   * are what keeps new instances off the profiles of instances that are still running.
   */
  updateProfileOptions(opts: ProfileOptions): void {
    const programDir = programDirSetting(opts.programDir === undefined ? this.opts.programDir : opts.programDir);
    const programChanged = programDir !== this.opts.programDir;
    const settingsChanged =
      (opts.uiLanguage !== undefined && opts.uiLanguage !== this.opts.uiLanguage) ||
      (opts.documentLocale !== undefined && opts.documentLocale !== this.opts.documentLocale) ||
      (opts.appearance !== undefined && opts.appearance !== this.opts.appearance);
    if (!programChanged && !settingsChanged) return;
    const { programDir: _previous, ...rest } = this.opts;
    this.opts = {
      ...rest,
      ...(opts.uiLanguage !== undefined ? { uiLanguage: opts.uiLanguage } : {}),
      ...(opts.documentLocale !== undefined ? { documentLocale: opts.documentLocale } : {}),
      ...(opts.appearance !== undefined ? { appearance: opts.appearance } : {}),
      ...(programDir ? { programDir } : {}),
    };
    if (programChanged) {
      this.log.info('engine program folder changed; used by instances started from now on', { programDir: programDir ?? '(auto-detect)' });
      this.paths = null;
      this.launch = null;
      this.probeResult = null;
    }
    // Idle helpers were started with the old settings (or engine): replace them.
    const spare = this.spare;
    this.spare = null;
    if (spare) void spare.then((instance) => instance?.dispose());
    if (this.conversion) {
      const old = this.conversion;
      this.conversion = null;
      this.conversionQueue = this.conversionQueue.then(() => old.dispose());
    }
    if (!programChanged) this.ensureSpare();
  }

  dispose(): Promise<void> {
    this.disposal ??= (async () => {
      this.disposed = true;
      await Promise.allSettled([...this.acquiring.values(), this.spare, this.conversionStarting].filter(Boolean));
      await Promise.allSettled([...this.running].map((instance) => instance.dispose()));
      this.documents.clear();
      this.spare = null;
      this.conversion = null;
    })();
    return this.disposal;
  }

  // ---------------------------------------------------------------- spare & conversion
  private ensureSpare(): void {
    if (!this.opts.warmSpare || this.disposed || this.spare) return;
    const spare: Promise<OfficeInstance | null> = this.startInstance('document', this.opts.headless ?? false).then(
      (instance) => {
        instance.onExit(() => {
          if (this.spare === spare) this.spare = null;
        });
        return instance;
      },
      (error: unknown) => {
        this.log.warn('warm spare engine could not be started', { error: String((error as Error)?.message ?? error) });
        if (this.spare === spare) this.spare = null;
        return null;
      },
    );
    this.spare = spare;
  }

  private async takeSpare(): Promise<OfficeInstance | null> {
    const spare = this.spare;
    if (!spare) return null;
    this.spare = null;
    const instance = await spare;
    return instance && isLive(instance) ? instance : null;
  }

  private async conversionInstance(): Promise<OfficeInstance> {
    if (this.conversion && isLive(this.conversion)) return this.conversion;
    this.conversion = null;
    this.conversionStarting ??= this.startInstance('conversion', true).finally(() => {
      this.conversionStarting = null;
    });
    const instance = await this.conversionStarting;
    this.conversion = instance;
    return instance;
  }

  private dropConversionInstance(instance: OfficeInstance): void {
    if (this.conversion === instance) this.conversion = null;
    void instance.dispose();
  }
}
