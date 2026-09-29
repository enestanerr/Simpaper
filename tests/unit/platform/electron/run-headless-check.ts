/**
 * Builds headless-check.ts with esbuild and runs it in Electron without any visible window.
 *
 *   node tests/unit/platform/electron/run-headless-check.ts        (Node ≥ 22.18: built-in type stripping)
 *
 * Output goes to test-output/platform/electron-check/ (git-ignored). The Electron process tree is
 * killed after 60 s whatever happens. Exit code 0 when every expectation holds.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const outDir = join(root, 'test-output', 'platform', 'electron-check');
const load = createRequire(import.meta.url);

if (process.platform !== 'win32') {
  console.log('Windows only; skipped.');
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const esbuild = load('esbuild') as typeof import('esbuild');
await esbuild.build({
  entryPoints: [join(here, 'headless-check.ts')],
  outfile: join(outDir, 'main.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['electron', 'koffi', 'pngjs'],
  logLevel: 'warning',
});

const electronExe = load('electron') as string;
const env = { ...process.env };
delete env['ELECTRON_RUN_AS_NODE']; // set by VS Code; would turn Electron into plain Node
const child = spawn(electronExe, [join(outDir, 'main.mjs')], { cwd: outDir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let output = '';
child.stdout.on('data', (d: Buffer) => (output += d.toString()));
child.stderr.on('data', (d: Buffer) => (output += d.toString()));
const killer = setTimeout(() => {
  if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
}, 60_000);
const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
clearTimeout(killer);

const line = /^RESULT (.*)$/m.exec(output)?.[1];
if (!line) {
  console.error(`No result (exit code ${code}). Output:\n${output}`);
  process.exit(1);
}
const r = JSON.parse(line) as Record<string, unknown> & { children?: { inJob: boolean }[] };
const checks: [string, boolean][] = [
  ['platform modules loaded (view host, guard, shell keys)', isDeepStrictEqual(r['platform'], { viewHost: true, guard: true, guardMode: 'self', shellKeys: true })],
  ['app process joined its job (self mode)', r['selfInJob'] === true],
  ['UI thread is per-monitor DPI aware', r['dpiAwarenessMain'] === 2],
  ['koffi worker threads are per-monitor DPI aware (physical coordinates)', r['dpiAwarenessWorker'] === 2],
  ['nativeImage.createFromBitmap takes BGRA', isDeepStrictEqual(r['bgraToRgba'], [255, 0, 0, 255, 0, 0, 255, 255])],
  ['toDataURL produces a PNG data URL', r['dataUrlPrefix'] === 'data:image/png;base64,'],
  ['koffi callback runs from the Electron message loop', Number(r['winEventCallbackHits']) >= 1],
  ['hang detector: UI-thread window responds', r['hangDetectorOnUiThreadWindow'] === true],
  ['Chromium helper processes are inside the job', (r.children ?? []).every((c) => c.inJob)],
  ['new child process is inside the job and killTree ends it', r['spawnedChildInJob'] === true && r['spawnedChildExited'] === true],
  ['no error', r['error'] === undefined],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(JSON.stringify(r, null, 2));
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
