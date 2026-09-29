import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@shared/api/app';
import { isAllowedUnoArgs, isAllowedUnoCommand } from '@shared/commands';
import { INVOKE_CHANNELS } from '@shared/ipc';
import { PdfServiceError } from '../../../src/main/pdf/errors';
import type { PdfService } from '../../../src/main/pdf/types';
import { createHandlers, createIpcRouter, type IpcMainLike, type IpcRouter } from '../../../src/main/ipc/router';
import { createSenderValidator, isAppUrl, type IpcEventLike } from '../../../src/main/ipc/sender';
import type { AppController, IpcServices } from '../../../src/main/ipc/services';
import { createSafeWriter } from '../../../src/main/files/safeWrite';
import { SettingsStore, SettingsValidationError } from '../../../src/main/settings/store';
import { silentLog } from './helpers/fakes';
import { createHarness, type Harness } from './helpers/harness';
import { buildOoxml, tinyPdf } from './helpers/packages';
import { makeTempDir, removeDir } from './helpers/tmp';

let h: Harness;
let router: IpcRouter;
const pdfCalls: string[] = [];
let printedPages: unknown[] | undefined;
const trusted: IpcEventLike = { sender: { id: 1 }, senderFrame: { url: 'file:///app/index.html', processId: 1, routingId: 1 } };
const stranger: IpcEventLike = { sender: { id: 2 }, senderFrame: { url: 'https://evil.example/', processId: 9, routingId: 9 } };

const app: AppController = {
  info: async () => {
    throw new Error('internal detail that must not leak');
  },
  getSettings: () => DEFAULT_SETTINGS,
  updateSettings: async () => {
    throw new SettingsValidationError(['language']);
  },
  windowAction: () => ({ maximized: true, fullScreen: false, focused: true }),
  windowState: () => ({ maximized: false, fullScreen: false, focused: true }),
  openExternal: async () => false,
};

const pdf: PdfService = {
  read: async (id) => {
    pdfCalls.push(`read:${id}`);
    return new Uint8Array([1]);
  },
  update: async () => undefined,
  save: async () => ({ outcome: 'saved' }),
  insertText: async () => new Uint8Array(),
  insertImage: async () => new Uint8Array(),
  pages: async () => {
    throw new PdfServiceError('pdf.errors.encrypted', 'internal detail');
  },
  merge: async (id, paths) => {
    pdfCalls.push(`merge:${id}:${paths === undefined ? 'dialog' : paths.join('|')}`);
    return new Uint8Array();
  },
  extract: async () => ({ outcome: 'saved' }),
  print: async (_id, _win, pages) => {
    printedPages = pages;
  },
  markModified: (id) => void pdfCalls.push(`markModified:${id}`),
};

let services: IpcServices;

/** A router over the harness services with some of them replaced. */
function routerWith(overrides: Partial<IpcServices>): IpcRouter {
  const s = { ...services, ...overrides };
  return createIpcRouter({ handlers: createHandlers(s), isTrustedSender: (e) => e.sender.id === 1, services: s });
}

beforeEach(async () => {
  h = await createHarness();
  await mkdir(h.docsDir, { recursive: true });
  pdfCalls.length = 0;
  printedPages = undefined;
  services = {
    app,
    documents: h.service,
    recent: h.recent,
    viewHost: h.view,
    pdf: () => pdf,
    recovery: h.recovery,
    isAllowedUnoCommand: (_kind, command) => command === '.uno:Bold' || command === '.uno:CharFontName',
    getWindow: () => null,
    log: silentLog,
  };
  router = routerWith({});
});

afterEach(async () => {
  await h.dispose();
});

const call = (channel: string, payload?: unknown, event: IpcEventLike = trusted) => router.dispatch(channel, event, payload);

