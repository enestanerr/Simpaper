/**
 * DefaultEngineManager with a fake OfficeInstance (nothing is spawned): profile slots across settings
 * changes (review 2026-09-29, #9) and a changed engine program folder (#2, defence in depth).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../log';
import type { ProcessGuard } from '../platform/types';
import type { EngineExitInfo, EngineManagerOptions } from './types';

const state = vi.hoisted(() => ({
  started: [] as Array<{ id: string; profileDir: string; programDir: string; exited: boolean; dispose: () => Promise<void> }>,
  /** Profile folders handed to a new instance while another live instance still used them. */
  collisions: [] as string[],
  located: [] as Array<string | undefined>,
}));

vi.mock('./locate', () => ({
  locateEngine: (opts: { programDir?: string }) => {
    state.located.push(opts.programDir);
    const programDir = opts.programDir ?? 'C:\\auto\\program';
    return {
      ok: true,
      paths: {
        programDir,
        sofficeExe: `${programDir}\\soffice.exe`,
        pythonExe: `${programDir}\\python.exe`,
        bridgeDir: 'C:\\repo\\engine\\bridge',
        profileTemplateDir: resolve(import.meta.dirname, '..', '..', '..', 'engine', 'profile'),
      },
    };
  },
}));
vi.mock('./launch', () => ({ resolveLaunchOptions: () => ({ args: [], env: {}, notes: [] }) }));
vi.mock('./version', () => ({ readPeFileVersion: async () => '26.8.0.3' }));
vi.mock('./EngineInstance', () => {
  class EngineStartError extends Error {
    readonly exitCode: number | null = null;
  }
  class FakeInstance {
    readonly id: string;
    readonly role: string;
    exited = false;
    private readonly listeners = new Set<(info: EngineExitInfo) => void>();

    constructor(readonly config: { id: string; role: string; profileDir: string; paths: { programDir: string } }) {
      this.id = config.id;
      this.role = config.role;
    }
    get profileDir(): string {
      return this.config.profileDir;
    }
    get programDir(): string {
      return this.config.paths.programDir;
    }
    info() {
      return { id: this.id, role: this.role, state: this.exited ? 'stopped' : 'ready', profileDir: this.config.profileDir };
    }
    onExit(listener: (info: EngineExitInfo) => void) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    onEvent() {
      return () => undefined;
    }
    async call() {
      return {};
    }
    async dispose() {
      // A real shutdown takes 0.6-0.9 s; the slot stays in use until the instance has exited.
      await new Promise((r) => setTimeout(r, 20));
      if (this.exited) return;
      this.exited = true;
      for (const listener of this.listeners) listener({ code: 0, crashed: false });
    }
  }
  return {
    EngineStartError,
    OfficeInstance: {
      start: async (config: FakeInstance['config']) => {
        if (state.started.some((i) => !i.exited && i.profileDir === config.profileDir)) state.collisions.push(config.profileDir);
        const instance = new FakeInstance(config);
        state.started.push(instance);
        return instance;
      },
    },
  };
});

import { DefaultEngineManager } from './EngineManager';

const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };
const guard: ProcessGuard = { supported: false, adopt() {}, killTree: async () => undefined };
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

describe('DefaultEngineManager profile options', () => {
  let root: string;
  const managers: DefaultEngineManager[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'simpaper-engine-manager-'));
    state.started.length = 0;
    state.collisions.length = 0;
    state.located.length = 0;
  });

  afterEach(async () => {
    await Promise.all(managers.splice(0).map((m) => m.dispose()));
    rmSync(root, { recursive: true, force: true });
  });

  // As bootstrap.ts creates it: programDir is left out while the setting is '' (the default).
  function manager(opts: Partial<EngineManagerOptions> = {}): DefaultEngineManager {
    const m = new DefaultEngineManager(
      { profilesRoot: root, uiLanguage: 'tr', documentLocale: 'tr-TR', appearance: 'system', warmSpare: false, ...opts },
      { processGuard: guard, log },
    );
    managers.push(m);
    return m;
  }
  const dirOf = (instance: unknown) => (instance as { profileDir: string }).profileDir;
  // What bootstrap's settings.onChange passes on a theme change with the default settings.
  const themeChange = { uiLanguage: 'tr', documentLocale: 'tr-TR', appearance: 'dark', programDir: '' } as const;

  it('a theme change keeps the slot bookkeeping: the next document gets its own profile', async () => {
    const m = manager();
    const first = await m.acquireDocumentInstance('d1');
    m.updateProfileOptions(themeChange);
    const second = await m.acquireDocumentInstance('d2');
    expect(dirOf(second)).not.toBe(dirOf(first));
    expect(state.collisions).toEqual([]);
  });

  it('the warm spare never takes the profile of an instance that is still running', async () => {
    const m = manager({ warmSpare: true });
    await vi.waitFor(() => expect(state.started).toHaveLength(1));
    const first = await m.acquireDocumentInstance('d1'); // takes the spare; a new spare starts
    await vi.waitFor(() => expect(state.started).toHaveLength(2));
    m.updateProfileOptions(themeChange); // the idle spare is replaced
    await vi.waitFor(() => expect(state.started).toHaveLength(3));
    const second = await m.acquireDocumentInstance('d2');
    await settle();
    expect(state.collisions).toEqual([]);
    expect(dirOf(second)).not.toBe(dirOf(first));
    const live = state.started.filter((i) => !i.exited).map((i) => i.profileDir);
    expect(new Set(live).size).toBe(live.length);
  });

  it("'' and an absent programDir are the same setting: nothing is restarted", async () => {
    const m = manager({ warmSpare: true });
    await vi.waitFor(() => expect(state.started).toHaveLength(1));
    m.updateProfileOptions({ uiLanguage: 'tr', documentLocale: 'tr-TR', appearance: 'system', programDir: '' });
    await settle();
    expect(state.started).toHaveLength(1);
    expect(state.started[0]?.exited).toBe(false);
  });

  it('a changed program folder starts nothing by itself; the next start uses it', async () => {
    const m = manager({ warmSpare: true });
    await vi.waitFor(() => expect(state.started).toHaveLength(1));
    const running = await m.acquireDocumentInstance('d1');
    await vi.waitFor(() => expect(state.started).toHaveLength(2));
    const other = 'D:\\Başka Motor\\program';
    m.updateProfileOptions({ ...themeChange, programDir: other });
    await settle();
    // The idle spare (old engine) ended and no engine was started because of the change.
    expect(state.started).toHaveLength(2);
    expect(state.started[1]?.exited).toBe(true);
    expect(state.started[0]?.exited).toBe(false); // the open document keeps its engine
    expect((await m.probe()).programDir).toBe(other);

    const next = await m.acquireDocumentInstance('d2');
    expect((next as unknown as { programDir: string }).programDir).toBe(other);
    expect(dirOf(next)).not.toBe(dirOf(running));
    await settle();
    expect(state.collisions).toEqual([]);
    expect(state.located.at(-1)).toBe(other);
  });
});
