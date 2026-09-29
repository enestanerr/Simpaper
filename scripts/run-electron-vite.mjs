// Runs electron-vite with a clean environment.
// Editors built on Electron (VS Code, Cursor, ...) export ELECTRON_RUN_AS_NODE=1 to child processes,
// which makes Electron behave like plain Node.js and breaks `require('electron')`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('electron-vite/package.json'));
const bin = join(pkgDir, 'bin', 'electron-vite.js');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