describe('IPC router', () => {
  it('registers exactly the channels of the shared contract and removes them again', () => {
    const registered: string[] = [];
    const removed: string[] = [];
    const ipcMain: IpcMainLike = { handle: (c) => void registered.push(c), removeHandler: (c) => void removed.push(c) };
    const dispose = router.register(ipcMain);
    expect(registered.sort()).toEqual([...INVOKE_CHANNELS].sort());
    dispose();
    expect(removed.sort()).toEqual([...INVOKE_CHANNELS].sort());
  });

  it('has a handler for every invoke channel', () => {
    const handlers = createHandlers({} as IpcServices);
    expect(Object.keys(handlers).sort()).toEqual([...INVOKE_CHANNELS].sort());
  });

  it('rejects unknown channels and untrusted senders before any service runs', async () => {
    await expect(call('shell:exec', {})).rejects.toThrow('errors.ipc.unknownChannel');
    await expect(call('documents:list', undefined, stranger)).rejects.toThrow('errors.ipc.untrustedSender');
    expect(h.eventsOf('opened')).toEqual([]);
  });

  it('validates payload shapes', async () => {
    await expect(call('documents:open', { path: 'relative/file.docx' })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('documents:open', { path: 'C:\\a.docx', extra: 1 })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('documents:create', { kind: 'excel' })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('documents:list', { unexpected: true })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('documents:save', { docId: 'd1', options: { format: 'exe' } })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('documents:close', { docId: '../x' })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('app:window', { action: 'destroy' })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('documents:answerPrompt', { promptId: 'p1', answer: { kind: 'saveRisk', choice: 'delete' } })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('documents:answerPrompt', { promptId: 'p1', answer: { kind: 'nope' } })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('recovery:restore', { id: '../../x' })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('view:setBounds', { docId: 'd1', rect: { x: 0, y: 0, width: -5, height: 1 } })).rejects.toThrow('errors.ipc.invalidRequest');
  });

  it('maps service errors to keys and hides internal messages', async () => {
    await expect(call('app:info')).rejects.toThrow(/^errors\.generic$/);
    await expect(call('app:settings:update', { language: 'xx' })).rejects.toThrow('errors.settings.invalid');
    await expect(call('documents:open', { path: join(h.docsDir, 'yok.docx') })).rejects.toThrow('errors.open.notFound');
    expect(await call('app:window', { action: 'toggleMaximize' })).toEqual({ maximized: true, fullScreen: false, focused: true });
    expect(await call('documents:list')).toEqual([]);
  });

  it('answers prompts through documents:answerPrompt', async () => {
    const doc = (await call('documents:create', { kind: 'writer' })) as { docId: string };
    h.engine.instance(doc.docId).emit({ type: 'modified', docId: doc.docId, modified: true });
    const closing = call('documents:close', { docId: doc.docId });
    await new Promise((r) => setTimeout(r, 10));
    const prompt = h.prompts[0];
    expect(prompt?.kind).toBe('unsavedChanges');
    await call('documents:answerPrompt', { promptId: prompt?.id, answer: { kind: 'unsavedChanges', choice: 'discard' } });
    expect(await closing).toBe('closed');
  });
});

