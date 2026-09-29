/**
 * Finds the LibreOffice program directory, the bridge package and the profile template.
 *
 * Program directory, in this order:
 *   explicit option (settings.engine.programDir) → env VARAK_ENGINE_DIR →
 *   packaged `<resources>/engine/program` → development `<repo>/vendor/libreoffice/program`.
 * Bridge: packaged `<resources>/bridge`, development `<repo>/engine/bridge`.
 * Profile template: packaged `<resources>/profile`, development `<repo>/engine/profile`.
 *
 * Works in plain Node (Vitest), where `process.resourcesPath` is undefined.
 */
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface EnginePaths {
  programDir: string;
  sofficeExe: string;
  /** LibreOffice's Python launcher (spawns the bundled interpreter). */
  pythonExe: string;
  /** Directory that contains the `varak_bridge` package (goes on PYTHONPATH). */
  bridgeDir: string;
  /** Directory with registrymodifications.xcu.template and accelerators.json. */
  profileTemplateDir: string;
}

export interface LocateOptions {
  programDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Electron's process.resourcesPath (undefined outside a packaged app). */
  resourcesPath?: string;
  /** Directories to start the upward search for the repository root from. */
  searchFrom?: string[];
  platform?: NodeJS.Platform;
}

export type LocateResult = { ok: true; paths: EnginePaths } | { ok: false; error: string; tried: string[] };

export const ENGINE_DIR_ENV = 'VARAK_ENGINE_DIR';
const BRIDGE_MARKER = join('varak_bridge', '__init__.py');
const TEMPLATE_MARKER = 'registrymodifications.xcu.template';

function executables(platform: NodeJS.Platform): { soffice: string; python: string } {
  return platform === 'win32' ? { soffice: 'soffice.exe', python: 'python.exe' } : { soffice: 'soffice', python: 'python' };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Electron adds `resourcesPath` to `process`; it is absent in plain Node. */
export function electronResourcesPath(): string | undefined {
  const value = (process as { resourcesPath?: unknown }).resourcesPath;
  return typeof value === 'string' && value ? value : undefined;
}

/** Walks up from each start directory looking for the repository (identified by engine/bridge). */
export function findRepoRoot(starts: readonly string[]): string | null {
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 8; i++) {
      if (isFile(join(dir, 'engine', 'bridge', BRIDGE_MARKER))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function defaultSearchFrom(): string[] {
  const here = typeof import.meta.dirname === 'string' ? [import.meta.dirname] : [];
  return [...here, process.cwd()];
}

export function locateEngine(opts: LocateOptions = {}): LocateResult {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const resources = opts.resourcesPath ?? electronResourcesPath();
  const repo = findRepoRoot(opts.searchFrom ?? defaultSearchFrom());
  const exe = executables(platform);

  const programCandidates: string[] = [];
  const explicit = opts.programDir?.trim();
  if (explicit) programCandidates.push(explicit);
  const fromEnv = env[ENGINE_DIR_ENV]?.trim();
  if (fromEnv) programCandidates.push(fromEnv);
  if (resources) programCandidates.push(join(resources, 'engine', 'program'));
  if (repo) programCandidates.push(join(repo, 'vendor', 'libreoffice', 'program'));

  const tried: string[] = [];
  let programDir: string | null = null;
  for (const candidate of programCandidates) {
    const dir = resolve(candidate);
    tried.push(dir);
    if (isFile(join(dir, exe.soffice)) && isFile(join(dir, exe.python))) {
      programDir = dir;
      break;
    }
    // An explicit setting that does not work must not silently fall back to another engine.
    if (explicit && candidate === explicit) {
      return { ok: false, error: `No ${exe.soffice} and ${exe.python} in the configured engine directory ${dir}`, tried };
    }
  }
  if (!programDir) return { ok: false, error: 'LibreOffice engine not found', tried };

  const bridgeCandidates = [resources && join(resources, 'bridge'), repo && join(repo, 'engine', 'bridge')].filter(Boolean) as string[];
  const bridgeDir = bridgeCandidates.find((d) => isFile(join(d, BRIDGE_MARKER)));
  if (!bridgeDir) return { ok: false, error: 'Engine bridge (varak_bridge) not found', tried: [...tried, ...bridgeCandidates] };

  const templateCandidates = [resources && join(resources, 'profile'), repo && join(repo, 'engine', 'profile')].filter(Boolean) as string[];
  const profileTemplateDir = templateCandidates.find((d) => isFile(join(d, TEMPLATE_MARKER)));
  if (!profileTemplateDir) return { ok: false, error: 'Engine profile template not found', tried: [...tried, ...templateCandidates] };

  return {
    ok: true,
    paths: {
      programDir,
      sofficeExe: join(programDir, exe.soffice),
      pythonExe: join(programDir, exe.python),
      bridgeDir: resolve(bridgeDir),
      profileTemplateDir: resolve(profileTemplateDir),
    },
  };
}
