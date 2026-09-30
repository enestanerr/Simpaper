/**
 * Options › File types in the main process: the default-app state read from Windows (through a scripted association
 * query) and the Settings page the app opens. The app never changes a default itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BRAND } from '@shared/brand';
import { FILE_ASSOCIATIONS } from '@shared/fileAssociations';
import type { AssociationHandler, AssociationQuery } from '../../../src/main/platform/types';
import { silentLog } from './helpers/fakes';

const openExternal = vi.fn(async (_url: string) => undefined);
vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.0', getLocale: () => 'tr', isPackaged: true },
  shell: { openExternal: (url: string) => openExternal(url) },
}));

const { createAppController } = await import('../../../src/main/app/appController');
const { defaultAppsUri, fileTypesStatus } = await import('../../../src/main/app/fileTypes');

const EXE = 'C:\\Users\\Ayşe Nur\\AppData\\Local\\Programs\\Simpaper\\Simpaper.exe';
const NONE: AssociationHandler = { executable: null, progId: null };

/** Windows as a table: association (".docx" or a ProgID) → handler; `registered` = RegisteredApplications scope. */
function fakeWindows(handlers: Record<string, AssociationHandler>, registered: 'user' | 'machine' | null): AssociationQuery & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    handler: async (assoc) => {
      asked.push(assoc);
      return handlers[assoc] ?? NONE;
    },
    registeredApp: async (name) => (name === BRAND.registeredAppName ? registered : null),
  };
}

const controller = (associations?: AssociationQuery) =>
  createAppController({
    getWindow: () => null,
    settings: {} as never,
    probeEngine: async () => ({ available: false, programDir: null, officeVersion: null }),
    log: silentLog,
    execPath: EXE,
    ...(associations ? { associations } : {}),
  });

beforeEach(() => {
  openExternal.mockClear();
});

describe('file types status', () => {
  it('without the Windows query: unsupported, the groups still list the default candidates', async () => {
    const s = await fileTypesStatus(undefined, EXE);
    expect(s).toMatchObject({ supported: false, registration: null, thisCopy: false });
    expect(s.groups.map((g) => g.kind)).toEqual(['writer', 'calc', 'impress', 'pdf']);
    expect(s.groups[0]!.extensions).toEqual(['docx', 'docm', 'dotx', 'dotm', 'doc', 'rtf', 'odt']);
    expect(s.groups[1]!.extensions).toEqual(['xlsx', 'xlsm', 'xltx', 'xltm', 'xlsb', 'xls', 'ods']);
    expect(s.groups[3]!.extensions).toEqual(['pdf']);
    expect(s.groups.every((g) => g.withSimpaper.length === 0)).toBe(true);
  });

  it('counts a type as Simpaper\'s by our ProgID (the user\'s choice) or by this executable, never plain-text types', async () => {
    const windows = fakeWindows(
      {
        'Simpaper.docx': { executable: EXE.toUpperCase().replace(/\\/g, '/'), progId: null },
        '.docx': { executable: EXE, progId: 'Simpaper.docx' },
        '.doc': { executable: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE', progId: 'Word.Document.8' },
        // "Open with" > "Look for another app" makes Windows use Applications\Simpaper.exe
        '.xlsx': { executable: EXE, progId: 'Applications\\Simpaper.exe' },
        '.pdf': { executable: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', progId: 'MSEdgePDF' },
        '.pptx': { executable: null, progId: 'simpaper.PPTX' },
        '.csv': { executable: EXE, progId: 'Simpaper.csv' },
      },
      'user',
    );
    const s = await fileTypesStatus(windows, EXE);
    expect(s).toMatchObject({ supported: true, registration: 'user', thisCopy: true });
    expect(Object.fromEntries(s.groups.map((g) => [g.kind, g.withSimpaper]))).toEqual({ writer: ['docx'], calc: ['xlsx'], impress: ['pptx'], pdf: [] });
    // Only default candidates are asked for; TXT/CSV/TSV are "Open with" entries.
    expect(windows.asked).not.toContain('.csv');
    expect(windows.asked).not.toContain('.txt');
    expect(windows.asked.filter((a) => a.startsWith('.'))).toHaveLength(FILE_ASSOCIATIONS.filter((a) => a.claim).length);
  });

  it('tells a registration of another installation (or none) from this copy', async () => {
    const other = fakeWindows({ 'Simpaper.docx': { executable: 'D:\\Apps\\Simpaper\\Simpaper.exe', progId: null } }, 'machine');
    expect(await fileTypesStatus(other, EXE)).toMatchObject({ registration: 'machine', thisCopy: false });
    expect(await fileTypesStatus(fakeWindows({}, null), EXE)).toMatchObject({ supported: true, registration: null, thisCopy: false });
  });

  it('builds the documented Settings deep links for a per-user and a per-machine install', () => {
    expect(defaultAppsUri('user')).toBe('ms-settings:defaultapps?registeredAppUser=Simpaper');
    expect(defaultAppsUri('machine')).toBe('ms-settings:defaultapps?registeredAppMachine=Simpaper');
  });
});

describe('app controller: file types', () => {
  it('opens Simpaper\'s Default apps page only when the installer registered it', async () => {
    expect(await controller().openDefaultApps()).toBe(false);
    expect(await controller(fakeWindows({}, null)).openDefaultApps()).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();

    expect(await controller(fakeWindows({}, 'user')).openDefaultApps()).toBe(true);
    expect(await controller(fakeWindows({}, 'machine')).openDefaultApps()).toBe(true);
    expect(openExternal.mock.calls.map((c) => c[0])).toEqual([
      'ms-settings:defaultapps?registeredAppUser=Simpaper',
      'ms-settings:defaultapps?registeredAppMachine=Simpaper',
    ]);
  });

  it('reports false when Windows cannot open Settings', async () => {
    openExternal.mockRejectedValueOnce(new Error('no handler'));
    expect(await controller(fakeWindows({}, 'user')).openDefaultApps()).toBe(false);
  });

  it('fileTypes() uses this executable', async () => {
    const s = await controller(fakeWindows({ '.odt': { executable: EXE.toLowerCase(), progId: 'LibreOffice.WriterDocument.1' } }, 'user')).fileTypes();
    expect(s.groups[0]!.withSimpaper).toEqual(['odt']);
  });
});