describe('engine and view channels', () => {
  it('dispatches only allow-listed, well-formed commands to the document engine', async () => {
    const doc = (await call('documents:create', { kind: 'writer' })) as { docId: string };
    const inst = h.engine.instance(doc.docId);
    await call('engine:dispatch', { docId: doc.docId, command: '.uno:CharFontName', args: { 'CharFontName.FamilyName': 'Carlito' } });
    expect(inst.callsOf('cmd.dispatch')[0]?.params).toEqual({ docId: doc.docId, command: '.uno:CharFontName', args: { 'CharFontName.FamilyName': 'Carlito' } });
    await expect(call('engine:dispatch', { docId: doc.docId, command: '.uno:RunMacro' })).rejects.toThrow('errors.command.notAllowed');
    await expect(call('engine:dispatch', { docId: doc.docId, command: 'macro:///Standard.Module1.Main' })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('engine:dispatch', { docId: doc.docId, command: '.uno:Bold', args: { x: { type: 'any', value: 1 } } })).rejects.toThrow('errors.ipc.invalidRequest');
    // An argument the ribbon never sends (CharFontName carries the family name only).
    await expect(call('engine:dispatch', { docId: doc.docId, command: '.uno:CharFontName', args: { 'CharFontName.FamilyName': 'Carlito', Size: { type: 'float', value: 11.5 } } })).rejects.toThrow('errors.command.notAllowed');
    await expect(call('engine:dispatch', { docId: 'dunknown', command: '.uno:Bold' })).rejects.toThrow('errors.ipc.unknownDocument');
    expect(inst.callsOf('cmd.dispatch')).toHaveLength(1);
  });

  it('lets the engine bring a LibreOffice dialog to the front before it dispatches a command', async () => {
    // GUI spike: a dialog opened from the ribbon (Paragraph…) came up without the keyboard focus, because soffice is
    // not the foreground process (Windows' foreground lock).
    const allowed: number[] = [];
    const r = routerWith({ allowEngineForeground: (pid) => void allowed.push(pid) });
    const doc = (await r.dispatch('documents:create', trusted, { kind: 'writer' })) as { docId: string };
    const inst = h.engine.instance(doc.docId);
    await r.dispatch('engine:dispatch', trusted, { docId: doc.docId, command: '.uno:Bold' });
    expect(allowed).toEqual([inst.info().officePid]);
    await expect(r.dispatch('engine:dispatch', trusted, { docId: doc.docId, command: '.uno:RunMacro' })).rejects.toThrow('errors.command.notAllowed');
    expect(allowed).toHaveLength(1); // nothing for refused commands
  });

  it('never forwards file or URL arguments: commands that load resources always show their own dialog', async () => {
    // The real allow-list of the app (src/main/index.ts passes it to bootstrap).
    const r = routerWith({ isAllowedUnoCommand });
    const dispatch = (docId: string, command: string, args?: Record<string, unknown>) => r.dispatch('engine:dispatch', trusted, args ? { docId, command, args } : { docId, command });
    const writer = (await call('documents:create', { kind: 'writer' })) as { docId: string };
    h.engine.nextKind = 'calc';
    const calc = (await call('documents:create', { kind: 'calc' })) as { docId: string };
    h.engine.nextKind = 'impress';
    const impress = (await call('documents:create', { kind: 'impress' })) as { docId: string };
    const dispatched = () => [writer, calc, impress].flatMap((d) => h.engine.instance(d.docId).callsOf('cmd.dispatch').map((c) => c.params));

    // What the ribbons send passes (tests/unit/renderer/dispatch-args.test.ts checks every ribbon action).
    await dispatch(writer.docId, '.uno:FontHeight', { 'FontHeight.Height': { type: 'float', value: 11.5 } });
    await dispatch(writer.docId, '.uno:StyleApply', { Style: 'Heading 1', FamilyName: 'ParagraphStyles' });
    await dispatch(writer.docId, '.uno:InsertTable', { Columns: { type: 'short', value: 3 }, Rows: { type: 'short', value: 2 } });
    await dispatch(calc.docId, '.uno:InsertContents', { Flags: 'SVD' });
    await dispatch(impress.docId, '.uno:AssignLayout', { WhatLayout: 1 });
    await dispatch(writer.docId, '.uno:Zoom', { 'Zoom.Value': 120 });
    await dispatch(writer.docId, '.uno:InsertGraphic');
    expect(dispatched()).toHaveLength(7);

    const refused: Array<[string, string, Record<string, unknown>]> = [
      [writer.docId, '.uno:InsertGraphic', { FileName: 'file:///C:/Users/x/secret.png' }],
      [writer.docId, '.uno:InsertGraphic', { FileName: '\\\\attacker\\share\\x.png', AsLink: true }],
      [calc.docId, '.uno:InsertExternalDataSource', { URL: 'https://attacker.example/data.html', Source: 'HTML_all' }],
      [impress.docId, '.uno:ImportFromFile', { FileName: 'file:///C:/Users/x/Other.pptx' }],
      [writer.docId, '.uno:CompareDocuments', { URL: 'file:///C:/Users/x/Other.docx' }],
      [writer.docId, '.uno:MergeDocuments', { URL: 'file:///C:/Users/x/Other.docx' }],
      [impress.docId, '.uno:InsertAVMedia', { URL: 'https://attacker.example/v.mp4' }],
      // Known arguments with the wrong type or value.
      [writer.docId, '.uno:CharFontName', { 'CharFontName.FamilyName': 5 }],
      [writer.docId, '.uno:StyleApply', { Style: 'Default', FamilyName: 'PageStyles' }],
      [writer.docId, '.uno:Color', { Color: 0xff0000 }],
    ];
    for (const [docId, command, args] of refused) {
      await expect(dispatch(docId, command, args), command).rejects.toThrow('errors.command.notAllowed');
    }
    // The URL form carries arguments in the command itself.
    await expect(dispatch(writer.docId, '.uno:InsertGraphic?FileName:string=file:///C:/x.png')).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(dispatch(writer.docId, '.uno:StyleApply?Style:string=Heading 1')).rejects.toThrow('errors.ipc.invalidRequest');
    expect(dispatched()).toHaveLength(7);
    expect(isAllowedUnoArgs('.uno:InsertGraphic?FileName:string=x', undefined)).toBe(false);
  });

  it('maps allow-listed queries to engine methods and checks the document kind', async () => {
    const doc = (await call('documents:create', { kind: 'writer' })) as { docId: string };
    const inst = h.engine.instance(doc.docId);
    await call('engine:query', { docId: doc.docId, query: 'doc.info' });
    expect(inst.callsOf('doc.info')[0]?.params).toEqual({ docId: doc.docId });
    await expect(call('engine:query', { docId: doc.docId, query: 'calc.activeCell' })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('engine:query', { docId: doc.docId, query: 'writer.getText' })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('engine:query', { docId: doc.docId, query: 'doc.info', params: { docId: 'other' } })).rejects.toThrow('errors.ipc.invalidRequest');

    h.engine.nextKind = 'calc';
    const sheet = (await call('documents:create', { kind: 'calc' })) as { docId: string };
    await call('engine:query', { docId: sheet.docId, query: 'calc.gotoCell', params: { reference: 'Sayfa1.B2' } });
    expect(h.engine.instance(sheet.docId).callsOf('calc.gotoCell')[0]?.params).toEqual({ reference: 'Sayfa1.B2', docId: sheet.docId });
    await expect(call('engine:query', { docId: sheet.docId, query: 'calc.gotoCell', params: { reference: 5 } })).rejects.toThrow('errors.ipc.invalidRequest');
  });

  it('subscribes to command states', async () => {
    const doc = (await call('documents:create', { kind: 'writer' })) as { docId: string };
    expect(await call('engine:subscribe', { docId: doc.docId, commands: ['.uno:Bold', '.uno:Italic'] })).toEqual([]);
    await expect(call('engine:subscribe', { docId: doc.docId, commands: ['bold'] })).rejects.toThrow('errors.ipc.invalidRequest');
  });

  it('routes view calls to the view host and ignores documents that are gone', async () => {
    const doc = (await call('documents:create', { kind: 'writer' })) as { docId: string };
    await call('view:setBounds', { docId: doc.docId, rect: { x: 0, y: 120, width: 800, height: 500 } });
    await call('view:setVisible', { docId: doc.docId, visible: true });
    expect(await call('view:freeze', { docId: doc.docId })).toBe('data:image/png;base64,AAAA');
    await call('view:unfreeze', { docId: doc.docId });
    expect(h.view.log).toEqual(expect.arrayContaining([`bounds:${doc.docId}`, `visible:${doc.docId}:true`, `freeze:${doc.docId}`, `unfreeze:${doc.docId}`]));
    expect(await call('view:setBounds', { docId: 'dgone', rect: { x: 0, y: 0, width: 1, height: 1 } })).toBeUndefined();
    expect(await call('view:freeze', { docId: 'dgone' })).toBeNull();
  });

  it('view:focus activates the view and focuses the document inside the engine; visibility feeds the hang watch', async () => {
    const doc = (await call('documents:create', { kind: 'writer' })) as { docId: string };
    await call('view:focus', { docId: doc.docId });
    expect(h.view.log).toContain(`focus:${doc.docId}`);
    await new Promise((r) => setTimeout(r, 5));
    expect(h.engine.instance(doc.docId).callsOf('view.focus')).toHaveLength(1);
    expect(h.service.hangTargets().map((t) => t.docId)).toEqual([doc.docId]);
    await call('view:setVisible', { docId: doc.docId, visible: false });
    expect(h.service.hangTargets()).toEqual([]);
    expect(await call('view:focus', { docId: 'dgone' })).toBeUndefined();
  });

  it('documents:restartEngine only restarts engines that hang or crashed', async () => {
    const doc = (await call('documents:create', { kind: 'writer' })) as { docId: string };
    await expect(call('documents:restartEngine', { docId: doc.docId })).rejects.toThrow('errors.engine.restartNotNeeded');
    await expect(call('documents:restartEngine', { docId: 'dgone' })).rejects.toThrow('errors.ipc.unknownDocument');
    await expect(call('documents:restartEngine', { docId: doc.docId, extra: 1 })).rejects.toThrow('errors.ipc.invalidRequest');
  });
});

