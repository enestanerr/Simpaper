/**
 * Contracts of the engine layer (implementation: src/main/engine/*).
 * Process model (docs/adr/0001-engine.md): one soffice.bin + one bridge process per open office
 * document, plus one shared headless instance for conversions and verification.
 */
import type { EngineEvent, EngineMethod, EngineMethods } from '@shared/engine-protocol';

export interface EngineCallOptions {
  /** Default 60 s; loads/stores of large files pass more. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type EngineRole = 'document' | 'conversion';
export type EngineInstanceState = 'starting' | 'ready' | 'busy' | 'crashed' | 'stopped';

export interface EngineInstanceInfo {
  id: string;
  role: EngineRole;
  state: EngineInstanceState;
  officePid?: number;
  bridgePid?: number;
  officeVersion?: string;
  profileDir: string;
  /** Time from spawning soffice to a completed engine.hello handshake. */
  startedInMs?: number;
}

export interface EngineExitInfo {
  code: number | null;
  /** true when the process died without being asked to stop. */
  crashed: boolean;
}

export interface EngineInstance {
  readonly id: string;
  readonly role: EngineRole;
  call<M extends EngineMethod>(method: M, params: EngineMethods[M]['params'], opts?: EngineCallOptions): Promise<EngineMethods[M]['result']>;
  onEvent(listener: (event: EngineEvent) => void): () => void;
  onExit(listener: (info: EngineExitInfo) => void): () => void;
  info(): EngineInstanceInfo;
  /** Graceful XDesktop.terminate, then kills the process tree after a timeout. */
  dispose(): Promise<void>;
}

export interface EngineProbe {
  available: boolean;
  programDir: string | null;
  officeVersion: string | null;
  error?: string;
}

export interface EngineManagerOptions {
  /** Explicit LibreOffice `program` directory (settings.engine.programDir); empty = auto-detect. */
  programDir?: string;
  /** Root for engine user profiles, e.g. %LOCALAPPDATA%/Varak/engine. */
  profilesRoot: string;
  /** UI language / document locale / theme applied to new profiles. */
  uiLanguage: 'tr' | 'en';
  documentLocale: string;
  appearance: 'system' | 'light' | 'dark';
  /** Keep one warm spare document instance to make "open" fast. */
  warmSpare?: boolean;
  /**
   * Start document instances with `--headless` too (tests, batch use). Views must then be `hidden`;
   * `child`/`owned` views need a non-headless instance.
   */
  headless?: boolean;
  /** Time allowed for soffice + bridge to start and answer `engine.hello` (default 120 s; a first start creates the profile). */
  startTimeoutMs?: number;
}

export interface EngineManager {
  probe(): Promise<EngineProbe>;
  acquireDocumentInstance(docId: string): Promise<EngineInstance>;
  getDocumentInstance(docId: string): EngineInstance | undefined;
  releaseDocumentInstance(docId: string): Promise<void>;
  /** Serialised, headless conversion on the shared conversion instance. */
  convert(params: EngineMethods['convert.file']['params'], opts?: EngineCallOptions): Promise<void>;
  /** Applies language/theme changes to profiles used by instances started from now on. */
  updateProfileOptions(opts: Partial<Pick<EngineManagerOptions, 'uiLanguage' | 'documentLocale' | 'appearance' | 'programDir'>>): void;
  dispose(): Promise<void>;
}
