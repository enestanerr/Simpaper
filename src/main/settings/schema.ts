/**
 * Settings schema: validation of every field, migration of older files and (de)serialisation.
 * Unknown top-level keys are preserved so a file written by a newer version survives a round trip.
 */
import { isAbsolute } from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '@shared/api/app';

export const SETTINGS_VERSION = 2;

const SEPARATORS = ['auto', ';', ',', '\t'] as const;
const QUICK_ACCESS_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const KNOWN_KEYS = new Set<string>(['version', ...Object.keys(DEFAULT_SETTINGS)]);

type Check = (value: unknown) => { ok: true; value: unknown } | { ok: false };
const ok = (value: unknown) => ({ ok: true as const, value });
const bad = { ok: false as const };

const oneOf =
  <T extends string>(values: readonly T[]): Check =>
  (v) =>
    typeof v === 'string' && (values as readonly string[]).includes(v) ? ok(v) : bad;
const bool: Check = (v) => (typeof v === 'boolean' ? ok(v) : bad);
const intRange =
  (min: number, max: number): Check =>
  (v) =>
    typeof v === 'number' && Number.isFinite(v) ? ok(Math.min(max, Math.max(min, Math.round(v)))) : bad;
/**
 * A local absolute folder: no UNC or device paths (`\\server\share`, `//server/share`, `\\?\…`, `\\.\…`) and, on
 * Windows, a drive-letter path (`\dir` depends on the current drive).
 */
export function isLocalAbsolutePath(v: string, platform: NodeJS.Platform = process.platform): boolean {
  if (/^[\\/]{2}/.test(v)) return false;
  if (platform === 'win32') return /^[A-Za-z]:[\\/]/.test(v);
  return isAbsolute(v);
}
/**
 * The engine's program folder: soffice.exe and python.exe are started from it, so only '' (bundled engine) or a
 * local absolute path is accepted. It is never changed over IPC (src/main/ipc/handlers/app.ts) and a changed
 * value only takes effect at the next start (src/main/app/settingsEffects.ts).
 */
const programDir: Check = (v) => (typeof v === 'string' && v.length <= 1024 && !v.includes('\0') && (v === '' || isLocalAbsolutePath(v)) ? ok(v) : bad);
const quickAccess: Check = (v) => {
  if (!Array.isArray(v) || v.length > 40) return bad;
  if (!v.every((x) => typeof x === 'string' && QUICK_ACCESS_ID.test(x))) return bad;
  return ok([...new Set(v as string[])]);
};

/** Leaf validators by path; nested groups are validated field by field. */
const SCHEMA: Record<string, Check | Record<string, Check>> = {
  language: oneOf(['tr', 'en']),
  theme: oneOf(['system', 'light', 'dark']),
  autosaveMinutes: intRange(0, 60),
  verifyAfterSave: bool,
  recentLimit: intRange(0, 50),
  csv: { importSeparator: oneOf(SEPARATORS), exportSeparator: oneOf(SEPARATORS), exportBom: bool },
  engine: { programDir, viewMode: oneOf(['owned', 'child']) },
  ui: { ribbonCollapsed: bool, quickAccess, showStatusBar: bool, documentKeyTips: bool },
};

export interface SanitizeResult {
  settings: Settings;
  /** Dotted paths of values that were rejected (the base value was kept). */
  invalid: string[];
  /** Keys that are not part of the schema. */
  unknown: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Applies the known fields of `input` over `base`, validating each one. Nested groups may be partial.
 * Never throws; rejected values are reported in `invalid`.
 */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): SanitizeResult {
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  const invalid: string[] = [];
  const unknown: string[] = [];
  if (!isRecord(input)) return { settings: out as unknown as Settings, invalid: input === undefined ? [] : ['$'], unknown };
  for (const [key, value] of Object.entries(input)) {
    const rule = SCHEMA[key];
    if (!rule) {
      if (key !== 'version') unknown.push(key);
      continue;
    }
    if (typeof rule === 'function') {
      const r = rule(value);
      if (r.ok) out[key] = r.value;
      else invalid.push(key);
      continue;
    }
    if (!isRecord(value)) {
      invalid.push(key);
      continue;
    }
    const group = out[key] as Record<string, unknown>;
    for (const [sub, subValue] of Object.entries(value)) {
      const check = rule[sub];
      if (!check) {
        unknown.push(`${key}.${sub}`);
        continue;
      }
      const r = check(subValue);
      if (r.ok) group[sub] = r.value;
      else invalid.push(`${key}.${sub}`);
    }
  }
  return { settings: out as unknown as Settings, invalid, unknown };
}

/**
 * Brings a parsed file up to SETTINGS_VERSION.
 * v0 = files written before the `version` field existed (development builds): locale-style language
 * values ("tr-TR"), `theme: "auto"` and the old `viewMode` location at the top level.
 * v1 → v2: the default view mode became `child` (docs/adr/0003-document-surface.md, amendment): `owned`
 * could only have been stored as the old default, and it hung the app on screen, so it becomes `child`.
 */
export function migrateSettingsData(raw: Record<string, unknown>): { data: Record<string, unknown>; fromVersion: number } {
  const fromVersion = typeof raw['version'] === 'number' && Number.isInteger(raw['version']) ? (raw['version'] as number) : 0;
  const data = { ...raw };
  if (fromVersion < 1) {
    if (typeof data['language'] === 'string') data['language'] = (data['language'] as string).slice(0, 2).toLowerCase();
    if (data['theme'] === 'auto') data['theme'] = 'system';
    if (typeof data['viewMode'] === 'string') {
      const engine = isRecord(data['engine']) ? { ...data['engine'] } : {};
      if (engine['viewMode'] === undefined) engine['viewMode'] = data['viewMode'];
      data['engine'] = engine;
      delete data['viewMode'];
    }
  }
  if (fromVersion < 2 && isRecord(data['engine']) && data['engine']['viewMode'] === 'owned') {
    data['engine'] = { ...data['engine'], viewMode: 'child' };
  }
  data['version'] = Math.max(fromVersion, SETTINGS_VERSION);
  return { data, fromVersion };
}

export interface ParsedSettings {
  settings: Settings;
  /** Unknown top-level keys, written back unchanged. */
  extra: Record<string, unknown>;
  version: number;
  migrated: boolean;
  invalid: string[];
}

export class SettingsParseError extends Error {
  override readonly name = 'SettingsParseError';
}

/** Parses the settings file text; throws SettingsParseError for non-JSON or non-object content. */
export function parseSettingsText(text: string, defaults: Settings = DEFAULT_SETTINGS): ParsedSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    throw new SettingsParseError('settings file is not valid JSON', { cause: err });
  }
  if (!isRecord(raw)) throw new SettingsParseError('settings file does not contain an object');
  const { data, fromVersion } = migrateSettingsData(raw);
  const { settings, invalid } = sanitizeSettings(data, defaults);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!KNOWN_KEYS.has(k)) extra[k] = v;
  return { settings, extra, version: data['version'] as number, migrated: fromVersion < SETTINGS_VERSION, invalid };
}

export function serializeSettings(settings: Settings, extra: Record<string, unknown> = {}, version = SETTINGS_VERSION): string {
  return `${JSON.stringify({ ...extra, version, ...settings }, null, 2)}\n`;
}
