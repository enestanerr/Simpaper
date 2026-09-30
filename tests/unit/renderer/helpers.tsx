/**
 * Helpers for the shell/ribbon tests: repository paths, locale files, a fake `window.simpaperIpc` bridge that
 * records every call, and store resets.
 * (.tsx: files that import renderer code stay out of tsconfig.node.json, whose composite project cannot include
 * src/renderer; they are type-checked with tests/unit/renderer/tsconfig.renderer-tests.json.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Channel, ChannelReq, ChannelRes, EventChannel, Events, SimpaperIpcBridge } from '@shared/ipc';
import type { DocumentDescriptor } from '@shared/api/documents';
import type { ModuleKind } from '@shared/modules';
import { DEFAULT_SETTINGS } from '@shared/api/app';
import { resetAppStore } from '../../../src/renderer/state/appStore';
import { useCommands } from '../../../src/renderer/state/commandStore';
import { useViews } from '../../../src/renderer/state/viewStore';
import { resetOverlay } from '../../../src/renderer/services/overlay';
import { resetDocumentTracking } from '../../../src/renderer/services/documents';
import { resetSubscriptions } from '../../../src/renderer/services/engine';
import { resetKeyboardClaims } from '../../../src/renderer/services/keyboardFocus';
import { resetWindowActivity } from '../../../src/renderer/services/windowActivity';
import { stopKeyTips } from '../../../src/renderer/ribbon/keytipStore';

/** Repository root. (String-based: under jsdom the global URL class is jsdom's, which fileURLToPath rejects.) */
export const REPO_ROOT = import.meta.url.startsWith('file:') ? resolve(dirname(fileURLToPath(import.meta.url)), '../../..') : process.cwd();
export const LOCALES_DIR = join(REPO_ROOT, 'src/renderer/i18n/locales');

export type Tree = { [key: string]: string | Tree };

export function loadLocale(lang: string, ns: string): Tree {
  return JSON.parse(readFileSync(join(LOCALES_DIR, lang, `${ns}.json`), 'utf8')) as Tree;
}

/** Namespaces present on disk for a language (file names without .json). */
export function namespacesOnDisk(lang: string): string[] {
  return readdirSync(join(LOCALES_DIR, lang))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/** Flattens a translation tree into dotted leaf keys. */
export function flattenKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flattenKeys(v, `${prefix}${k}.`)));
}

/** Every .ts/.tsx file below `dir`. */
export function sourceFiles(dir: string, skip: (path: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (skip(path)) continue;
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path, skip));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

export function descriptor(docId: string, kind: ModuleKind, patch: Partial<DocumentDescriptor> = {}): DocumentDescriptor {
  return {
    docId,
    kind,
    title: `${docId}.${kind === 'writer' ? 'docx' : kind === 'calc' ? 'xlsx' : kind === 'impress' ? 'pptx' : 'pdf'}`,
    path: null,
    format: null,
    readOnly: false,
    modified: false,
    compat: null,
    state: 'ready',
    ...patch,
  };
}

export interface IpcCall {
  channel: string;
  req: unknown;
}

type Handler = (req: unknown) => unknown;

/** A fake preload bridge: records calls, answers from per-channel handlers, lets tests emit events. */
export class FakeIpc implements SimpaperIpcBridge {
  readonly calls: IpcCall[] = [];
  private readonly handlers = new Map<string, Handler>();
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  /** Answers `channel` synchronously (the response is still delivered as a resolved promise). */
  handle<C extends Channel>(channel: C, handler: (req: ChannelReq<NoInfer<C>>) => ChannelRes<NoInfer<C>>): this {
    this.handlers.set(channel, handler as Handler);
    return this;
  }

  /** Answers `channel` with a promise (slow or never-ending main-process work). */
  handleAsync<C extends Channel>(channel: C, handler: (req: ChannelReq<NoInfer<C>>) => Promise<ChannelRes<NoInfer<C>>>): this {
    this.handlers.set(channel, handler as Handler);
    return this;
  }

  invoke<C extends Channel>(channel: C, req: ChannelReq<C>): Promise<ChannelRes<C>> {
    this.calls.push({ channel, req });
    const handler = this.handlers.get(channel);
    try {
      return Promise.resolve(handler ? (handler(req) as ChannelRes<C>) : (undefined as ChannelRes<C>));
    } catch (err) {
      return Promise.reject(err);
    }
  }

  on<E extends EventChannel>(channel: E, listener: (payload: Events[E]) => void): () => void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    const l = listener as (payload: unknown) => void;
    set.add(l);
    return () => set?.delete(l);
  }

  emit<E extends EventChannel>(channel: E, payload: Events[E]): void {
    for (const l of this.listeners.get(channel) ?? []) l(payload);
  }

  channels(): string[] {
    return this.calls.map((c) => c.channel);
  }

  callsTo(channel: string): IpcCall[] {
    return this.calls.filter((c) => c.channel === channel);
  }
}

/** Installs a fake bridge as `globalThis.simpaperIpc` (what the preload script exposes). */
export function installIpc(ipc = new FakeIpc()): FakeIpc {
  (globalThis as unknown as { simpaperIpc?: SimpaperIpcBridge }).simpaperIpc = ipc;
  return ipc;
}

export function removeIpc(): void {
  delete (globalThis as unknown as { simpaperIpc?: SimpaperIpcBridge }).simpaperIpc;
}

/** Resets every renderer store and module-level service state between tests. */
export function resetRendererState(): void {
  resetAppStore({ ready: true, settings: structuredClone(DEFAULT_SETTINGS) });
  useCommands.setState({ states: {}, contexts: {}, revision: {} }, true);
  useViews.setState({ frozen: {} }, true);
  resetOverlay();
  resetDocumentTracking();
  resetSubscriptions();
  resetWindowActivity();
  resetKeyboardClaims();
  stopKeyTips();
}

/** Resolves after pending promise callbacks and zero-delay timers have run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}
