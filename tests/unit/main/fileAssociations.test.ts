/**
 * The file types Simpaper registers with Windows: src/shared/fileAssociations.ts (derived from FORMATS) must match the
 * installer script build/installer.nsh line by line, the shipped icons must be real multi-size icons, and the product
 * identity in electron-builder.yml must match src/shared/brand.ts (appId decides the installer's product GUID and the
 * taskbar identity, so a silent drift would install a second copy).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '@shared/brand';
import { FILE_ASSOCIATIONS, FILE_TYPE_ICON, OPEN_WITH_ONLY, progIdOf } from '@shared/fileAssociations';
import { FORMATS } from '@shared/formats';
import { FORMAT_LABELS } from '../../../src/main/app/strings';
import { parseFileTypes } from '../../../scripts/installer/check-associations.mjs';

const ROOT = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const NSH = read('build/installer.nsh');
const BUILDER = read('electron-builder.yml');

/** Sizes of the PNG entries of an ICO file (every entry must be a PNG of the size its directory entry states). */
function icoSizes(buf: Buffer): number[] {
  expect(buf.readUInt16LE(0)).toBe(0);
  expect(buf.readUInt16LE(2)).toBe(1);
  const sizes: number[] = [];
  for (let i = 0; i < buf.readUInt16LE(4); i++) {
    const base = 6 + 16 * i;
    const size = buf.readUInt8(base) || 256;
    const png = buf.subarray(buf.readUInt32LE(base + 12), buf.readUInt32LE(base + 12) + buf.readUInt32LE(base + 8));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
    sizes.push(size);
  }
  return sizes;
}

describe('file types registered with Windows', () => {
  it('cover every extension the app opens, exactly once, one ProgID per format', () => {
    const extensions = FORMATS.flatMap((f) => [...f.extensions]);
    expect(FILE_ASSOCIATIONS.map((a) => a.ext)).toEqual(extensions);
    expect(new Set(extensions).size).toBe(extensions.length);
    for (const a of FILE_ASSOCIATIONS) {
      expect(a.progId).toBe(progIdOf(a.format));
      expect(a.progId).toMatch(/^Simpaper\.[a-z]+$/);
      expect(a.icon).toBe(FILE_TYPE_ICON[a.kind]);
    }
    // Plain text stays with Notepad, spreadsheet apps and editors: "Open with" only.
    expect(FILE_ASSOCIATIONS.filter((a) => !a.claim).map((a) => a.ext)).toEqual(['txt', 'csv', 'tsv', 'tab']);
    expect([...OPEN_WITH_ONLY].sort()).toEqual(['csv', 'tsv', 'txt']);
  });

  it('build/installer.nsh registers the same table, with the type names of the file dialogs', () => {
    const rows = parseFileTypes(NSH);
    expect(rows.map((r) => r.ext)).toEqual(FILE_ASSOCIATIONS.map((a) => a.ext));
    rows.forEach((row, i) => {
      const a = FILE_ASSOCIATIONS[i]!;
      expect({ progId: row.progId, icon: row.icon, claim: row.claim }, row.ext).toEqual({ progId: a.progId, icon: a.icon, claim: a.claim });
      expect({ en: row.en, tr: row.tr }, row.ext).toEqual(FORMAT_LABELS[a.format]);
    });
  });

  it('the installer script writes only below its three registry locations and names the registered app like BRAND', () => {
    expect(NSH).toContain(`!define SP_REGAPP "${BRAND.registeredAppName}"`);
    const literal = NSH.split(/\r?\n/).filter((l) => /"Software\\/.test(l));
    expect(literal.map((l) => l.trim())).toEqual([
      '!define SP_CLASSES "Software\\Classes"',
      '!define SP_REGISTERED_APPS "Software\\RegisteredApplications"',
      `!define SP_APP_KEY "Software\\${BRAND.productName}"`,
    ]);
    // Quoted paths: the install folder may contain spaces ("C:\Users\Ayşe Nur\...").
    expect(NSH).toContain(`'"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" "%1"'`);
    expect(NSH).toContain(`'"$INSTDIR\\\${SP_ICONS}\\\${ICON}.ico",0'`);
    // The user's choice is Windows' business: no instruction touches it (comments may explain why).
    const code = NSH.split(/\r?\n/).filter((l) => !/^\s*;/.test(l));
    expect(code.filter((l) => /UserChoice|FileExts/i.test(l))).toEqual([]);
    // An update keeps the registration (default-app choices keep pointing at our ProgIDs).
    expect(NSH).toMatch(/\$\{IfNot\} \$\{isUpdated\}/);
  });

  it('ships a multi-size icon (16 to 256 px) for every file type', () => {
    for (const icon of new Set(Object.values(FILE_TYPE_ICON))) {
      expect(icoSizes(readFileSync(join(ROOT, 'resources', 'fileicons', `${icon}.ico`))), icon).toEqual([16, 20, 24, 32, 40, 48, 64, 96, 128, 256]);
    }
    expect(BUILDER).toMatch(/- from: resources\/fileicons\r?\n\s+to: fileicons\r?\n/);
    // electron-builder's own associations would register a second, conflicting set.
    expect(BUILDER).not.toMatch(/^\s*fileAssociations:/m);
  });
});

describe('product identity', () => {
  it('electron-builder.yml matches src/shared/brand.ts', () => {
    const field = (name: string) => new RegExp(`^\\s*${name}:\\s*(.+?)\\s*$`, 'm').exec(BUILDER)?.[1];
    expect(field('appId')).toBe(BRAND.appId);
    expect(field('productName')).toBe(BRAND.productName);
    expect(field('shortcutName')).toBe(BRAND.productName);
    expect(field('copyright')).toContain(BRAND.vendor);
    // No update feed derived from whatever git remote the build machine has (it would ship in resources/).
    expect(field('publish')).toBe('null');
    const pkg = JSON.parse(read('package.json')) as { name: string; productName: string; author: string };
    expect(pkg.productName).toBe(BRAND.productName);
    expect(pkg.name).toBe(BRAND.productName.toLowerCase());
    expect(pkg.author).toBe(BRAND.vendor);
    expect(BRAND.repositoryUrl).toBe('https://github.com/enestanerr/Simpaper');
  });
});
