/**
 * Translations: Turkish and English have exactly the same keys in every namespace on disk (including the
 * pdf/compat/errors files owned by the PDF module and the main process), every key the shell and the office
 * modules use exists in both, interpolation variables match, and the runtime lookup resolves namespaced keys.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CSV_LCID, FORMATS } from '@shared/formats';
import type { EngineQuery } from '@shared/api/engine';
import type { CompatSeverity } from '@shared/api/documents';
import { OFFICE_KINDS } from '@shared/modules';
import { hasTranslation, i18n, initI18n, NAMESPACES, setLanguage, translateExternal } from '../../../src/renderer/i18n';
import { calcModule } from '../../../src/renderer/modules/calc';
import { impressModule } from '../../../src/renderer/modules/impress';
import { writerModule } from '../../../src/renderer/modules/writer';
import { HIGHLIGHT_COLORS, PALETTE_HUES, shadesOf, STANDARD_COLORS } from '../../../src/renderer/ribbon/palette';
import { flattenKeys, loadLocale, LOCALES_DIR, namespacesOnDisk, REPO_ROOT, sourceFiles, type Tree } from './helpers';

const LANGS = ['tr', 'en'] as const;
/** Namespaces whose keys this area uses (the PDF module checks its own `pdf` keys). */
const SHELL_NAMESPACES = ['common', 'shell', 'writer', 'calc', 'impress', 'formats'];

/** Dotted names in the sources that are identifiers, not i18n keys. */
const ENGINE_QUERIES = ['doc.info', 'calc.activeCell', 'calc.gotoCell', 'calc.setActiveCellContent', 'impress.slides', 'impress.gotoSlide'] satisfies EngineQuery[];
const NOT_KEYS = new Set<string>([...ENGINE_QUERIES, ...[writerModule, calcModule, impressModule].flatMap((m) => Object.keys(m.actions ?? {}))]);

/** Keys built at runtime from data (template literals in the components). */
function dynamicKeys(): string[] {
  const hues = new Set([...PALETTE_HUES, ...STANDARD_COLORS, ...HIGHLIGHT_COLORS].map((h) => h.hue));
  const shades = new Set(PALETTE_HUES.flatMap((h) => shadesOf(h.base).map((s) => s.shade)));
  const severities: CompatSeverity[] = ['info', 'warning', 'risk'];
  return [
    ...[...hues].map((h) => `shell.color.hue.${h}`),
    ...[...shades].map((s) => `shell.color.shade.${s}`),
    ...severities.map((s) => `shell.compat.severity.${s}`),
    ...OFFICE_KINDS.map((k) => `shell.start.blank.${k}`),
    ...['system', 'light', 'dark'].map((t) => `shell.options.theme_${t}`),
    ...Object.keys(CSV_LCID).map((l) => `shell.prompts.csv.locale_${l.replace('-', '_')}`),
    ...['saving', 'loading', 'dialog'].map((r) => `shell.status.busy_${r}`),
    ...FORMATS.map((f) => f.labelKey),
  ];
}

/** Literal `ns.key` strings in the renderer sources (PDF module excluded: it has its own test). */
function literalKeys(): Set<string> {
  const pattern = new RegExp(`['"\`]((?:${SHELL_NAMESPACES.join('|')})\\.[A-Za-z0-9_.]+)['"\`]`, 'g');
  const keys = new Set<string>();
  const files = sourceFiles(join(REPO_ROOT, 'src/renderer'), (p) => p.replace(/\\/g, '/').includes('/modules/pdf'));
  for (const file of files) for (const m of readFileSync(file, 'utf8').matchAll(pattern)) if (!NOT_KEYS.has(m[1]!)) keys.add(m[1]!);
  return keys;
}

function lookup(tree: Tree, path: string[]): unknown {
  let node: unknown = tree;
  for (const p of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[p];
  }
  return node;
}

function variables(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([A-Za-z0-9_]+)[^}]*\}\}/g)].map((m) => m[1]!).sort();
}

