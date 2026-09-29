/**
 * Integration points of the platform layer in the main-process core (docs/dev/platform.md §2): view-mode
 * override, view focus, hang watchdog targets, engine restart, shell keys, the window's active state,
 * test-mode switches and the engine font folders.
 */
import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WindowState } from '@shared/api/app';
import { computeWindowState, trackActiveState, type TrackedWindow } from '../../../src/main/app/activeState';
import { engineFontFolders } from '../../../src/main/app/engineDirs';
import { readTestMode } from '../../../src/main/app/testMode';
import type { DocumentServiceDeps } from '../../../src/main/documents/service';
import { createHarness, waitFor, type Harness } from './helpers/harness';
import { buildOoxml } from './helpers/packages';

let h: Harness | null = null;

afterEach(async () => {
  vi.useRealTimers();
  if (h) await h.dispose();
  h = null;
});

async function setup(deps: Partial<DocumentServiceDeps> = {}): Promise<Harness> {
  h = await createHarness({}, deps);
  await mkdir(h.docsDir, { recursive: true });
  return h;
}

async function openDocx(hh: Harness, name: string): Promise<string> {
  const src = join(hh.docsDir, name);
  await writeFile(src, await buildOoxml('docx'));
  return (await hh.service.open(src)).docId;
}

describe('DocumentService — views', () => {
  it('loads every document without a native window when the view mode is overridden (VARAK_VIEW_MODE=hidden)', async () => {
    const hh = await setup({ viewMode: () => 'hidden' });
    const doc = await hh.service.create('calc');
    const inst = hh.engine.instance(doc.docId);
    expect(inst.callsOf('doc.new')[0]?.params['view']).toEqual({ mode: 'hidden' });
    expect(hh.view.log.filter((l) => l.startsWith('attach:') || l.startsWith('params:'))).toEqual([]);
    expect(hh.service.hasNativeViews()).toBe(false);
    expect(hh.service.hangTargets()).toEqual([]);
  });

  it('re-attaching the view of a background document after its engine restarted keeps it hidden', async () => {
    const hh = await setup();
    const a = await openDocx(hh, 'A.docx');
    const b = await openDocx(hh, 'B.docx');
    hh.service.noteViewRect(b, { x: 0, y: 100, width: 800, height: 600 });
    hh.service.activate(a);
    // The renderer shows the active document (view:setVisible).
    hh.service.noteViewVisible(a, true);
    expect(hh.view.log).toContain(`visible:${b}:false`);
    const before = hh.view.log.length;
    hh.engine.instance(b).crash();
    await waitFor(() => hh.engine.history.length === 3 && hh.service.get(b)?.descriptor.state === 'ready');
    const after = hh.view.log.slice(before);
    const attached = after.findIndex((l) => l.startsWith(`attach:${b}:`));
    expect(attached).toBeGreaterThanOrEqual(0);
    // Hidden again before it gets bounds: the new window never shows over the active document.
    const hidden = after.indexOf(`visible:${b}:false`, attached);
    expect(hidden).toBeGreaterThan(attached);
    expect(hidden).toBeLessThan(after.indexOf(`bounds:${b}`, attached));
    expect(hh.service.activeDocId).toBe(a);

    // The active, visible document is shown again after its restart.
    const mark = hh.view.log.length;
    hh.engine.instance(a).crash();
    await waitFor(() => hh.engine.history.length === 4 && hh.service.get(a)?.descriptor.state === 'ready');
    expect(hh.view.log.slice(mark)).toContain(`visible:${a}:true`);
  });

  it('view:focus activates the native window and asks the engine for the keyboard focus', async () => {
    const hh = await setup();
    const doc = await hh.service.create('writer');
    expect(hh.service.hasNativeViews()).toBe(true);
    hh.service.focusView(doc.docId);
    expect(hh.view.log).toContain(`focus:${doc.docId}`);
    await waitFor(() => hh.engine.instance(doc.docId).callsOf('view.focus').length === 1);
    expect(hh.engine.instance(doc.docId).callsOf('view.focus')[0]?.params).toEqual({ docId: doc.docId });
    // Unknown documents are ignored.
    hh.service.focusView('dgone');
  });
});

