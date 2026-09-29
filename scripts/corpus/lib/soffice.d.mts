/** Types of soffice.mjs (headless LibreOffice runner). */

export declare const DEFAULT_TIMEOUT_MS: number;

export declare function findProgramDir(opts?: { explicit?: string; repoRoot?: string; env?: NodeJS.ProcessEnv }): string | null;
export declare function engineVersion(programDir: string): string | null;
export declare function profileXcu(opts?: { locale?: string }): string;
export declare function sofficeEnv(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function convertArgs(opts: { profileUrl: string; target: string; outDir: string; inputs: string[] }): string[];
export declare function expectedOutputPath(input: string, target: string, outDir: string): string;
export declare function killProcessTree(pid: number | undefined): Promise<void>;
export declare function findProfileProcesses(profileDir: string): Promise<Array<{ pid: number; name: string }>>;
export declare function convertTarget(ext: string, filter?: string, options?: string | Record<string, unknown> | null): string;
export declare function pdfFilterData(extra?: Record<string, string | number | boolean>): Record<string, { type: string; value: string }>;

export declare class SofficeTimeoutError extends Error {}
export declare class SofficeConversionError extends Error {
  readonly output: string;
}

export interface SofficeRunnerOptions {
  programDir: string;
  workDir: string;
  locale?: string;
  timeoutMs?: number;
  name?: string;
}

export declare class SofficeRunner {
  constructor(opts: SofficeRunnerOptions);
  readonly programDir: string;
  readonly locale: string;
  readonly timeoutMs: number;
  readonly profileDir: string;
  readonly profileUrl: string;
  convert(inputs: string | string[], target: string, opts: { outDir: string; timeoutMs?: number }): Promise<string[]>;
  killLeftovers(): Promise<void>;
  leftovers(): Promise<Array<{ pid: number; name: string }>>;
  dispose(opts?: { keepProfile?: boolean }): Promise<void>;
}
