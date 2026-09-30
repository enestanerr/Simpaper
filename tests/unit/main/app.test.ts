import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DocumentDescriptor, DocumentEvent, PromptAnswer, SaveResult } from '@shared/api/documents';
import { filesFromArgv, isSecondInstanceData } from '../../../src/main/app/argv';
import { resolveAppPaths } from '../../../src/main/app/paths';
import { QuitController, type QuitDocuments } from '../../../src/main/app/quit';
import { isAllowedExternalUrl } from '../../../src/main/app/security';
import { forwardShellKey } from '../../../src/main/app/shellKeys';
import { configureThreadPool, THREADPOOL_SIZE } from '../../../src/main/app/threadpool';
import { saveFilters, openFilters } from '../../../src/main/app/dialogFilters';
import { engineRescueTexts } from '../../../src/main/app/strings';
import { chromeColors } from '../../../src/main/app/theme';
import { silentLog } from './helpers/fakes';

const doc = (docId: string, patch: Partial<DocumentDescriptor> = {}): DocumentDescriptor => ({
  docId,
  kind: 'writer',
  title: `${docId}.docx`,
  path: null,
  format: 'docx',
  readOnly: false,
  modified: true,
  compat: null,
  state: 'ready',
  ...patch,
});

function quitHarness(docs: DocumentDescriptor[], answers: Record<string, 'save' | 'discard' | 'cancel' | 'close'>, saveResult: SaveResult = { outcome: 'saved' }) {
  const log: string[] = [];
  const documents: QuitDocuments = {
    modifiedDocuments: () => docs,
    activate: (id) => void log.push(`activate:${id}`),
    prompt: async (p): Promise<PromptAnswer> => {
      log.push(`${p.kind === 'closeStuck' ? 'stuck' : 'prompt'}:${p.docId}`);
      const a = answers[p.docId];
      if (p.kind === 'closeStuck') return { kind: 'closeStuck', choice: a === 'close' ? 'close' : 'cancel' };
      return { kind: 'unsavedChanges', choice: a === 'save' || a === 'discard' ? a : 'cancel' };
    },
    lastSnapshotAt: async (id) => (id === 'c' ? '2026-09-29T14:02:00.000Z' : null),
    save: async (id) => {
      log.push(`save:${id}`);
      return saveResult;
    },
    closeAll: async () => void log.push('closeAll'),
    emit: (e: DocumentEvent) => void log.push(`emit:${e.type}`),
  };
  const quit = new QuitController({
    documents,
    recovery: { markCleanShutdown: async () => void log.push('clean') },
    disposeServices: async () => void log.push('dispose'),
    exit: () => void log.push('exit'),
    log: silentLog,
  });
  return { quit, log };
}

describe('QuitController', () => {
  it('asks for every modified document, saves or discards, then shuts down in order', async () => {
    const { quit, log } = quitHarness([doc('a'), doc('b'), doc('c', { state: 'crashed' })], { a: 'save', b: 'discard', c: 'close' });
    expect(await quit.requestQuit()).toBe(true);
    expect(log).toEqual(['activate:a', 'prompt:a', 'save:a', 'activate:b', 'prompt:b', 'activate:c', 'stuck:c', 'closeAll', 'clean', 'dispose', 'exit']);
    expect(quit.state).toBe('done');
  });

  it('says what is lost before quitting with a hung or crashed document, and cancel keeps the app running', async () => {
    // A stuck engine cannot save: edits after the newest recovery snapshot are lost (they were lost silently before).
    const { quit, log } = quitHarness([doc('h', { state: 'busy' }), doc('c', { state: 'crashed' })], { h: 'close', c: 'cancel' });
    expect(await quit.requestQuit()).toBe(false);
    expect(log).toEqual(['activate:h', 'stuck:h', 'activate:c', 'stuck:c']);
    expect(quit.state).toBe('running');
  });

  it('cancel aborts the quit and keeps the app running', async () => {
    const { quit, log } = quitHarness([doc('a')], { a: 'cancel' });
    expect(await quit.requestQuit()).toBe(false);
    expect(log).toEqual(['activate:a', 'prompt:a']);
    expect(quit.state).toBe('running');
  });

  it('a failed save aborts the quit and reports the error', async () => {
    const { quit, log } = quitHarness([doc('a')], { a: 'save' }, { outcome: 'failed', errorKey: 'errors.save.diskFull' });
    expect(await quit.requestQuit()).toBe(false);
    expect(log).toEqual(['activate:a', 'prompt:a', 'save:a', 'emit:error']);
  });

  it('concurrent quit requests share one flow', async () => {
    const { quit, log } = quitHarness([], {});
    const [a, b] = await Promise.all([quit.requestQuit(), quit.requestQuit()]);
    expect([a, b]).toEqual([true, true]);
    expect(log.filter((l) => l === 'exit')).toHaveLength(1);
  });
});

