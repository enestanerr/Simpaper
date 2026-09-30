/**
 * Start-up overrides for soffice that keep the unmodified engine stable (docs/dev/engine.md,
 * "Start-up hang"). Nothing in the LibreOffice installation is changed: everything is passed on the
 * command line (`-env:` bootstrap variables override the engine's ini files) or in the environment.
 *
 * 1. No Python interpreter inside soffice.bin. LibreOffice's fundamental.ini registers every service
 *    registry in `program/services` with a directory wildcard:
 *
 *        URE_MORE_SERVICES=<extension registries> <$ORIGIN/services>*
 *
 *    That includes `pyuno.rdb`, the in-process Python loader. We pass the same value with the wildcard
 *    replaced by the explicit list of registries minus the Python ones. Python components (the Lightproof
 *    grammar checkers of the bundled dictionaries, mail-merge e-mail, the Python wizards and Python
 *    macros) then fail to instantiate instead of starting an embedded interpreter. The embedded
 *    interpreter's Py_Initialize calls setlocale(LC_CTYPE, ""), which on Windows 11 with the Turkish
 *    region yields the non-ASCII name "Turkish_Türkiye.utf8" (soffice.bin runs with the UTF-8 code page);
 *    a later std::locale construction then makes the UCRT raise an invalid parameter inside setlocale and
 *    LibreOffice's crash handler deadlocks on the CRT locale lock: soffice.bin hangs for good.
 *    Our bridge runs in its own python.exe process and is not affected.
 * 2. SAL_DISABLE_OPENCL=1: Simpaper never uses OpenCL formula offloading; this keeps GPU driver DLLs out of
 *    soffice.bin even if the profile setting (UseOpenCL=false) were lost.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Registries whose services are implemented in Python (loader and Python script provider). */
export const PYTHON_SERVICE_REGISTRIES: readonly string[] = ['pyuno.rdb', 'scriptproviderforpython.rdb'];

export interface EngineLaunchOptions {
  /** Extra soffice arguments (after the standard ones). */
  args: string[];
  /** Extra environment variables for soffice. */
  env: Record<string, string>;
  /** What was decided, for the log (never contains user data). */
  notes: string[];
}

/** Key/value pairs of the `[Bootstrap]` section of a LibreOffice ini file. */
export function parseBootstrapIni(text: string): Map<string, string> {
  const values = new Map<string, string>();
  let inBootstrap = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      inBootstrap = section[1]?.trim().toLowerCase() === 'bootstrap';
      continue;
    }
    if (!inBootstrap) continue;
    const eq = line.indexOf('=');
    if (eq > 0) values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return values;
}

const SERVICES_WILDCARD = /^(\?)?<\$ORIGIN\/services>\*$/;
const SAFE_FILE = /^[A-Za-z0-9_.-]+\.rdb$/;

function baseName(token: string): string {
  const clean = token.replace(/^\?/, '');
  return clean.slice(clean.lastIndexOf('/') + 1).toLowerCase();
}

/**
 * Rewrites a URE_MORE_SERVICES value so that it no longer contains the Python registries.
 * `servicesDirFiles` are the file names in `program/services`. Returns null when nothing has to change
 * (no Python registry present) or the value has a layout this function does not understand.
 */
export function servicesWithoutPython(
  value: string,
  servicesDirFiles: readonly string[],
  excluded: readonly string[] = PYTHON_SERVICE_REGISTRIES,
): string | null {
  const skip = new Set(excluded.map((name) => name.toLowerCase()));
  const tokens = value.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const out: string[] = [];
  let removed = 0;
  for (const token of tokens) {
    const wildcard = SERVICES_WILDCARD.exec(token);
    if (wildcard) {
      const optional = wildcard[1] ?? '';
      const registries = servicesDirFiles.filter((name) => name.toLowerCase().endsWith('.rdb')).sort();
      // Names that would need quoting in a bootstrap value mean an unknown layout: keep the original.
      if (registries.some((name) => !SAFE_FILE.test(name))) return null;
      for (const name of registries) {
        if (skip.has(name.toLowerCase())) removed++;
        else out.push(`${optional}$ORIGIN/services/${name}`);
      }
      continue;
    }
    if (!token.includes('${') && skip.has(baseName(token))) {
      removed++;
      continue;
    }
    out.push(token);
  }
  return removed > 0 ? out.join(' ') : null;
}

/** Computes the overrides for the engine in `programDir` (reads fundamental.ini and lists program/services). */
export function resolveLaunchOptions(programDir: string, env: NodeJS.ProcessEnv = process.env): EngineLaunchOptions {
  const options: EngineLaunchOptions = { args: [], env: { SAL_DISABLE_OPENCL: '1' }, notes: [] };
  if (env['SIMPAPER_ENGINE_KEEP_PYTHON'] === '1') {
    options.notes.push('in-process Python left enabled (SIMPAPER_ENGINE_KEEP_PYTHON=1, diagnostics only)');
    return options;
  }
  let value: string | undefined;
  let files: string[];
  try {
    value = parseBootstrapIni(readFileSync(join(programDir, 'fundamental.ini'), 'utf8')).get('URE_MORE_SERVICES');
    files = readdirSync(join(programDir, 'services'));
  } catch (error) {
    options.notes.push(`engine layout not recognised (${String((error as Error)?.message ?? error)}); in-process Python stays enabled`);
    return options;
  }
  if (value === undefined) {
    options.notes.push('fundamental.ini has no URE_MORE_SERVICES; in-process Python stays enabled');
    return options;
  }
  const rewritten = servicesWithoutPython(value, files);
  if (rewritten === null) {
    const hasPython = files.some((name) => PYTHON_SERVICE_REGISTRIES.includes(name.toLowerCase()));
    options.notes.push(hasPython ? 'URE_MORE_SERVICES has an unknown layout; in-process Python stays enabled' : 'engine has no in-process Python loader');
    return options;
  }
  options.args.push(`-env:URE_MORE_SERVICES=${rewritten}`);
  options.notes.push('in-process Python disabled (URE_MORE_SERVICES without pyuno.rdb)');
  return options;
}
