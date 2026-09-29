// Smoke boot of the real app with a hidden main window (never shown) — see docs/dev/main-core.md, "Smoke boot".
//
//   node scripts/smoke-boot.mjs [--kind calc|impress|writer] [--out <build dir>] [--no-build] [--timeout <seconds>]
//
// The app runs from a build: the shared `out/` when it is up to date and contains smoke support, otherwise a
// private build in test-output/main-core/out (electron-vite build --outDir …; the shared out/ is never written).
// Electron gets VARAK_SMOKE=1 (hidden window, headless engine, hidden document views, scripted IPC checks, exit
// code 0/1), an isolated data folder and a report file. Afterwards every process still running from that data
// folder (engine profiles live there) is killed and counted as a failure.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const MARKER = 'VARAK_SMOKE';
const SOURCE_DIRS = ['src/main', 'src/preload', 'src/renderer', 'src/shared'];
const SOURCE_FILES = ['electron.vite.config.ts', 'package.json'];

function parseArgs(argv) {
  const opts = { kind: 'calc', out: null, build: true, timeoutS: 420 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--kind') opts.kind = argv[++i];
    else if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--no-build') opts.build = false;
    else if (a === '--timeout') opts.timeoutS = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('usage: node scripts/smoke-boot.mjs [--kind calc|impress|writer] [--out <build dir>] [--no-build] [--timeout <seconds>]');
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!['calc', 'impress', 'writer'].includes(opts.kind)) throw new Error(`--kind must be calc, impress or writer`);
  if (!Number.isFinite(opts.timeoutS) || opts.timeoutS < 30) throw new Error('--timeout must be at least 30 seconds');
  return opts;
}

function newestMtime(path) {
  let newest = 0;
  const walk = (p) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) if (name !== 'node_modules') walk(join(p, name));
    } else if (st.mtimeMs > newest) newest = st.mtimeMs;
  };
  walk(path);
  return newest;
}

/** A build is usable when its main bundle has smoke support and nothing in the sources is newer. */
function buildState(dir) {
  const main = join(dir, 'main', 'index.js');
  const page = join(dir, 'renderer', 'index.html');
  const preload = join(dir, 'preload', 'index.cjs');
  if (![main, page, preload].every((p) => existsSync(p))) return { usable: false, reason: 'incomplete build' };
  if (!readFileSync(main, 'utf8').includes(MARKER)) return { usable: false, reason: 'built before smoke support existed' };
  const built = Math.min(statSync(main).mtimeMs, statSync(page).mtimeMs, statSync(preload).mtimeMs);
  const sources = Math.max(...SOURCE_DIRS.map((d) => newestMtime(join(root, d))), ...SOURCE_FILES.map((f) => newestMtime(join(root, f))));
  if (sources > built) return { usable: false, reason: 'sources changed after the build' };
  return { usable: true, reason: 'up to date' };
}

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  // Editors built on Electron export this; it would make Electron behave like plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function run(cmd, args, opts) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { ...opts, windowsHide: true });
    child.on('exit', (code, signal) => resolveRun({ code, signal }));
    child.on('error', (error) => resolveRun({ code: -1, signal: null, error }));
  });
}

async function buildInto(dir) {
  const bin = join(dirname(require.resolve('electron-vite/package.json')), 'bin', 'electron-vite.js');
  console.log(`[smoke] building into ${dir} (electron-vite build --outDir; the shared out/ is not touched)`);
  const res = await run(process.execPath, [bin, 'build', '--outDir', dir, '--logLevel', 'warn'], { cwd: root, env: cleanEnv(), stdio: 'inherit' });
  if (res.code !== 0) throw new Error(`electron-vite build failed (${res.code ?? res.signal})`);
}

