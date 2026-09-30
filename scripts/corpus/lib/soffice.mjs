/**
 * Headless LibreOffice runner for conversions without the engine bridge (corpus generation and tests).
 *
 * - Every runner owns a private, pre-seeded profile (`-env:UserInstallation`), which also gives it its own
 *   single-instance pipe, so runners never talk to another LibreOffice (or to the app's instances).
 * - Conversions of one runner are serialised (one soffice process tree at a time per profile).
 * - Every invocation has a timeout; on timeout the whole process tree is killed (soffice.exe → soffice.bin).
 * - `dispose()` kills anything still running with this profile and deletes the profile.
 *
 * Findings behind the profile settings (LibreOffice 26.8.0.3, Windows 11, see docs/dev/testing-corpus.md):
 * - With a Turkish UI language (`ooLocale=tr`) soffice.bin hits an invalid-CRT-parameter crash (0xC000000D)
 *   during headless start-up and then hangs; the UI language is therefore always en-US here. The document /
 *   system locale is independent and may be tr-TR.
 * - Automatic spell/grammar checking loads the Python Lightproof checkers and made some starts take 25–40 s;
 *   with IsSpellAuto=false and OpenCL disabled a conversion takes ~3 s.
 */
import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const IS_WINDOWS = process.platform === 'win32';
const EXE = IS_WINDOWS ? 'soffice.exe' : 'soffice';

/** Default timeout of one soffice invocation (first start of a new profile takes ~10 s). */
export const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Locates LibreOffice's `program` directory: explicit argument, then SIMPAPER_ENGINE_DIR (program dir or
 * installation root), then `<repoRoot>/vendor/libreoffice/program`. Returns null when none contains soffice.
 */
export function findProgramDir({ explicit, repoRoot, env = process.env } = {}) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (env.SIMPAPER_ENGINE_DIR) candidates.push(env.SIMPAPER_ENGINE_DIR, join(env.SIMPAPER_ENGINE_DIR, 'program'));
  if (repoRoot) candidates.push(join(repoRoot, 'vendor', 'libreoffice', 'program'));
  for (const dir of candidates) {
    const abs = resolve(dir);
    if (existsSync(join(abs, EXE))) return abs;
  }
  return null;
}

/** Engine version (e.g. "26.8.0.3") from the registry data (`ooSetupVersionAboutBox`); null if unknown. */
export function engineVersion(programDir) {
  try {
    const xcd = readFileSync(join(programDir, '..', 'share', 'registry', 'main.xcd'), 'utf8');
    return /oor:name="ooSetupVersionAboutBox"><value>([\d.]+)</.exec(xcd)?.[1] ?? null;
  } catch {
    return null;
  }
}

const xcuItem = (path, name, value, type) =>
  `<item oor:path="${path}"><prop oor:name="${name}" oor:op="fuse"${type ? ` oor:type="${type}"` : ''}><value>${value}</value></prop></item>`;

/**
 * registrymodifications.xcu for a conversion profile.
 * @param {{ locale?: string }} [opts] document/system locale (BCP-47), e.g. 'tr-TR'. The UI stays en-US.
 */
export function profileXcu({ locale = 'en-US' } = {}) {
  const items = [
    // UI language forced to English (see header comment); document locale as requested.
    xcuItem('/org.openoffice.Setup/L10N', 'ooLocale', 'en-US'),
    xcuItem('/org.openoffice.Office.Linguistic/General', 'UILocale', 'en-US'),
    xcuItem('/org.openoffice.Setup/L10N', 'ooSetupSystemLocale', locale),
    xcuItem('/org.openoffice.Office.Linguistic/General', 'DefaultLocale', locale),
    // Never migrate the user's own LibreOffice profile into the test profile.
    xcuItem('/org.openoffice.Setup/Office', 'MigrationCompleted', 'true'),
    // Speed and determinism.
    xcuItem('/org.openoffice.Office.Linguistic/SpellChecking', 'IsSpellAuto', 'false'),
    xcuItem('/org.openoffice.Office.Common/Misc', 'UseOpenCL', 'false'),
    xcuItem('/org.openoffice.Office.Common/Misc', 'CrashReport', 'false'),
    xcuItem('/org.openoffice.Office.Common/Misc', 'ShowTipOfTheDay', 'false'),
    // No lock files next to corpus files.
    xcuItem('/org.openoffice.Office.Common/Misc', 'UseDocumentOOoLockFile', 'false'),
    xcuItem('/org.openoffice.Office.Common/Misc', 'UseDocumentSystemFileLocking', 'false'),
    // Macros are never executed.
    xcuItem('/org.openoffice.Office.Common/Security/Scripting', 'MacroSecurityLevel', '3'),
    xcuItem('/org.openoffice.Office.Common/Security/Scripting', 'DisableMacrosExecution', 'true'),
    // Always recalculate on load: cached results written by other tools are never trusted.
    xcuItem('/org.openoffice.Office.Calc/Formula/Load', 'OOXMLRecalcMode', '0'),
    xcuItem('/org.openoffice.Office.Calc/Formula/Load', 'ODFRecalcMode', '0'),
    // No network access (update checks).
    xcuItem("/org.openoffice.Office.Jobs/Jobs/org.openoffice.Office.Jobs:Job['UpdateCheck']/Arguments", 'AutoCheckEnabled', 'false', 'xs:boolean'),
    xcuItem('/org.openoffice.Office.Common/Save/Document', 'WarnAlienFormat', 'false'),
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    ...items,
    '</oor:items>',
    '',
  ].join('\n');
}

