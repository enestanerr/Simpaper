import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@shared/api/app';
import { createSafeWriter } from '../../../src/main/files/safeWrite';
import { applySettingsChange, type SettingsEffectDeps } from '../../../src/main/app/settingsEffects';
import { isLocalAbsolutePath, migrateSettingsData, parseSettingsText, sanitizeSettings, serializeSettings, SETTINGS_VERSION, SettingsParseError } from '../../../src/main/settings/schema';
import { SettingsStore, SettingsValidationError } from '../../../src/main/settings/store';
import { silentLog } from './helpers/fakes';
import { makeTempDir, removeDir } from './helpers/tmp';

describe('settings schema', () => {
  it('accepts valid values and nested partial groups', () => {
    const r = sanitizeSettings({ language: 'en', theme: 'dark', csv: { exportBom: false }, ui: { quickAccess: ['file.save', 'file.save', 'edit.undo'] } });
    expect(r.invalid).toEqual([]);
    expect(r.settings.language).toBe('en');
    expect(r.settings.csv).toEqual({ ...DEFAULT_SETTINGS.csv, exportBom: false });
    expect(r.settings.ui.quickAccess).toEqual(['file.save', 'edit.undo']);
    expect(r.settings.engine).toEqual(DEFAULT_SETTINGS.engine);
  });

  it('rejects invalid values field by field and reports unknown keys', () => {
    const r = sanitizeSettings({
      language: 'de',
      theme: 3,
      verifyAfterSave: 'yes',
      csv: { importSeparator: '|', exportBom: true },
      engine: { programDir: 'relative\\dir', viewMode: 'owned' },
      ui: { quickAccess: ['<script>'] },
      bogus: 1,
    });
    expect(r.invalid.sort()).toEqual(['csv.importSeparator', 'engine.programDir', 'language', 'theme', 'ui.quickAccess', 'verifyAfterSave'].sort());
    expect(r.unknown).toEqual(['bogus']);
    expect(r.settings.language).toBe(DEFAULT_SETTINGS.language);
    expect(r.settings.csv.exportBom).toBe(true);
  });

  it('accepts only local absolute engine folders (no UNC or device paths)', () => {
    const programDir = (v: string) => sanitizeSettings({ engine: { programDir: v } });
    for (const bad of ['\\\\host\\share\\program', '//host/share/program', '\\\\?\\C:\\LibreOffice\\program', '\\\\.\\pipe\\x', '\\??\\C:\\x', 'relative\\dir']) {
      expect(programDir(bad).invalid, bad).toEqual(['engine.programDir']);
    }
    expect(programDir('C:\\Program Files\\LibreOffice\\program').settings.engine.programDir).toBe('C:\\Program Files\\LibreOffice\\program');
    expect(programDir('').invalid).toEqual([]);
    expect(isLocalAbsolutePath('\\Windows\\System32', 'win32')).toBe(false);
    expect(isLocalAbsolutePath('D:/LibreOffice/program', 'win32')).toBe(true);
    expect(isLocalAbsolutePath('/opt/libreoffice/program', 'linux')).toBe(true);
    expect(isLocalAbsolutePath('//server/share', 'linux')).toBe(false);
    // A settings file with a network engine folder falls back to the bundled engine.
    expect(parseSettingsText(JSON.stringify({ version: 1, engine: { programDir: '\\\\host\\share\\program', viewMode: 'owned' } })).settings.engine.programDir).toBe('');
  });

  it('keeps the experimental document KeyTips hook off by default and validates it', () => {
    expect(DEFAULT_SETTINGS.ui.documentKeyTips).toBe(false);
    expect(sanitizeSettings({ ui: { documentKeyTips: true } }).settings.ui.documentKeyTips).toBe(true);
    expect(sanitizeSettings({ ui: { documentKeyTips: 'yes' } }).invalid).toEqual(['ui.documentKeyTips']);
    // Files written before the setting existed keep it off.
    expect(parseSettingsText(JSON.stringify({ version: 1, ui: { ribbonCollapsed: true } })).settings.ui.documentKeyTips).toBe(false);
  });

  it('clamps numbers into range', () => {
    const r = sanitizeSettings({ autosaveMinutes: 999, recentLimit: -4 });
    expect(r.settings.autosaveMinutes).toBe(60);
    expect(r.settings.recentLimit).toBe(0);
    expect(sanitizeSettings({ autosaveMinutes: 2.6 }).settings.autosaveMinutes).toBe(3);
  });

  it('migrates unversioned (v0) files', () => {
    const { data, fromVersion } = migrateSettingsData({ language: 'tr-TR', theme: 'auto', viewMode: 'child' });
    expect(fromVersion).toBe(0);
    expect(data).toMatchObject({ language: 'tr', theme: 'system', engine: { viewMode: 'child' }, version: SETTINGS_VERSION });
    expect('viewMode' in data).toBe(false);
    const parsed = parseSettingsText(JSON.stringify({ language: 'en-US', theme: 'auto' }));
    expect(parsed.migrated).toBe(true);
    expect(parsed.settings.language).toBe('en');
    expect(parsed.settings.theme).toBe('system');
  });

  it('moves the old default view mode to child (v1 → v2; owned hung the app on screen)', () => {
    expect(DEFAULT_SETTINGS.engine.viewMode).toBe('child');
    const v1 = (viewMode: string) => parseSettingsText(JSON.stringify({ version: 1, engine: { programDir: '', viewMode } }));
    expect(v1('owned').settings.engine.viewMode).toBe('child');
    expect(v1('owned').migrated).toBe(true);
    expect(v1('child').settings.engine.viewMode).toBe('child');
    // Chosen after the change (experimental option): kept.
    expect(parseSettingsText(JSON.stringify({ version: 2, engine: { programDir: '', viewMode: 'owned' } })).settings.engine.viewMode).toBe('owned');
    // v0 files with the old top-level location as well.
    expect(migrateSettingsData({ viewMode: 'owned' }).data).toMatchObject({ engine: { viewMode: 'child' }, version: SETTINGS_VERSION });
    expect(SETTINGS_VERSION).toBe(2);
  });

  it('keeps unknown top-level keys of newer versions', () => {
    const text = JSON.stringify({ version: 7, language: 'en', futureFeature: { on: true } });
    const parsed = parseSettingsText(text);
    expect(parsed.version).toBe(7);
    expect(parsed.migrated).toBe(false);
    expect(parsed.extra).toEqual({ futureFeature: { on: true } });
    const out = JSON.parse(serializeSettings(parsed.settings, parsed.extra, parsed.version));
    expect(out.futureFeature).toEqual({ on: true });
    expect(out.version).toBe(7);
  });

  it('throws SettingsParseError for broken files', () => {
    expect(() => parseSettingsText('{ not json')).toThrow(SettingsParseError);
    expect(() => parseSettingsText('[1,2]')).toThrow(SettingsParseError);
  });
});