/** Processes whose command line contains `token` (Windows), as `{ pid, name }`. */
function processesMatching(token) {
  if (process.platform !== 'win32') return Promise.resolve([]);
  // `$PID`: the PowerShell process running this query has the token in its own command line.
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('${token.replace(/'/g, "''")}') } | ForEach-Object { "$($_.ProcessId)|$($_.Name)" }`;
  return new Promise((resolvePids) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 60_000 }, (error, stdout) => {
      if (error) return resolvePids([]);
      const out = [];
      for (const line of stdout.split(/\r?\n/)) {
        const [pid, name] = line.trim().split('|');
        const n = Number(pid);
        if (Number.isInteger(n) && n > 0 && n !== process.pid) out.push({ pid: n, name: name ?? '' });
      }
      resolvePids(out);
    });
  });
}

function killTree(pid) {
  return new Promise((resolveKill) => {
    if (process.platform !== 'win32') {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // gone
      }
      return resolveKill();
    }
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 30_000 }, () => resolveKill());
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const privateOut = join(root, 'test-output', 'main-core', 'out');
  let buildDir = opts.out;
  if (buildDir) {
    const state = buildState(buildDir);
    if (!state.usable) throw new Error(`${buildDir}: ${state.reason}`);
  } else {
    const shared = buildState(join(root, 'out'));
    if (shared.usable) buildDir = join(root, 'out');
    else {
      console.log(`[smoke] out/ not used: ${shared.reason}`);
      const own = buildState(privateOut);
      if (!own.usable) {
        if (!opts.build) throw new Error(`no usable build (${own.reason}); run without --no-build or run the shared build first`);
        await buildInto(privateOut);
        const after = buildState(privateOut);
        if (!after.usable) throw new Error(`build in ${privateOut} is not usable: ${after.reason}`);
      }
      buildDir = privateOut;
    }
  }

  const smokeDir = join(root, 'test-output', 'main-core', 'smoke');
  const dataDir = join(smokeDir, `data-${process.pid}`);
  const report = join(smokeDir, 'report.json');
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(report, { force: true });
  mkdirSync(dataDir, { recursive: true });

  const electron = require('electron');
  if (typeof electron !== 'string') throw new Error('the electron package did not return its executable path');
  const mainFile = join(buildDir, 'main', 'index.js');
  const env = cleanEnv({
    VARAK_SMOKE: '1',
    VARAK_VIEW_MODE: 'hidden',
    VARAK_DATA_DIR: dataDir,
    VARAK_SMOKE_REPORT: report,
    VARAK_SMOKE_KIND: opts.kind,
  });
  delete env.ELECTRON_RENDERER_URL;
  console.log(`[smoke] starting Electron (hidden window) with ${mainFile}`);
  const started = Date.now();
  const child = spawn(electron, [mainFile], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const prefix = (stream, label) => {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.trim()) console.log(`[${label}] ${line}`);
      }
    });
  };
  prefix(child.stdout, 'app');
  prefix(child.stderr, 'app:err');
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.log(`[smoke] timed out after ${opts.timeoutS} s; killing the app`);
    if (child.pid) void killTree(child.pid);
  }, opts.timeoutS * 1000);
  const exit = await new Promise((resolveExit) => child.on('exit', (code, signal) => resolveExit({ code, signal })));
  clearTimeout(timer);
  console.log(`[smoke] app exited with ${exit.code ?? exit.signal} after ${Math.round((Date.now() - started) / 1000)} s`);

  // Engine processes run with profiles under the data folder: none may survive the app.
  await new Promise((r) => setTimeout(r, 1500));
  const left = await processesMatching(`data-${process.pid}`);
  for (const p of left) await killTree(p.pid);
  if (left.length) console.log(`[smoke] FAIL: ${left.length} process(es) outlived the app and were killed: ${left.map((p) => `${p.pid} ${p.name}`).join(', ')}`);

  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(report, 'utf8'));
  } catch {
    console.log('[smoke] FAIL: no report was written');
  }
  const ok = !timedOut && exit.code === 0 && parsed?.ok === true && left.length === 0;
  console.log(`[smoke] ${ok ? 'PASSED' : 'FAILED'} (report: ${report})`);
  if (ok) rmSync(dataDir, { recursive: true, force: true });
  else console.log(`[smoke] data folder kept for inspection (logs in ${join(dataDir, 'Varak-dev', 'logs')})`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`[smoke] error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