/** Environment for soffice: no Electron/UNO/Python leaks from the caller, no OpenCL probing, no migration. */
export function sofficeEnv(base = process.env) {
  const env = { ...base };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'UNO_PATH', 'URE_BOOTSTRAP', 'PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP']) delete env[key];
  env.SAL_DISABLE_OPENCL = '1';
  env.SAL_DISABLE_USERMIGRATION = '1';
  return env;
}

/** Command-line arguments of one `--convert-to` invocation. */
export function convertArgs({ profileUrl, target, outDir, inputs }) {
  return [
    `-env:UserInstallation=${profileUrl}`,
    '--headless',
    '--invisible',
    '--nologo',
    '--nodefault',
    '--norestore',
    '--nolockcheck',
    '--convert-to',
    target,
    '--outdir',
    outDir,
    ...inputs,
  ];
}

/** Output file LibreOffice writes for `input` and a `--convert-to` target (`ext[:filter[:options]]`). */
export function expectedOutputPath(input, target, outDir) {
  const ext = target.split(':', 1)[0];
  return join(outDir, `${basename(input, extname(input))}.${ext}`);
}

function run(cmd, args) {
  return new Promise((resolvePromise) => {
    execFile(cmd, args, { windowsHide: true, timeout: 60_000, encoding: 'utf8' }, (error, stdout, stderr) =>
      resolvePromise({ error, stdout: String(stdout), stderr: String(stderr) }),
    );
  });
}

/** Kills a process and all of its descendants. */
export async function killProcessTree(pid) {
  if (!pid) return;
  if (IS_WINDOWS) {
    await run('taskkill', ['/PID', String(pid), '/T', '/F']);
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
}

/**
 * Processes (soffice launcher / soffice.bin) whose command line references `profileDir`.
 * Used to prove that nothing outlives a runner and to clean up orphans after a killed launcher.
 * @returns {Promise<Array<{ pid: number, name: string }>>}
 */
export async function findProfileProcesses(profileDir) {
  const needle = pathToFileURL(profileDir).href.toLowerCase();
  if (IS_WINDOWS) {
    const script =
      "Get-CimInstance Win32_Process -Filter \"Name='soffice.bin' OR Name='soffice.exe' OR Name='soffice.com'\" | " +
      'ForEach-Object { "$($_.ProcessId)`t$($_.Name)`t$($_.CommandLine)" }';
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.split('\t'))
      .filter((cols) => cols.length >= 3 && cols.slice(2).join('\t').toLowerCase().includes(needle))
      .map((cols) => ({ pid: Number(cols[0]), name: String(cols[1]) }));
  }
  const { stdout } = await run('ps', ['-eo', 'pid=,comm=,args=']);
  return stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 3 && cols.slice(2).join(' ').toLowerCase().includes(needle))
    .map((cols) => ({ pid: Number(cols[0]), name: String(cols[1]) }));
}

export class SofficeTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SofficeTimeoutError';
  }
}

export class SofficeConversionError extends Error {
  constructor(message, output) {
    super(message);
    this.name = 'SofficeConversionError';
    this.output = output;
  }
}

/**
 * One isolated headless LibreOffice "installation" (profile) that runs conversions sequentially.
 */
export class SofficeRunner {
  /**
   * @param {{ programDir: string, workDir: string, locale?: string, timeoutMs?: number, name?: string }} opts
   */
  constructor({ programDir, workDir, locale = 'en-US', timeoutMs = DEFAULT_TIMEOUT_MS, name = 'soffice' }) {
    if (!programDir || !existsSync(join(programDir, EXE))) throw new Error(`LibreOffice not found in ${programDir}`);
    this.programDir = programDir;
    this.locale = locale;
    this.timeoutMs = timeoutMs;
    this.profileDir = join(resolve(workDir), `${name}-${process.pid}-${randomBytes(4).toString('hex')}`);
    this.profileUrl = pathToFileURL(this.profileDir).href;
    this.queue = Promise.resolve();
    this.active = new Set();
    this.disposed = false;
    mkdirSync(join(this.profileDir, 'user'), { recursive: true });
    writeFileSync(join(this.profileDir, 'user', 'registrymodifications.xcu'), profileXcu({ locale }), 'utf8');
  }