describe('DocumentService — hang watchdog', () => {
  it('probes visible views only, leaves loading/saving/snapshotting documents alone, and keeps hung ones', async () => {
    let releaseStore: () => void = () => undefined;
    const hh = await setup();
    const a = await hh.service.create('writer');
    const b = await hh.service.create('writer');
    // `b` is active; `a` was hidden by the activation.
    expect(hh.service.hangTargets()).toEqual([{ docId: b.docId, hwnd: '4243' }]);
    hh.service.noteViewVisible(a.docId, true);
    expect(hh.service.hangTargets().map((t) => t.docId).sort()).toEqual([a.docId, b.docId].sort());
    hh.service.noteViewVisible(a.docId, false);

    // A recovery snapshot of `b` runs in the background: no probes meanwhile.
    let during: string[] = [];
    await hh.service.runBackground(b.docId, async () => {
      during = hh.service.hangTargets().map((t) => t.docId);
    });
    expect(during).toEqual([]);
    expect(hh.service.hangTargets().map((t) => t.docId)).toEqual([b.docId]);

    // While saving, neither.
    hh.engine.instance(b.docId).overrides['doc.store'] = () => new Promise((r) => (releaseStore = () => r({ ok: true })));
    hh.dialogs.saveAnswers.push(join(hh.docsDir, 'b.docx'));
    const saving = hh.service.save(b.docId);
    await waitFor(() => hh.engine.instance(b.docId).callsOf('doc.store').length === 1);
    expect(hh.service.hangTargets()).toEqual([]);
    releaseStore();
    await saving;

    // A hung document stays a target (to see it recover) even when hidden.
    let responding = false;
    const watch = hh.service.watchHangs({ isResponding: async () => responding }, { intervalMs: 60_000, strikes: 1 });
    try {
      await watch.tick();
      expect(hh.service.get(b.docId)?.descriptor.state).toBe('busy');
      hh.service.noteViewVisible(b.docId, false);
      expect(hh.service.hangTargets().map((t) => t.docId)).toEqual([b.docId]);
      responding = true;
      await watch.tick();
      expect(hh.service.get(b.docId)?.descriptor.state).toBe('ready');
      expect(hh.eventsOf('notice').map((n) => n.noticeKey)).toContain('errors.engine.responding');
      expect(hh.service.hangTargets()).toEqual([]);
    } finally {
      watch.stop();
    }
  });

  it('no engine focus call while the window hangs', async () => {
    const hh = await setup();
    const doc = await hh.service.create('writer');
    const watch = hh.service.watchHangs({ isResponding: async () => false }, { intervalMs: 60_000, strikes: 1 });
    try {
      await watch.tick();
      hh.service.focusView(doc.docId);
      await new Promise((r) => setTimeout(r, 10));
      expect(hh.engine.instance(doc.docId).callsOf('view.focus')).toEqual([]);
    } finally {
      watch.stop();
    }
  });
});

