/**
 * Font availability for the compatibility report: fonts installed in Windows (registry, read through
 * koffi; file-name scan as a fallback), fonts bundled with the engine, and the engine's
 * metric-compatible substitutes (Calibri→Carlito, Cambria→Caladea, Arial/Times New Roman/Courier New→Liberation).
 * Aptos (the Office default since 2023) has no substitute.
 */
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export type FontStatus = 'installed' | 'substituted' | 'missing';

export interface FontCatalog {
  status(fontName: string): FontStatus;
  substituteFor(fontName: string): string | undefined;
}

/** Metric-compatible replacements used by LibreOffice's VCL font substitution table. */
export const METRIC_SUBSTITUTES: Readonly<Record<string, string>> = {
  calibri: 'Carlito',
  cambria: 'Caladea',
  arial: 'Liberation Sans',
  helvetica: 'Liberation Sans',
  'arial narrow': 'Liberation Sans Narrow',
  'times new roman': 'Liberation Serif',
  times: 'Liberation Serif',
  'courier new': 'Liberation Mono',
  courier: 'Liberation Mono',
};

const STYLE_WORDS = new Set([
  'regular', 'normal', 'bold', 'italic', 'oblique', 'light', 'semilight', 'semibold', 'demibold', 'demi', 'black',
  'heavy', 'medium', 'thin', 'extralight', 'ultralight', 'extrabold', 'ultrabold', 'book', 'roman',
]);

/** Space/hyphen-insensitive, case-insensitive key: "Liberation Sans" and "LiberationSans" match. */
export function fontKey(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, '');
}

function stripStyle(name: string): string {
  const words = name.trim().split(/\s+/);
  while (words.length > 1 && STYLE_WORDS.has((words[words.length - 1] ?? '').toLowerCase())) words.pop();
  return words.join(' ');
}

/** Registry value name → family names: "Cambria & Cambria Math (TrueType)" → ["Cambria", "Cambria Math"]. */
export function familiesFromRegistryName(valueName: string): string[] {
  const bare = valueName.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const out = new Set<string>();
  for (const part of bare.split('&')) {
    const p = part.trim();
    if (!p) continue;
    out.add(p);
    out.add(stripStyle(p));
  }
  return [...out];
}

/** Font file name → family key candidates: "LiberationSans-Bold.ttf" → "liberationsans". */
export function keysFromFontFile(fileName: string): string[] {
  const stem = fileName.replace(/\.(ttf|ttc|otf|otc|fon|fnt|pfb|pfm)$/i, '');
  const family = stem.split('-')[0] ?? stem;
  return [...new Set([fontKey(stem), fontKey(family)])].filter(Boolean);
}

type RegistryReader = () => string[] | null;

interface KoffiLike {
  load(path: string): { func(definition: string): (...args: unknown[]) => unknown };
}