describe('main entry', () => {
  it('sizes libuv\'s thread pool before any other module of the main process runs', () => {
    // The first import of the entry: ES modules run in import order, so nothing can queue work before it.
    const entry = readFileSync(resolve('src', 'main', 'index.ts'), 'utf8');
    expect(entry.split(/\r?\n/).find((l) => l.startsWith('import '))).toBe("import './app/threadpool';");
    const env: NodeJS.ProcessEnv = {};
    expect(configureThreadPool(env)).toBe(String(THREADPOOL_SIZE));
    expect(env['UV_THREADPOOL_SIZE']).toBe('16');
    // A value the user set wins; nonsense is replaced.
    expect(configureThreadPool({ UV_THREADPOOL_SIZE: '8' })).toBe('8');
    expect(configureThreadPool({ UV_THREADPOOL_SIZE: 'many' })).toBe('16');
    expect(configureThreadPool({ UV_THREADPOOL_SIZE: '0' })).toBe('16');
  });
});

describe('shell keys from the keyboard hook', () => {
  it('reach the renderer only while a document window, not the Simpaper window itself, has the focus', () => {
    const sent: string[] = [];
    const target = (hostFocused: boolean, activeDocId: string | null, kind?: 'writer' | 'pdf') => ({
      hostFocused: () => hostFocused,
      activeDocId,
      kindOf: () => kind,
      emit: (docId: string, key: string) => void sent.push(`${docId}:${key}`),
    });
    // The ribbon has the focus: the renderer handles Alt/F10 itself (a second report would re-open KeyTips).
    expect(forwardShellKey('Alt', target(true, 'd1', 'writer'))).toBe(false);
    expect(forwardShellKey('F10', target(true, 'd1', 'writer'))).toBe(false);
    expect(sent).toEqual([]);
    // A LibreOffice window has the focus (the BrowserWindow is blurred).
    expect(forwardShellKey('Alt', target(false, 'd1', 'writer'))).toBe(true);
    expect(forwardShellKey('F10', target(false, 'd2', 'pdf'))).toBe(false);
    expect(forwardShellKey('F10', target(false, null))).toBe(false);
    expect(sent).toEqual(['d1:Alt']);
  });
});

describe('command line and paths', () => {
  it('extracts supported files, skipping switches and the unpackaged app path', () => {
    const cwd = process.platform === 'win32' ? 'C:\\Users\\x' : '/home/x';
    const argv = ['simpaper.exe', '--allow-file-access-from-files', 'Rapor.docx', 'notes.xyz', 'Tablo.XLSX', 'Rapor.docx'];
    expect(filesFromArgv(argv, cwd, true)).toEqual([join(cwd, 'Rapor.docx'), join(cwd, 'Tablo.XLSX')]);
    expect(filesFromArgv(['electron.exe', '.', 'a.pdf'], cwd, false)).toEqual([join(cwd, 'a.pdf')]);
    expect(filesFromArgv(['simpaper.exe', 'https://evil.example/x.docx'], cwd, true)).toEqual([]);
    expect(isSecondInstanceData({ argv: ['a'], cwd: 'b' })).toBe(true);
    expect(isSecondInstanceData({ argv: 'a' })).toBe(false);
  });

  it.runIf(process.platform === 'win32')('takes the document path Explorer passes for a registered file type ("%1", quoted)', () => {
    const exe = 'C:\\Users\\Çağrı İşçi\\AppData\\Local\\Programs\\Simpaper\\Simpaper.exe';
    const file = 'C:\\Users\\Çağrı İşçi\\Belgeler\\Bütçe 2026 (son).XLSX';
    expect(filesFromArgv([exe, file], 'C:\\WINDOWS\\system32', true)).toEqual([file]);
    // A program path split at its spaces (an unquoted command line) never becomes a document.
    expect(filesFromArgv(['C:\\Users\\Çağrı', 'İşçi\\AppData\\Local\\Programs\\Simpaper\\Simpaper.exe', 'D:\\Rapor.docx'], 'C:\\', true)).toEqual(['D:\\Rapor.docx']);
  });

  it('keeps roaming settings and machine-local data apart', () => {
    const p = resolveAppPaths({ appData: 'C:\\Users\\x\\AppData\\Roaming', localAppData: 'C:\\Users\\x\\AppData\\Local', folderName: 'Simpaper', platform: 'win32' });
    expect(p.settingsFile).toBe(join('C:\\Users\\x\\AppData\\Roaming', 'Simpaper', 'settings.json'));
    expect(p.recovery).toBe(join('C:\\Users\\x\\AppData\\Local', 'Simpaper', 'recovery'));
    expect(p.engineProfiles).toBe(join('C:\\Users\\x\\AppData\\Local', 'Simpaper', 'engine'));
    const fallback = resolveAppPaths({ appData: 'C:\\Users\\x\\AppData\\Roaming', folderName: 'Simpaper-dev', platform: 'win32' });
    expect(fallback.logs).toBe(join('C:\\Users\\x\\AppData\\Local', 'Simpaper-dev', 'logs'));
  });
});

