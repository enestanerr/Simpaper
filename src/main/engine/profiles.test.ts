import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { XMLValidator } from 'fast-xml-parser';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCELERATORS_FILE,
  ProfileStore,
  TEMPLATE_FILE,
  profileUrl,
  renderAccelerators,
  renderRegistryModifications,
  uiLocale,
  type AcceleratorTable,
} from './profiles';

const PROFILE_DIR = resolve(import.meta.dirname, '..', '..', '..', 'engine', 'profile');
const template = () => readFileSync(join(PROFILE_DIR, TEMPLATE_FILE), 'utf8');
const accelerators = () => JSON.parse(readFileSync(join(PROFILE_DIR, ACCELERATORS_FILE), 'utf8')) as AcceleratorTable;
const TR = { uiLanguage: 'tr', documentLocale: 'tr-TR', appearance: 'light' } as const;

describe('renderAccelerators', () => {
  it('writes replace/remove items in the format configmgr writes', () => {
    const xml = renderAccelerators({
      set: [
        { module: 'writer', key: 'F12', command: '.uno:SaveAs' },
        { module: 'calc', key: 'COMMA_SHIFT_MOD1', command: '.uno:InsertCurrentDate', lang: 'tr' },
        { module: 'writer', key: '1_MOD1_MOD2', command: '.uno:StyleApply?Style:string=Heading 1&FamilyName:string=ParagraphStyles' },
      ],
      remove: [{ module: 'global', key: 'M_SHIFT_MOD1' }],
    });
    const lines = xml.split('\n');
    expect(lines[0]).toBe(
      `<item oor:path="/org.openoffice.Office.Accelerators/PrimaryKeys/Modules/org.openoffice.Office.Accelerators:Module['com.sun.star.text.TextDocument']">` +
        '<node oor:name="F12" oor:op="replace"><prop oor:name="Command" oor:op="fuse"><value xml:lang="en-US">.uno:SaveAs</value></prop></node></item>',
    );
    expect(lines[1]).toContain(`Module['com.sun.star.sheet.SpreadsheetDocument']`);
    expect(lines[1]).toContain('<value xml:lang="tr">.uno:InsertCurrentDate</value>');
    expect(lines[2]).toContain('Heading 1&amp;FamilyName:string=ParagraphStyles');
    expect(lines[3]).toBe('<item oor:path="/org.openoffice.Office.Accelerators/PrimaryKeys/Global"><node oor:name="M_SHIFT_MOD1" oor:op="remove"/></item>');
  });

  it('rejects malformed entries', () => {
    const bad: AcceleratorTable[] = [
      { set: [{ module: 'draw' as never, key: 'F1', command: '.uno:X' }], remove: [] },
      { set: [{ module: 'writer', key: 'f12', command: '.uno:X' }], remove: [] },
      { set: [{ module: 'writer', key: 'F12', command: 'macro:///x' }], remove: [] },
      { set: [{ module: 'writer', key: 'F12', command: '.uno:X', lang: 'tr"><x' }], remove: [] },
      { set: [], remove: [{ module: 'writer', key: 'F1 2' }] },
    ];
    for (const table of bad) expect(() => renderAccelerators(table)).toThrow(/accelerators:/);
  });
});