describe('pdf and recovery channels', () => {
  it('only serves PDF operations for PDF documents', async () => {
    const src = join(h.docsDir, 'a.pdf');
    await writeFile(src, tinyPdf());
    const doc = (await call('documents:open', { path: src })) as { docId: string };
    expect(await call('pdf:read', { docId: doc.docId })).toEqual(new Uint8Array([1]));
    expect(pdfCalls).toEqual([`read:${doc.docId}`]);
    await expect(call('pdf:update', { docId: doc.docId, bytes: 'not bytes' })).rejects.toThrow('errors.ipc.invalidRequest');
    const office = (await call('documents:create', { kind: 'writer' })) as { docId: string };
    await expect(call('pdf:read', { docId: office.docId })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('pdf:insertText', { docId: doc.docId, items: [{ pageIndex: 0, x: 1, y: 1, text: 'Merhaba', fontSize: 0, color: '#000000' }] })).rejects.toThrow('errors.ipc.invalidRequest');
  });

  it('passes the rendered pages of pdf:print to the PDF service and validates them', async () => {
    const src = join(h.docsDir, 'b.pdf');
    await writeFile(src, tinyPdf());
    const doc = (await call('documents:open', { path: src })) as { docId: string };
    const page = { data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png', widthPt: 595.3, heightPt: 841.9 };
    await call('pdf:print', { docId: doc.docId, pages: [page, page] });
    expect(printedPages).toHaveLength(2);
    await expect(call('pdf:print', { docId: doc.docId, pages: [{ ...page, mime: 'image/gif' }] })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('pdf:print', { docId: doc.docId, pages: [{ ...page, widthPt: 0 }] })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('pdf:print', { docId: doc.docId, pages: [{ ...page, data: [1, 2] }] })).rejects.toThrow('errors.ipc.invalidRequest');
  });

  it('passes PDF service error keys (pdf.errors.*) to the renderer', async () => {
    const src = join(h.docsDir, 'c.pdf');
    await writeFile(src, tinyPdf());
    const doc = (await call('documents:open', { path: src })) as { docId: string };
    await expect(call('pdf:pages', { docId: doc.docId, ops: [{ op: 'rotate', pageIndex: 0, value: 90 }] })).rejects.toThrow(/^pdf\.errors\.encrypted$/);
  });

  it('lists recovery entries', async () => {
    expect(await call('recovery:list')).toEqual([]);
    await expect(call('recovery:discard', { id: 'abc.def' })).rejects.toThrow('errors.recovery.notFound');
  });
});

describe('settings over IPC', () => {
  it('rejects a changed engine.programDir (the folder engines are started from) and changes nothing', async () => {
    const dir = await makeTempDir('ipc-settings');
    try {
      const store = new SettingsStore({ file: join(dir, 'settings.json'), safeWrite: createSafeWriter({ nativeReplace: null }), log: silentLog });
      const changes: Settings[] = [];
      store.onChange((next) => changes.push(next));
      const r = routerWith({ app: { ...app, getSettings: () => store.get(), updateSettings: (p) => store.update(p) } });
      const update = (patch: unknown) => r.dispatch('app:settings:update', trusted, patch);

      for (const programDir of ['\\\\attacker\\share\\program', 'C:\\Users\\x\\Downloads\\evil', '\\\\?\\C:\\evil', 'D:\\LibreOffice\\program']) {
        await expect(update({ engine: { programDir, viewMode: 'owned' } }), programDir).rejects.toThrow('errors.ipc.invalidRequest');
      }
      await expect(update({ engine: { programDir: 5 } })).rejects.toThrow('errors.ipc.invalidRequest');
      expect(store.get().engine.programDir).toBe('');
      expect(changes).toEqual([]);
      expect(existsSync(join(dir, 'settings.json'))).toBe(false);

      // The settings page sends the whole engine group back when it changes the view mode: that works.
      const next = (await update({ engine: { programDir: '', viewMode: 'owned' } })) as Settings;
      expect(next.engine).toEqual({ programDir: '', viewMode: 'owned' });
      expect(changes.map((c) => c.engine.viewMode)).toEqual(['owned']);
      await update({ theme: 'dark' });
      expect(store.get().theme).toBe('dark');
    } finally {
      await removeDir(dir);
    }
  });
});

describe('target files come from the dialogs only', () => {
  it('rejects renderer-supplied paths for documents:save, documents:exportPdf and pdf:merge', async () => {
    const src = join(h.docsDir, 'A.docx');
    await writeFile(src, await buildOoxml('docx'));
    const doc = (await call('documents:open', { path: src })) as { docId: string };
    const inst = h.engine.instance(doc.docId);
    const target = join(h.docsDir, 'Startup', 'evil.cmd');
    await expect(call('documents:exportPdf', { docId: doc.docId, options: { path: target } })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('documents:exportPdf', { docId: doc.docId, options: { path: target, pdfA: true } })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('documents:save', { docId: doc.docId, options: { path: join(h.docsDir, 'B.docx') } })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('documents:save', { docId: doc.docId, options: { saveAs: true, path: join(h.docsDir, 'B.docx') } })).rejects.toThrow('errors.ipc.invalidRequest');
    expect(inst.callsOf('doc.store')).toEqual([]);
    expect(h.dialogs.saveRequests).toEqual([]);
    expect(h.dialogs.pdfRequests).toEqual([]);

    const pdfSrc = join(h.docsDir, 'm.pdf');
    await writeFile(pdfSrc, tinyPdf());
    const pdfDoc = (await call('documents:open', { path: pdfSrc })) as { docId: string };
    await expect(call('pdf:merge', { docId: pdfDoc.docId, paths: ['\\\\attacker\\share\\x.pdf'] })).rejects.toThrow('errors.ipc.invalidRequest');
    await expect(call('pdf:merge', { docId: pdfDoc.docId, paths: [] })).rejects.toThrow('errors.ipc.invalidRequest');
    expect(pdfCalls).toEqual([]);
    // Without paths the PDF service shows the open dialog.
    await call('pdf:merge', { docId: pdfDoc.docId });
    expect(pdfCalls).toEqual([`merge:${pdfDoc.docId}:dialog`]);
  });

  it('an explicit export path of an internal caller always gets the .pdf extension', async () => {
    const src = join(h.docsDir, 'Rapor.docx');
    await writeFile(src, await buildOoxml('docx'));
    const doc = await h.service.open(src);
    const result = await h.service.exportPdf(doc.docId, { path: join(h.docsDir, 'Rapor.cmd') });
    expect(result).toEqual({ outcome: 'saved', path: join(h.docsDir, 'Rapor.cmd.pdf'), format: 'pdf' });
    expect(existsSync(join(h.docsDir, 'Rapor.cmd'))).toBe(false);
  });
});

describe('PDF flush protocol channels', () => {
  it('pdf:markModified marks a PDF modified; documents:flushDone answers a flush request', async () => {
    const src = join(h.docsDir, 'f.pdf');
    await writeFile(src, tinyPdf());
    const doc = (await call('documents:open', { path: src })) as { docId: string };
    await call('pdf:markModified', { docId: doc.docId });
    expect(pdfCalls).toEqual([`markModified:${doc.docId}`]);
    await expect(call('pdf:markModified', { docId: doc.docId, extra: 1 })).rejects.toThrow('errors.ipc.invalidRequest');
    const office = (await call('documents:create', { kind: 'writer' })) as { docId: string };
    await expect(call('pdf:markModified', { docId: office.docId })).rejects.toThrow('errors.ipc.invalidRequest');

    // A renderer that answers over IPC.
    h.onFlush(() => undefined);
    const flushed = h.service.requestFlush(doc.docId, 60_000);
    const request = h.eventsOf('flushRequest').at(-1);
    expect(request).toMatchObject({ type: 'flushRequest', docId: doc.docId });
    let done = false;
    void flushed.then(() => (done = true));
    await expect(call('documents:flushDone', { requestId: '../x' })).rejects.toThrow('errors.ipc.invalidRequest');
    await call('documents:flushDone', { requestId: 'funknown' });
    await new Promise((r) => setTimeout(r, 5));
    expect(done).toBe(false);
    await call('documents:flushDone', { requestId: request?.requestId });
    await flushed;
    expect(done).toBe(true);
  });
});

describe('sender validation', () => {
  const page = pathToFileURL(join(process.cwd(), 'out', 'renderer', 'index.html')).href;
  const win = {
    isDestroyed: () => false,
    webContents: { id: 7, mainFrame: { url: page, processId: 3, routingId: 11 } },
  };
  const validate = createSenderValidator(() => win, () => page);

  it('accepts only the main frame of our window showing our page', () => {
    expect(validate({ sender: { id: 7 }, senderFrame: { url: `${page}#/backstage`, processId: 3, routingId: 11 } })).toBe(true);
    expect(validate({ sender: { id: 8 }, senderFrame: { url: page, processId: 3, routingId: 11 } })).toBe(false);
    expect(validate({ sender: { id: 7 }, senderFrame: { url: page, processId: 3, routingId: 12 } })).toBe(false);
    expect(validate({ sender: { id: 7 }, senderFrame: { url: 'file:///C:/evil/index.html', processId: 3, routingId: 11 } })).toBe(false);
    expect(validate({ sender: { id: 7 }, senderFrame: null })).toBe(false);
  });

  it('compares dev-server origins and file paths', () => {
    expect(isAppUrl('http://localhost:5173/index.html?x=1', 'http://localhost:5173')).toBe(true);
    expect(isAppUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
    expect(isAppUrl('https://localhost:5173/', 'http://localhost:5173')).toBe(false);
    expect(isAppUrl('not a url', page)).toBe(false);
    if (process.platform === 'win32') expect(isAppUrl(page.toUpperCase().replace('FILE:', 'file:'), page)).toBe(true);
  });
});
