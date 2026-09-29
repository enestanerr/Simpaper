/**
 * SettingsStore: `settings.json` in userData. Loaded synchronously at startup (some settings are
 * needed before the app is ready), validated and migrated, written atomically through the SafeWriter,
 * and broadcast to listeners (theme, engine profile options, autosave interval ...).
 */
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_SETTINGS, type Settings, type UiLanguage } from '@shared/api/app';
import type { SafeWriter } from '../documents/types';
import type { Logger } from '../log';
import { parseSettingsText, sanitizeSettings, serializeSettings, SETTINGS_VERSION, SettingsParseError } from './schema';

export class SettingsValidationError extends Error {
  override readonly name = 'SettingsValidationError';
  constructor(readonly fields: string[]) {
    super(`invalid settings: ${fields.join(', ')}`);
  }
}

export type SettingsListener = (next: Settings, prev: Settings) => void;

export interface SettingsStoreOptions {
  file: string;
  safeWrite: SafeWriter;
  log?: Logger;
  /** UI language for a first run (derived from the OS language by the app). */
  initialLanguage?: UiLanguage;
  now?: () => Date;
}

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
};

export class SettingsStore {
  private current: Settings;
  private extra: Record<string, unknown> = {};
  private version = SETTINGS_VERSION;
  private readonly listeners = new Set<SettingsListener>();
  private writeChain: Promise<void> = Promise.resolve();
  /** True when the file must be (re)written after loading (first run, migration, repaired values). */
  readonly needsWrite: boolean;

  constructor(private readonly opts: SettingsStoreOptions) {
    const defaults: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...(opts.initialLanguage ? { language: opts.initialLanguage } : {}) };
    let needsWrite: boolean;
    let settings = defaults;
    if (existsSync(opts.file)) {
      try {
        const parsed = parseSettingsText(readFileSync(opts.file, 'utf8'), defaults);
        settings = parsed.settings;
        this.extra = parsed.extra;
        this.version = parsed.version;
        needsWrite = parsed.migrated || parsed.invalid.length > 0;
        if (parsed.invalid.length) opts.log?.warn('settings: invalid values reset to defaults', { fields: parsed.invalid });
        if (parsed.migrated) opts.log?.info('settings: migrated', { toVersion: parsed.version });
      } catch (err) {
        if (!(err instanceof SettingsParseError)) throw err;
        const stamp = (opts.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
        const backup = join(dirname(opts.file), `settings.corrupt-${stamp}.json`);
        try {
          renameSync(opts.file, backup);
        } catch {
          // keep going with defaults; the next write replaces the broken file
        }
        opts.log?.warn('settings: unreadable file replaced by defaults', { backup });
        needsWrite = true;
      }
    } else {
      needsWrite = true;
    }
    this.current = deepFreeze(settings);
    this.needsWrite = needsWrite;
  }

  get(): Settings {
    return this.current;
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Validates and applies a (possibly nested-partial) patch. Throws SettingsValidationError, changing nothing. */
  async update(patch: unknown): Promise<Settings> {
    const { settings, invalid, unknown } = sanitizeSettings(patch, this.current);
    if (invalid.length || unknown.length) throw new SettingsValidationError([...invalid, ...unknown]);
    const prev = this.current;
    if (JSON.stringify(prev) === JSON.stringify(settings)) return prev;
    this.current = deepFreeze(settings);
    try {
      await this.persist();
    } catch (err) {
      this.current = prev;
      throw err;
    }
    for (const l of this.listeners) {
      try {
        l(this.current, prev);
      } catch (err) {
        this.opts.log?.error('settings listener failed', { error: err });
      }
    }
    return this.current;
  }

  /** Writes the current settings (serialised with other writes). */
  persist(): Promise<void> {
    const text = serializeSettings(this.current, this.extra, this.version);
    const run = async () => {
      await mkdir(dirname(this.opts.file), { recursive: true });
      await this.opts.safeWrite(this.opts.file, (tmp) => writeFile(tmp, text, 'utf8'));
    };
    const next = this.writeChain.then(run, run);
    this.writeChain = next.catch((err) => this.opts.log?.error('settings: write failed', { error: err }));
    return next;
  }

  /** Resolves when pending writes are done. */
  flush(): Promise<void> {
    return this.writeChain;
  }
}