/** Value names under HKLM/HKCU `...\Windows NT\CurrentVersion\Fonts`; null when the registry is unavailable. */
export function readWindowsFontRegistry(): string[] | null {
  if (process.platform !== 'win32') return null;
  try {
    const require = createRequire(import.meta.url);
    const koffi = require('koffi') as KoffiLike;
    const advapi = koffi.load('advapi32.dll');
    const regOpenKeyEx = advapi.func('long __stdcall RegOpenKeyExW(intptr_t hKey, str16 lpSubKey, uint32 ulOptions, uint32 samDesired, _Out_ intptr_t *phkResult)');
    const regEnumValue = advapi.func(
      'long __stdcall RegEnumValueW(intptr_t hKey, uint32 dwIndex, _Out_ uint16_t *lpValueName, _Inout_ uint32 *lpcchValueName, void *lpReserved, void *lpType, void *lpData, void *lpcbData)',
    );
    const regCloseKey = advapi.func('long __stdcall RegCloseKey(intptr_t hKey)');
    const KEY_READ = 0x20019;
    const ERROR_NO_MORE_ITEMS = 259;
    // Predefined keys are sign-extended 32-bit values: (HKEY)(LONG)0x80000002 and 0x80000001.
    const roots = [-2147483646n, -2147483647n];
    const names: string[] = [];
    let opened = 0;
    for (const root of roots) {
      const out: unknown[] = [null];
      if (regOpenKeyEx(root, 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', 0, KEY_READ, out) !== 0) continue;
      opened++;
      const key = out[0];
      const buf = Buffer.alloc(32768 * 2);
      try {
        for (let i = 0; i < 20000; i++) {
          const len = [16383];
          const rc = regEnumValue(key, i, buf, len, null, null, null, null);
          if (rc === ERROR_NO_MORE_ITEMS) break;
          if (rc !== 0) continue;
          names.push(buf.toString('utf16le', 0, Number(len[0]) * 2));
        }
      } finally {
        regCloseKey(key);
      }
    }
    return opened ? names : null;
  } catch {
    return null;
  }
}

function listFontFiles(dirs: readonly string[]): string[] {
  const out: string[] = [];
  for (const d of dirs) {
    try {
      for (const f of readdirSync(d)) if (/\.(ttf|ttc|otf|otc)$/i.test(f)) out.push(f);
    } catch {
      // folder missing
    }
  }
  return out;
}

export function windowsFontDirs(): string[] {
  const dirs: string[] = [];
  const windir = process.env['WINDIR'] ?? process.env['SystemRoot'];
  if (windir) dirs.push(join(windir, 'Fonts'));
  const local = process.env['LOCALAPPDATA'];
  if (local) dirs.push(join(local, 'Microsoft', 'Windows', 'Fonts'));
  return dirs;
}

export interface FontCatalogOptions {
  /** Registry reader (default: koffi); returning null switches to the folder scan. */
  readRegistry?: RegistryReader;
  /** System font folders for the fallback scan. */
  systemFontDirs?: () => string[];
  /** Folders with fonts the engine loads privately (program/../share/fonts/truetype). */
  engineFontDirs?: () => string[];
  /** Explicit installed family names (tests). */
  installed?: readonly string[];
}

/**
 * Builds the catalogue lazily on first use; the engine folder list is re-read when it changes
 * (the engine location is only known after probing).
 */
export function createFontCatalog(opts: FontCatalogOptions = {}): FontCatalog {
  let system: { keys: Set<string>; fileKeys: string[] } | null = null;
  let engine: { dirs: string; keys: Set<string> } | null = null;

  const systemFonts = () => {
    if (system) return system;
    const keys = new Set<string>();
    const fileKeys: string[] = [];
    for (const n of opts.installed ?? []) keys.add(fontKey(n));
    if (!opts.installed) {
      const reg = (opts.readRegistry ?? readWindowsFontRegistry)();
      if (reg) for (const v of reg) for (const fam of familiesFromRegistryName(v)) keys.add(fontKey(fam));
      else for (const f of listFontFiles((opts.systemFontDirs ?? windowsFontDirs)())) fileKeys.push(...keysFromFontFile(f));
    }
    system = { keys, fileKeys };
    return system;
  };

  const engineFonts = () => {
    const dirs = opts.engineFontDirs?.() ?? [];
    const sig = dirs.join('|');
    if (!engine || engine.dirs !== sig) {
      const keys = new Set<string>();
      for (const f of listFontFiles(dirs)) for (const k of keysFromFontFile(f)) keys.add(k);
      engine = { dirs: sig, keys };
    }
    return engine.keys;
  };

  const has = (name: string): boolean => {
    const key = fontKey(name);
    if (!key) return true;
    const sys = systemFonts();
    if (sys.keys.has(key) || sys.keys.has(fontKey(stripStyle(name)))) return true;
    // Folder-scan fallback: file names are abbreviations ("times.ttf", "segoeuib.ttf").
    if (sys.fileKeys.some((k) => k === key || k.startsWith(key) || (k.length >= 5 && key.startsWith(k)))) return true;
    return engineFonts().has(key);
  };

  return {
    status(fontName) {
      if (has(fontName)) return 'installed';
      const sub = METRIC_SUBSTITUTES[fontName.trim().toLowerCase()];
      if (sub && has(sub)) return 'substituted';
      return 'missing';
    },
    substituteFor(fontName) {
      const sub = METRIC_SUBSTITUTES[fontName.trim().toLowerCase()];
      return sub && has(sub) ? sub : undefined;
    },
  };
}