describe('renderRegistryModifications', () => {
  it('renders the real template into well-formed configuration items for both languages', () => {
    for (const settings of [TR, { uiLanguage: 'en', documentLocale: 'en-US', appearance: 'dark' } as const]) {
      const xml = renderRegistryModifications(template(), accelerators(), settings);
      expect(XMLValidator.validate(xml)).toBe(true);
      expect(xml).not.toMatch(/\{\{|<!--/);
      expect(xml).toContain(`<prop oor:name="ooLocale" oor:op="fuse"><value>${uiLocale(settings.uiLanguage)}</value></prop>`);
      expect(xml).toContain(`<prop oor:name="DefaultLocale" oor:op="fuse"><value>${settings.documentLocale}</value></prop>`);
      expect(xml).toContain(`<prop oor:name="ApplicationAppearance" oor:op="fuse"><value>${settings.appearance === 'dark' ? 2 : 1}</value></prop>`);
      expect(xml).toContain('<prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop>');
      expect(xml).toContain('<prop oor:name="UseOpenCL" oor:op="fuse"><value>false</value></prop>');
      expect(xml).toContain('<prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop>');
      const table = accelerators();
      expect(xml.match(/oor:op="replace"/g)).toHaveLength(table.set.length);
      expect(xml.match(/oor:op="remove"/g)).toHaveLength(table.remove.length);
    }
  });

  it('validates the settings and the placeholders', () => {
    expect(() => renderRegistryModifications(template(), accelerators(), { ...TR, documentLocale: 'tr_TR"/>' })).toThrow(/locale/);
    expect(() => renderRegistryModifications('<x>{{NOPE}}</x>', { set: [], remove: [] }, TR)).toThrow(/NOPE/);
    expect(uiLocale('tr')).toBe('tr');
    expect(uiLocale('en')).toBe('en-US');
  });
});

describe('ACCELERATORS.md', () => {
  it('documents every entry of accelerators.json', () => {
    const doc = readFileSync(join(PROFILE_DIR, 'ACCELERATORS.md'), 'utf8');
    const { set, remove } = accelerators();
    for (const entry of set) {
      const row = doc.split('\n').find((line) => line.includes(`\`${entry.key}\``) && line.includes(`\`${entry.command}\``));
      expect(row, `${entry.module} ${entry.key}`).toBeDefined();
    }
    for (const entry of remove) {
      const row = doc.split('\n').find((line) => line.startsWith(`| ${entry.module} |`) && line.includes(`\`${entry.key}\``));
      expect(row, `remove ${entry.module} ${entry.key}`).toBeDefined();
    }
  });
});

describe('ProfileStore', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('hands out the lowest free slot, never a retired one, and a separate conversion slot', () => {
    const store = new ProfileStore('C:\\profiles', PROFILE_DIR);
    const a = store.acquire('document');
    const b = store.acquire('document');
    expect([a.name, b.name]).toEqual(['doc-0', 'doc-1']);
    a.release();
    a.release(); // idempotent
    expect(store.acquire('document').name).toBe('doc-0');
    store.retire('doc-2');
    expect(store.acquire('document').name).toBe('doc-3');
    expect(store.acquire('conversion').name).toBe('conversion');
    expect(store.acquire('conversion').name).toBe('conversion-1');
  });

  it('prepares a slot: fresh configuration, no stale pid file, no crash dumps', async () => {
    const root = mkdtempSync(join(tmpdir(), 'simpaper-profiles-'));
    roots.push(root);
    const store = new ProfileStore(root, PROFILE_DIR);
    const slot = store.acquire('document');
    mkdirSync(join(slot.dir, 'crash'), { recursive: true });
    writeFileSync(join(slot.dir, 'crash', 'dump.dmp'), '');
    writeFileSync(join(slot.dir, 'soffice.pid'), '1234');
    await store.prepare(slot, TR);
    const xcu = readFileSync(join(slot.dir, 'user', 'registrymodifications.xcu'), 'utf8');
    expect(XMLValidator.validate(xcu)).toBe(true);
    expect(xcu).toContain('<value>tr-TR</value>');
    expect(existsSync(join(slot.dir, 'soffice.pid'))).toBe(false);
    expect(existsSync(join(slot.dir, 'crash'))).toBe(false);
  });

  it.skipIf(process.platform !== 'win32')('builds UserInstallation URLs that survive spaces and Turkish letters', () => {
    const url = profileUrl('C:\\Users\\Çağrı İşçi\\AppData\\Local\\Simpaper\\engine\\doc-0');
    expect(url).toBe('file:///C:/Users/%C3%87a%C4%9Fr%C4%B1%20%C4%B0%C5%9F%C3%A7i/AppData/Local/Simpaper/engine/doc-0');
  });
});