describe('DocumentService — restartEngine', () => {
  it('kills a hung engine and reloads the newest recovery snapshot in a new instance', async () => {
    const killed: number[] = [];
    const hh = await setup({ killProcessTree: async (pid) => void killed.push(pid) });
    const docId = await openDocx(hh, 'Takılan.docx');
    const first = hh.engine.instance(docId);
    first.emit({ type: 'modified', docId, modified: true });
    await hh.recovery.start();
    await hh.recovery.snapshotAll();
    await expect(hh.service.restartEngine(docId)).rejects.toThrow('errors.engine.restartNotNeeded');

    const watch = hh.service.watchHangs({ isResponding: async () => false }, { intervalMs: 60_000, strikes: 1 });
    try {
      await watch.tick();
    } finally {
      watch.stop();
    }
    expect(hh.service.get(docId)?.descriptor.state).toBe('busy');
    await hh.service.restartEngine(docId);

    expect(killed).toEqual([first.officePid]);
    expect(hh.engine.released).toContain(docId);
    expect(hh.engine.history).toHaveLength(2);
    const second = hh.engine.history[1];
    expect(String(second?.callsOf('doc.load')[0]?.params['url'])).toMatch(/recovered\.odt$/);
    const d = hh.service.get(docId)?.descriptor;
    expect(d).toMatchObject({ state: 'ready', modified: true });
    expect(d?.recoveredAt).toBeTruthy();
    expect(hh.view.log).toContain(`detach:${docId}`);
    expect(hh.eventsOf('notice').map((n) => n.noticeKey)).toContain('errors.engine.restored');
    // Not "crashed": the user asked for the restart.
    expect(hh.eventsOf('error').map((e) => e.errorKey)).not.toContain('errors.engine.crashed');
    // Events of the killed instance are ignored.
    first.emit({ type: 'modified', docId, modified: false });
    expect(hh.service.get(docId)?.descriptor.modified).toBe(true);
  });

  it('closing a hung document says what is lost, then ends its engine at once and keeps its snapshot', async () => {
    const killed: number[] = [];
    const hh = await setup({ killProcessTree: async (pid) => void killed.push(pid) });
    const docId = await openDocx(hh, 'Kapat.docx');
    const inst = hh.engine.instance(docId);
    inst.emit({ type: 'modified', docId, modified: true });
    await hh.recovery.start();
    await hh.recovery.snapshotAll();
    const watch = hh.service.watchHangs({ isResponding: async () => false }, { intervalMs: 60_000, strikes: 1 });
    try {
      await watch.tick();
    } finally {
      watch.stop();
    }
    hh.answer((p) => (p.kind === 'closeStuck' ? { kind: 'closeStuck', choice: 'close' } : undefined));
    expect(await hh.service.close(docId)).toBe('closed');
    // Only the hang prompt (no save question: the engine cannot save), naming the snapshot that stays.
    expect(hh.prompts).toHaveLength(1);
    expect(hh.prompts[0]).toMatchObject({ kind: 'closeStuck', docId, fileName: 'Kapat.docx' });
    expect(hh.prompts[0]?.kind === 'closeStuck' && hh.prompts[0].snapshotAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(killed).toEqual([inst.officePid]);
    expect(inst.callsOf('doc.close')).toEqual([]);
    expect(hh.engine.released).toContain(docId);
    expect((await hh.recovery.list()).map((e) => e.reason)).toEqual(['engine-crash']);
  });

  it('never kills the process of an engine that already ended (Windows may have reused its PID)', async () => {
    const killed: number[] = [];
    const hh = await setup({ killProcessTree: async (pid) => void killed.push(pid) });
    const a = await openDocx(hh, 'A.docx');
    const b = await openDocx(hh, 'B.docx');
    hh.service.noteViewVisible(a, true);
    hh.service.noteViewVisible(b, true);
    const watch = hh.service.watchHangs({ isResponding: async () => false }, { intervalMs: 60_000, strikes: 1 });
    try {
      await watch.tick();
    } finally {
      watch.stop();
    }
    expect([hh.service.get(a)?.descriptor.state, hh.service.get(b)?.descriptor.state]).toEqual(['busy', 'busy']);
    // Both engines ended already; their exits have not been handled yet.
    hh.engine.instance(a).crashed = true;
    hh.engine.instance(b).crashed = true;
    await hh.service.restartEngine(a);
    expect(hh.service.get(a)?.descriptor.state).toBe('ready');
    expect(await hh.service.close(b)).toBe('closed');
    expect(killed).toEqual([]);
    // A live hung engine is still ended at once.
    const c = await openDocx(hh, 'C.docx');
    hh.service.noteViewVisible(c, true);
    const again = hh.service.watchHangs({ isResponding: async () => false }, { intervalMs: 60_000, strikes: 1 });
    try {
      await again.tick();
    } finally {
      again.stop();
    }
    const live = hh.engine.instance(c);
    expect(await hh.service.close(c)).toBe('closed');
    expect(killed).toEqual([live.officePid]);
  });

  it('retries a crashed document after the automatic restarts gave up', async () => {
    const hh = await setup();
    const docId = await openDocx(hh, 'Kırılgan.docx');
    for (let i = 0; i < 3; i++) {
      const inst = hh.engine.instance(docId);
      inst.crash();
      if (i < 2) await waitFor(() => hh.engine.history.length === i + 2 && hh.service.get(docId)?.descriptor.state === 'ready');
    }
    await waitFor(() => hh.eventsOf('error').some((e) => e.errorKey === 'errors.engine.restartLimit'));
    expect(hh.service.get(docId)?.descriptor.state).toBe('crashed');
    await hh.service.restartEngine(docId);
    expect(hh.service.get(docId)?.descriptor.state).toBe('ready');
    expect(hh.eventsOf('notice').map((n) => n.noticeKey)).toContain('errors.engine.restarted');
    await expect(hh.service.restartEngine('dunknown')).rejects.toThrow('errors.ipc.unknownDocument');
  });
});

describe('DocumentService — shell keys and intercepted shell commands', () => {
  it('reports F10 once when both the engine and the keyboard hook see it', async () => {
    const hh = await setup();
    const doc = await hh.service.create('writer');
    hh.engine.instance(doc.docId).emit({ type: 'key', docId: doc.docId, key: 'F10' });
    hh.service.emitShellKey(doc.docId, 'F10');
    hh.service.emitShellKey(doc.docId, 'Alt');
    hh.engine.instance(doc.docId).emit({ type: 'key', docId: doc.docId, key: 'F6' });
    hh.engine.instance(doc.docId).emit({ type: 'key', docId: doc.docId, key: 'F6' });
    expect(hh.eventsOf('shellKey').map((e) => e.key)).toEqual(['F10', 'Alt', 'F6', 'F6']);
    hh.service.emitShellKey('dgone', 'Alt');
    expect(hh.eventsOf('shellKey')).toHaveLength(4);
  });

  it('forwards About, Options and the PDF export page to the shell; direct PDF export stays in the main process', async () => {
    const hh = await setup();
    const doc = await hh.service.create('writer');
    const inst = hh.engine.instance(doc.docId);
    for (const command of ['.uno:About', '.uno:OptionsTreeDialog', '.uno:ExportToPDF']) inst.emit({ type: 'intercept', docId: doc.docId, command });
    await waitFor(() => hh.eventsOf('intercept').length === 3);
    expect(hh.eventsOf('intercept').map((e) => e.command)).toEqual(['.uno:About', '.uno:OptionsTreeDialog', '.uno:ExportToPDF']);
    inst.emit({ type: 'intercept', docId: doc.docId, command: '.uno:ExportDirectToPDF' });
    await waitFor(() => hh.dialogs.pdfRequests.length === 1);
    inst.emit({ type: 'intercept', docId: doc.docId, command: '.uno:HelpIndex' });
    await waitFor(() => hh.eventsOf('notice').some((n) => n.noticeKey === 'errors.command.unavailable'));
    expect(hh.eventsOf('intercept')).toHaveLength(3);
  });
});

class FakeWindow extends EventEmitter implements TrackedWindow {
  destroyed = false;
  focused = true;
  minimized = false;
  visible = true;
  isDestroyed = () => this.destroyed;
  isFocused = () => this.focused;
  isMinimized = () => this.minimized;
  isVisible = () => this.visible;
  isMaximized = () => false;
  isFullScreen = () => false;
}

describe('window active state', () => {
  it('counts the native document windows as part of the active window', () => {
    const w = new FakeWindow();
    expect(computeWindowState(w, () => false)).toEqual({ maximized: false, fullScreen: false, focused: true, active: true });
    w.focused = false;
    expect(computeWindowState(w, () => true).active).toBe(true);
    expect(computeWindowState(w, () => false).active).toBe(false);
    expect(computeWindowState(w).active).toBe(false);
    expect(
      computeWindowState(w, () => {
        throw new Error('native binding gone');
      }).active,
    ).toBe(false);
    w.minimized = true;
    expect(computeWindowState(w, () => true).active).toBe(false);
    w.destroyed = true;
    expect(computeWindowState(w, () => true)).toEqual({ maximized: false, fullScreen: false, focused: false, active: false });
    expect(computeWindowState(null)).toMatchObject({ active: false });
  });

  it('pushes changes on blur/focus and follows the foreground while blurred with document windows open', () => {
    vi.useFakeTimers();
    const w = new FakeWindow();
    let foreground = true;
    let views = true;
    const pushed: WindowState[] = [];
    const tracker = trackActiveState({ win: w, isForeground: () => foreground, hasNativeViews: () => views, push: (s) => pushed.push(s), activeIntervalMs: 400, inactiveIntervalMs: 1000 });
    expect(tracker.state()).toMatchObject({ focused: true, active: true });

    // Typing in a LibreOffice window: blur, but still active.
    w.focused = false;
    w.emit('blur');
    expect(pushed.at(-1)).toMatchObject({ focused: false, active: true });
    const count = pushed.length;
    vi.advanceTimersByTime(1_000);
    expect(pushed).toHaveLength(count); // no change → nothing pushed
    // The user switches to another application from the document window: no window event, the poll sees it.
    foreground = false;
    vi.advanceTimersByTime(450);
    expect(pushed.at(-1)).toMatchObject({ focused: false, active: false });
    // Back into the document window directly (the BrowserWindow stays blurred).
    foreground = true;
    vi.advanceTimersByTime(1_050);
    expect(pushed.at(-1)).toMatchObject({ active: true });
    // Focus returns: polling stops.
    w.focused = true;
    w.emit('focus');
    const afterFocus = pushed.length;
    vi.advanceTimersByTime(5_000);
    expect(pushed.length).toBe(afterFocus);

    // Without document windows there is no polling after the activation has settled (60/250 ms re-checks).
    views = false;
    foreground = false;
    w.focused = false;
    w.emit('blur');
    vi.advanceTimersByTime(300);
    const afterBlur = pushed.length;
    foreground = true;
    vi.advanceTimersByTime(5_000);
    expect(pushed.length).toBe(afterBlur);
    expect(pushed.at(-1)).toMatchObject({ active: false });

    tracker.stop();
    expect(w.listenerCount('blur')).toBe(0);
  });
});

describe('test mode switches', () => {
  it('is off without environment switches', () => {
    expect(readTestMode({})).toEqual({ hiddenViews: false, dataDir: null, smoke: null });
  });

  it('reads hidden views, the data folder and the smoke options', () => {
    const data = resolve('test-output', 'main-core', 'x');
    expect(readTestMode({ VARAK_VIEW_MODE: 'hidden', VARAK_DATA_DIR: data })).toEqual({ hiddenViews: true, dataDir: data, smoke: null });
    // Relative data folders are ignored (never write next to the working directory by accident).
    expect(readTestMode({ VARAK_DATA_DIR: 'relative\\dir' }).dataDir).toBeNull();
    const smoke = readTestMode({ VARAK_SMOKE: '1', VARAK_SMOKE_KIND: 'impress', VARAK_SMOKE_REPORT: join(data, 'r.json') }, 42);
    expect(smoke.hiddenViews).toBe(true);
    expect(smoke.smoke).toEqual({ reportFile: join(data, 'r.json'), kind: 'impress' });
    // Smoke runs always get an isolated data folder.
    expect(smoke.dataDir).toMatch(/varak-smoke-42$/);
    expect(readTestMode({ VARAK_SMOKE: 'yes', VARAK_SMOKE_KIND: 'pdf' }).smoke?.kind).toBe('calc');
  });
});

describe('engine font folders', () => {
  it('uses share/fonts/truetype for the engine and adds the admin image Fonts folder for the PDF module', () => {
    const program = resolve('vendor', 'libreoffice', 'program');
    const dirs = engineFontFolders(program);
    expect(dirs.engine).toEqual([resolve('vendor', 'libreoffice', 'share', 'fonts', 'truetype')]);
    expect(dirs.pdf).toEqual([...dirs.engine, resolve('vendor', 'libreoffice', 'Fonts')]);
  });
});