  /**
   * Converts `inputs` (all of the same document kind) to `target` (`ext[:filter[:options]]`).
   * Existing outputs are replaced. Resolves with the output paths in input order.
   * @param {string | string[]} inputs
   * @param {string} target
   * @param {{ outDir: string, timeoutMs?: number }} opts
   * @returns {Promise<string[]>}
   */
  convert(inputs, target, { outDir, timeoutMs } = {}) {
    const list = (Array.isArray(inputs) ? inputs : [inputs]).map((p) => resolve(p));
    if (!outDir) throw new Error('outDir is required');
    const job = this.queue.then(() => this.#convertNow(list, target, resolve(outDir), timeoutMs ?? this.timeoutMs));
    this.queue = job.catch(() => undefined);
    return job;
  }

  async #convertNow(inputs, target, outDir, timeoutMs) {
    if (this.disposed) throw new Error('runner disposed');
    mkdirSync(outDir, { recursive: true });
    for (const input of inputs) if (!existsSync(input)) throw new Error(`input missing: ${input}`);
    const outputs = inputs.map((input) => expectedOutputPath(input, target, outDir));
    for (const out of outputs) rmSync(out, { force: true });

    const args = convertArgs({ profileUrl: this.profileUrl, target, outDir, inputs });
    const started = Date.now();
    const child = spawn(join(this.programDir, EXE), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: !IS_WINDOWS,
      env: sofficeEnv(),
    });
    this.active.add(child);
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));

    let timedOut = false;
    const exit = await new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        timedOut = true;
        void killProcessTree(child.pid);
      }, timeoutMs);
      child.on('error', (error) => {
        clearTimeout(timer);
        resolvePromise({ code: null, error });
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolvePromise({ code });
      });
    });
    this.active.delete(child);

    if (timedOut) {
      await this.killLeftovers();
      throw new SofficeTimeoutError(`soffice timed out after ${timeoutMs} ms (${target}; ${inputs.map((i) => basename(i)).join(', ')})`);
    }
    if (exit.error) throw exit.error;
    // Exporting one specific sheet to CSV appends the sheet name: "<name>-<Sheet>.csv".
    if (inputs.length === 1 && !existsSync(outputs[0])) {
      const ext = extname(outputs[0]);
      const prefix = `${basename(outputs[0], ext)}-`;
      const renamed = readdirSync(outDir).filter((f) => f.startsWith(prefix) && f.endsWith(ext) && statSync(join(outDir, f)).mtimeMs >= started - 2000);
      if (renamed.length === 1) outputs[0] = join(outDir, renamed[0]);
    }
    const missing = outputs.filter((out) => !existsSync(out) || statSync(out).size === 0);
    if (missing.length > 0) {
      throw new SofficeConversionError(
        `soffice produced no output for ${missing.map((m) => basename(m)).join(', ')} (exit ${exit.code}, target ${target}): ${output.trim()}`,
        output,
      );
    }
    return outputs;
  }

  /** Kills every process still using this runner's profile (normally none). */
  async killLeftovers() {
    for (const child of this.active) await killProcessTree(child.pid);
    for (const proc of await findProfileProcesses(this.profileDir)) await killProcessTree(proc.pid);
  }

  /** Processes still using this runner's profile. */
  leftovers() {
    return findProfileProcesses(this.profileDir);
  }

  /** Waits for queued work, kills leftovers and deletes the profile (best effort). */
  async dispose({ keepProfile = false } = {}) {
    if (this.disposed) return;
    await this.queue;
    this.disposed = true;
    await this.killLeftovers();
    if (!keepProfile) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          rmSync(this.profileDir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
  }
}

/** Builds a `--convert-to` target string. `options` may be a FilterOptions string or JSON filter data. */
export function convertTarget(ext, filter, options) {
  if (!filter) return ext;
  if (options === undefined || options === null || options === '') return `${ext}:${filter}`;
  const opts = typeof options === 'string' ? options : JSON.stringify(options);
  return `${ext}:${filter}:${opts}`;
}

/**
 * JSON filter data (LibreOffice ≥ 7.4 command-line syntax) for a deterministic PDF export:
 * lossless images and embedded standard fonts, so renders do not depend on the viewer's font fallback.
 */
export function pdfFilterData(extra = {}) {
  const data = {
    UseLosslessCompression: { type: 'boolean', value: 'true' },
    EmbedStandardFonts: { type: 'boolean', value: 'true' },
    ExportNotesPages: { type: 'boolean', value: 'false' },
    ReduceImageResolution: { type: 'boolean', value: 'false' },
  };
  for (const [key, value] of Object.entries(extra)) {
    data[key] = { type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'long' : 'string', value: String(value) };
  }
  return data;
}