describe('locale files', () => {
  it('has the same namespaces in Turkish and English, and all of them are bundled', () => {
    expect(namespacesOnDisk('tr')).toEqual(namespacesOnDisk('en'));
    expect(namespacesOnDisk('tr')).toEqual([...NAMESPACES].sort());
  });

  it.each(namespacesOnDisk('tr'))('%s: Turkish and English have identical keys', (ns) => {
    const tr = flattenKeys(loadLocale('tr', ns)).sort();
    const en = flattenKeys(loadLocale('en', ns)).sort();
    expect(tr.filter((k) => !en.includes(k)), 'only in tr').toEqual([]);
    expect(en.filter((k) => !tr.includes(k)), 'only in en').toEqual([]);
    expect(tr.length).toBeGreaterThan(0);
  });

  it.each(namespacesOnDisk('tr'))('%s: no empty strings and matching {{variables}}', (ns) => {
    const tr = loadLocale('tr', ns);
    const en = loadLocale('en', ns);
    const problems: string[] = [];
    for (const key of flattenKeys(tr)) {
      const a = lookup(tr, key.split('.'));
      const b = lookup(en, key.split('.'));
      if (typeof a !== 'string' || typeof b !== 'string') continue;
      if (!a.trim() || !b.trim()) problems.push(`${key}: empty`);
      // Plural forms may drop {{count}} in one language ("{{formatted}} sözcük"), so compare the union per base key.
      if (!/_(one|other|zero|two|few|many)$/.test(key) && variables(a).join() !== variables(b).join()) {
        problems.push(`${key}: tr ${variables(a).join(',')} / en ${variables(b).join(',')}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('defines plural keys with both _one and _other', () => {
    const problems: string[] = [];
    for (const ns of namespacesOnDisk('tr')) {
      for (const lang of LANGS) {
        const keys = flattenKeys(loadLocale(lang, ns));
        for (const k of keys.filter((x) => x.endsWith('_one'))) if (!keys.includes(k.replace(/_one$/, '_other'))) problems.push(`${lang} ${ns}.${k}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps the files as UTF-8 JSON with Turkish characters (not \\u escapes)', () => {
    for (const ns of SHELL_NAMESPACES) {
      const path = join(LOCALES_DIR, 'tr', `${ns}.json`);
      expect(existsSync(path), path).toBe(true);
      const text = readFileSync(path, 'utf8');
      expect(text.includes('\\u00'), ns).toBe(false);
    }
    expect(readFileSync(join(LOCALES_DIR, 'tr', 'common.json'), 'utf8')).toContain('Giriş');
  });
});

describe('keys used by the shell and the office modules', () => {
  const used = literalKeys();

  it('finds the literal keys', () => {
    expect(used.size).toBeGreaterThan(600);
  });

  it.each(LANGS)('all literal keys exist (%s)', (lang) => {
    expect([...used].filter((k) => !hasTranslation(lang, k))).toEqual([]);
  });

  it.each(LANGS)('all keys built at runtime exist (%s)', (lang) => {
    expect(dynamicKeys().filter((k) => !hasTranslation(lang, k))).toEqual([]);
  });
});

describe('runtime lookup', () => {
  beforeAll(() => {
    initI18n('tr');
  });
  afterAll(async () => {
    await setLanguage('tr');
  });

  it('resolves namespaced keys and switches language', async () => {
    expect(i18n.t('common.tab.home')).toBe('Giriş');
    expect(i18n.t('impress.tab.slideShow')).toBe('Slayt Gösterisi');
    expect(i18n.t('formats.docx')).toBe('Word Belgesi');
    await setLanguage('en');
    expect(i18n.t('common.tab.home')).toBe('Home');
    expect(i18n.t('impress.tab.slideShow')).toBe('Slide Show');
    await setLanguage('tr');
  });

  it('uses Turkish plural rules and interpolation', () => {
    expect(i18n.t('shell.start.recoveryAvailable', { count: 1 })).toBe('Kaydedilmemiş 1 belge kurtarılabilir.');
    expect(i18n.t('shell.start.recoveryAvailable', { count: 3 })).toBe('Kaydedilmemiş 3 belge kurtarılabilir.');
    expect(i18n.t('writer.status.pageOf', { current: 2, total: 5 })).toBe('Sayfa 2 / 5');
  });

  it('translates keys sent by the main process and falls back for unknown ones', () => {
    expect(translateExternal('shell.messages.saved')).toBe('Kaydedildi.');
    expect(translateExternal('errors.nothing.here', undefined, 'shell.messages.genericError')).toBe('Bir hata oluştu (errors.nothing.here).');
    expect(translateExternal('errors.nothing.here')).toBe('errors.nothing.here');
  });

  it('reports plural keys as present', () => {
    expect(hasTranslation('tr', 'shell.start.recoveryAvailable')).toBe(true);
    expect(hasTranslation('en', 'writer.status.words')).toBe(true);
    expect(hasTranslation('en', 'shell.start')).toBe(false);
    expect(hasTranslation('en', 'nope.key')).toBe(false);
  });
});