describe('SettingsStore', () => {
  let dir: string;
  let file: string;
  const safeWrite = createSafeWriter();

  beforeEach(async () => {
    dir = await makeTempDir('settings');
    file = join(dir, 'settings.json');
  });
  afterEach(async () => {
    await removeDir(dir);
  });

  it('first run: defaults with the OS language, written on persist', async () => {
    const store = new SettingsStore({ file, safeWrite, initialLanguage: 'en', log: silentLog });
    expect(store.needsWrite).toBe(true);
    expect(store.get().language).toBe('en');
    await store.persist();
    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    expect(onDisk.version).toBe(SETTINGS_VERSION);
    expect(onDisk.language).toBe('en');
  });

  it('updates atomically, notifies listeners and survives a reload', async () => {
    const store = new SettingsStore({ file, safeWrite, log: silentLog });
    const seen: Array<[Settings, Settings]> = [];
    store.onChange((next, prev) => seen.push([next, prev]));
    const next = await store.update({ theme: 'dark', csv: { exportSeparator: ';' } });
    expect(next.theme).toBe('dark');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[1].theme).toBe('system');
    expect(Object.isFrozen(store.get())).toBe(true);
    const reloaded = new SettingsStore({ file, safeWrite, log: silentLog });
    expect(reloaded.get().theme).toBe('dark');
    expect(reloaded.get().csv.exportSeparator).toBe(';');
    expect(reloaded.needsWrite).toBe(false);
    expect((await readdir(dir)).filter((n) => n.includes('varak'))).toEqual([]);
  });

  it('rejects invalid patches without changing anything', async () => {
    const store = new SettingsStore({ file, safeWrite, log: silentLog });
    const before = store.get();
    await expect(store.update({ language: 'xx' })).rejects.toBeInstanceOf(SettingsValidationError);
    await expect(store.update({ nope: true })).rejects.toBeInstanceOf(SettingsValidationError);
    await expect(store.update('dark')).rejects.toBeInstanceOf(SettingsValidationError);
    expect(store.get()).toBe(before);
  });

  it('does not write when nothing changes', async () => {
    const store = new SettingsStore({ file, safeWrite, log: silentLog });
    let calls = 0;
    store.onChange(() => calls++);
    await store.update({ theme: 'system' });
    expect(calls).toBe(0);
  });

  it('moves a corrupt file aside and starts from defaults', async () => {
    await writeFile(file, '{ this is not json', 'utf8');
    const store = new SettingsStore({ file, safeWrite, log: silentLog, now: () => new Date('2026-09-29T10:00:00Z') });
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(store.needsWrite).toBe(true);
    const names = await readdir(dir);
    expect(names).toContain('settings.corrupt-2026-09-29T10-00-00-000Z.json');
  });

  it('applies language/theme to new engine profiles but never a changed engine folder at runtime', () => {
    const calls: string[] = [];
    const deps: SettingsEffectDeps = {
      setThemeSource: (t) => void calls.push(`theme:${t}`),
      engine: { updateProfileOptions: (o) => void calls.push(`profile:${JSON.stringify(o)}`) },
      documentLocale: (l) => (l === 'tr' ? 'tr-TR' : 'en-US'),
      recovery: { applySettings: () => void calls.push('autosave') },
      recent: { trim: async () => void calls.push('trim') },
      applyShellKeys: () => void calls.push('shellKeys'),
      notify: () => void calls.push('notify'),
    };
    const base = structuredClone(DEFAULT_SETTINGS);
    applySettingsChange({ ...base, theme: 'dark' }, base, deps);
    expect(calls).toEqual(['theme:dark', 'profile:{"uiLanguage":"tr","documentLocale":"tr-TR","appearance":"dark"}', 'notify']);
    calls.length = 0;
    // A new engine folder (settings.json edited, never over IPC) takes effect at the next start only.
    applySettingsChange({ ...base, engine: { ...base.engine, programDir: 'D:\\LibreOffice\\program' } }, base, deps);
    expect(calls).toEqual(['notify']);
    calls.length = 0;
    applySettingsChange({ ...base, language: 'en', engine: { ...base.engine, programDir: 'D:\\LibreOffice\\program' } }, base, deps);
    expect(calls).toEqual(['profile:{"uiLanguage":"en","documentLocale":"en-US","appearance":"system"}', 'notify']);
  });

  it('repairs invalid stored values and marks the file for rewrite', async () => {
    await writeFile(file, JSON.stringify({ version: 1, language: 'klingon', autosaveMinutes: 5 }), 'utf8');
    const store = new SettingsStore({ file, safeWrite, log: silentLog });
    expect(store.get().language).toBe(DEFAULT_SETTINGS.language);
    expect(store.get().autosaveMinutes).toBe(5);
    expect(store.needsWrite).toBe(true);
  });
});
