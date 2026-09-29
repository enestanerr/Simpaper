// Shared launcher and helpers for the GUI scripts (screenshots.mjs; docs/testing/GUI_SPIKE.md §L).
// OPENS WINDOWS AND SENDS INPUT — run only with the machine owner's permission, while nobody uses the PC.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Cdp } from './cdp.mjs';
import * as W from './win32.mjs';

export const repo = resolve(import.meta.dirname, '..', '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Never take over a PC that is in use: exits unless keyboard and mouse have been idle for `needMs`. */
export function requireIdle(needMs, tag) {
  const idle = W.idleMs();
  if (idle >= needMs) return;
  console.error(`[${tag}] keyboard/mouse were used ${Math.round(idle / 1000)} s ago; not starting (needs ${needMs / 1000} s without input)`);
  process.exit(2);
}

/** A complete settings.json (schema v2) for an isolated data folder. */
export function settingsPreset({ language = 'tr', theme = 'light', viewMode = 'child' } = {}) {
  return {
    version: 2,
    language,
    theme,
    autosaveMinutes: 3,
    verifyAfterSave: true,
    recentLimit: 20,
    csv: { importSeparator: 'auto', exportSeparator: 'auto', exportBom: true },
    engine: { programDir: '', viewMode },
    ui: { ribbonCollapsed: false, quickAccess: ['file.save', 'edit.undo', 'edit.redo'], showStatusBar: true },
  };
}

export class Session {
  constructor({ app, appHwnd, cdp, out, tag }) {
    this.app = app;
    this.appHwnd = appHwnd;
    this.cdp = cdp;
    this.out = out;
    this.tag = tag;
    this.steps = [];
  }

  log(msg, extra) {
    console.log(`[${this.tag}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);
    this.steps.push({ at: new Date().toISOString(), msg, ...(extra ? { extra } : {}) });
  }

  /**
   * Captures Varak's visible window frame into `dir/name.png`, 1 px inside it: the 1 px window border lets the
   * desktop behind the window show through.
   */
  async shot(dir, name) {
    await sleep(400);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${name}.png`);
    const r = W.frameRect(this.appHwnd);
    writeFileSync(file, W.captureScreen({ x: r.x + 1, y: r.y + 1, width: r.width - 2, height: r.height - 2 }));
    this.log(`screenshot ${name}.png`);
    return file;
  }

  docs() {
    return this.cdp.invoke('documents:list');
  }

  async waitDoc(pred, what, timeoutMs = 90_000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const d = (await this.docs()).find(pred);
      if (d && d.state === 'ready') return d;
      await sleep(400);
    }
    throw new Error(`timeout waiting for ${what}`);
  }

  async open(path, kind) {
    await this.cdp.invoke('documents:open', { path });
    return this.waitDoc((d) => d.kind === kind && d.path === path, path);
  }

  /** Screen rect of the active document surface (CSS px = screen px at 100 %). */
  async surfaceScreenRect() {
    const r = await this.cdp.rectOf('.vr-surface');
    const o = W.clientOrigin(this.appHwnd);
    return r && { x: Math.round(o.x + r.x), y: Math.round(o.y + r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }

  /** Real input only while Varak is the foreground window. */
  assertForeground() {
    const fg = W.foreground();
    if (fg !== this.appHwnd && W.windowInfo(fg).owner !== this.appHwnd) throw new Error(`foreground is not Varak (${JSON.stringify(W.windowRef(fg))})`);
  }

  async clickInDocument(fx = 0.5, fy = 0.35) {
    const s = await this.surfaceScreenRect();
    const x = Math.round(s.x + s.width * fx);
    const y = Math.round(s.y + s.height * fy);
    const root = W.rootAt(x, y);
    if (root !== this.appHwnd && W.windowInfo(root).owner !== this.appHwnd) {
      throw new Error(`point ${x},${y} is covered by another window ${JSON.stringify(W.windowRef(root))}`);
    }
    W.bringToFront(this.appHwnd);
    W.click(x, y);
    await sleep(300);
  }

  /** Types like a person (40 ms per key; see docs/dev/platform.md §10 on key bursts). */
  async typeHuman(text) {
    this.assertForeground();
    for (const ch of text) {
      W.typeKeys(ch, W.foreground());
      await sleep(40);
    }
  }

  /** Waits until Varak's window answers again; throws when it stays hung. */
  async alive(step, graceMs = 8000) {
    const until = Date.now() + graceMs;
    while (W.isHung(this.appHwnd)) {
      if (Date.now() > until) throw new Error(`Varak stopped responding after: ${step}`);
      await sleep(500);
    }
  }

  running() {
    return this.app.exitCode === null && this.app.signalCode === null;
  }

  close() {
    this.cdp?.close();
    if (!this.running()) return;
    try {
      execFileSync('taskkill', ['/PID', String(this.app.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // already gone
    }
  }
}

/**
 * Starts the packaged app with an isolated data folder (`out/data`) and the given settings, places its window at
 * 60,40 with 1600 × 1000 and connects to its renderer.
 */
export async function launchVarak({ out, port, settings, files = [], exe = 'release/win-unpacked/Varak.exe', tag = 'gui' }) {
  const dataDir = join(out, 'data');
  mkdirSync(join(dataDir, 'Varak'), { recursive: true });
  writeFileSync(join(dataDir, 'Varak', 'settings.json'), JSON.stringify(settings));
  const env = { ...process.env, VARAK_DATA_DIR: dataDir, VARAK_DEBUG: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(resolve(repo, exe), [`--remote-debugging-port=${port}`, ...files], { env, stdio: 'ignore' });
  let appHwnd = 0;
  for (let i = 0; i < 200 && !appHwnd; i++) {
    const w = W.topLevelWindows().find((x) => x.pid === app.pid && x.visible && x.cls.startsWith('Chrome_WidgetWin') && x.rect.width > 400);
    if (w) appHwnd = w.hwnd;
    else await sleep(200);
  }
  if (!appHwnd) {
    try {
      execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // gone
    }
    throw new Error('the Varak window did not appear');
  }
  W.setWindowRect(appHwnd, 60, 40, 1600, 1000);
  const cdp = await Cdp.connect(port);
  W.bringToFront(appHwnd);
  return new Session({ app, appHwnd, cdp, out, tag });
}