describe('security and window chrome', () => {
  it('allows only listed https URLs to open externally', () => {
    expect(isAllowedExternalUrl('https://github.com/enestanerr/Simpaper/issues/12')).toBe(true);
    expect(isAllowedExternalUrl('https://github.com/enestanerr/Simpaper/blob/main/THIRD_PARTY_NOTICES.md')).toBe(true);
    expect(isAllowedExternalUrl('https://www.mozilla.org/en-US/MPL/2.0/')).toBe(true);
    expect(isAllowedExternalUrl('http://github.com/enestanerr/Simpaper')).toBe(false);
    expect(isAllowedExternalUrl('https://github.com/enestanerr/Simpaperx')).toBe(false);
    expect(isAllowedExternalUrl('https://github.com/enestanerr/other-repo')).toBe(false);
    expect(isAllowedExternalUrl('https://github.com/enestanerr')).toBe(false);
    expect(isAllowedExternalUrl('https://user:pw@github.com/enestanerr/Simpaper')).toBe(false);
    // The repository first created under the wrong account is not ours any more.
    expect(isAllowedExternalUrl('https://github.com/ncreativestudios/Simpaper/issues')).toBe(false);
    expect(isAllowedExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    // Settings pages only through app:openDefaultApps, whose target is fixed in the main process.
    expect(isAllowedExternalUrl('ms-settings:defaultapps?registeredAppUser=Simpaper')).toBe(false);
  });

  it('builds dialog filters with the requested format first and no import-only formats', () => {
    const f = saveFilters('tr', 'calc', 'ods');
    expect(f[0]).toEqual({ name: 'OpenDocument Hesap Tablosu', extensions: ['ods'] });
    expect(f.flatMap((x) => x.extensions)).not.toContain('xlsb');
    expect(openFilters('en', 'pdf')).toEqual([
      { name: 'All supported files', extensions: ['pdf'] },
      { name: 'PDF files', extensions: ['pdf'] },
      { name: 'All files', extensions: ['*'] },
    ]);
  });

  it('uses opaque title bar colours per theme', () => {
    expect(chromeColors(false).overlay.height).toBe(40);
    expect(chromeColors(true).overlay.color).not.toBe(chromeColors(false).overlay.color);
  });
});

describe('engine rescue message box', () => {
  it('names the file and what a restart loses; "Restart engine" first, "Wait" second (the default)', () => {
    const tr = engineRescueTexts('tr', 'Rapor.docx', 'sinceSnapshot', '14:02');
    expect(tr.message).toBe('“Rapor.docx” belgesinin motoru yanıt vermiyor.');
    expect(tr.detail).toContain('fare ve klavyeye yanıt vermeyebilir');
    expect(tr.detail).toContain('saat 14:02 otomatik kaydından');
    expect(tr.buttons).toEqual(['Motoru yeniden başlat', 'Bekle']);
    expect(engineRescueTexts('tr', 'Rapor.docx', 'sinceSave', null).detail).toContain('son kaydedilen hâliyle');
    expect(engineRescueTexts('en', 'Report.docx', 'none', null).detail).toContain('no unsaved changes');
    expect(engineRescueTexts('en', 'Report.docx', 'all', null).detail).toContain('never saved');
    expect(engineRescueTexts('en', 'Report.docx', 'sinceSnapshot', '2:02 PM').buttons).toEqual(['Restart engine', 'Wait']);
    // Without a time the snapshot sentence is not printed with a placeholder.
    expect(engineRescueTexts('tr', 'Rapor.docx', 'sinceSnapshot', null).detail).not.toMatch(/null|undefined/);
  });
});
