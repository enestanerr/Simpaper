// @vitest-environment jsdom
// @jsxRuntime automatic
/**
 * Document lifecycle in the renderer: what the workspace shows while a document closes, open/create/restore
 * results that arrive after the document's own events, pushing pending PDF edits before a close and when the
 * main process asks for them (`flushRequest`), and Calc's own input line after an engine restart.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Settings } from '@shared/api/app';
import type { DocumentDescriptor } from '@shared/api/documents';
import { initI18n, setLanguage } from '../../../src/renderer/i18n';
import { calcModule } from '../../../src/renderer/modules/calc';
import { CalcWorkspace } from '../../../src/renderer/modules/calc/CalcWorkspace';
import { impressModule } from '../../../src/renderer/modules/impress';
import { flushPdf, pdfActions } from '../../../src/renderer/modules/pdf/actions';
import type { PdfController } from '../../../src/renderer/modules/pdf/controller/controller';
import { registerController, unregisterController } from '../../../src/renderer/modules/pdf/controller/registry';
import { pdfRibbon } from '../../../src/renderer/modules/pdf/ribbon';
import { registerModules } from '../../../src/renderer/modules/registry';
import type { ModuleDefinition } from '../../../src/renderer/modules/types';
import { writerModule } from '../../../src/renderer/modules/writer';
import { handleDocumentEvent } from '../../../src/renderer/services/bootstrap';
import { closeDocument, createDocument, openPath, openWithDialog, restoreRecovery } from '../../../src/renderer/services/documents';
import { Shell } from '../../../src/renderer/shell/Shell';
import { setActiveDocId, upsertDocument, useApp } from '../../../src/renderer/state/appStore';
import { getCommandState, setCommandState } from '../../../src/renderer/state/commandStore';
import { descriptor, FakeIpc, flush, installIpc, removeIpc, resetRendererState } from './helpers';

/** The PDF module as the shell sees it: its real flush hook, a stand-in workspace (no pdf.js under jsdom). */
const pdfModule = { kind: 'pdf', ribbon: pdfRibbon, actions: pdfActions, flush: flushPdf, Workspace: () => <div>pdf</div> } as unknown as ModuleDefinition;

let ipc: FakeIpc;

beforeAll(() => {
  registerModules([writerModule, calcModule, impressModule, pdfModule]);
});

beforeEach(async () => {
  resetRendererState();
  initI18n('en');
  await setLanguage('en');
  ipc = installIpc(new FakeIpc());
  ipc.handle('documents:recent', () => []);
  ipc.handle('recovery:list', () => []);
  ipc.handle('documents:activate', () => undefined);
  ipc.handle('engine:subscribe', () => []);
  ipc.handle('engine:query', () => ({ docId: 'x', modified: false, title: 'x' }) as never);
  ipc.handle('view:setBounds', () => undefined);
  ipc.handle('view:setVisible', () => undefined);
  ipc.handle('view:focus', () => undefined);
  ipc.handle('app:settings:update', (req) => ({ ...useApp.getState().settings, ...req }) as Settings);
});

afterEach(() => {
  cleanup();
  removeIpc();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const docIds = () => useApp.getState().documents.map((d) => d.docId);

describe('closing an office document', () => {
  it('shows a neutral closing notice, not the crash screen, while the engine shuts down', async () => {
    handleDocumentEvent({ type: 'opened', doc: descriptor('w1', 'writer') });
    render(<Shell />);
    await act(flush);
    // main DocumentService.discard(): update(state 'closed') first, then doc.close + engine shutdown, then 'closed'.
    await act(async () => {
      handleDocumentEvent({ type: 'updated', doc: descriptor('w1', 'writer', { state: 'closed' }) });
      await flush();
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recover' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Closing w1.docx…');

    await act(async () => {
      handleDocumentEvent({ type: 'closed', docId: 'w1' });
      await flush();
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(docIds()).toEqual([]);
  });

  it('still reports a crashed engine with the recovery actions', async () => {
    handleDocumentEvent({ type: 'opened', doc: descriptor('w1', 'writer') });
    render(<Shell />);
    await act(flush);
    await act(async () => {
      handleDocumentEvent({ type: 'updated', doc: descriptor('w1', 'writer', { state: 'crashed' }) });
      await flush();
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The document engine stopped unexpectedly');
    expect(within(alert).getByRole('button', { name: 'Recover' })).toBeTruthy();
  });
});

describe('results of open, create and restore requests', () => {
  beforeEach(() => {
    ipc.handle('documents:close', () => 'closed' as const); // main: an unknown docId is "closed" without an event
  });

  it('a multi-file open does not bring back a document closed while the other files loaded', async () => {
    const answer = deferred<DocumentDescriptor[]>();
    ipc.handleAsync('documents:openDialog', () => answer.promise);
    const pending = openWithDialog();
    const a = descriptor('A', 'writer', { state: 'ready' });
    // main: A opened and loaded, B registered and loading
    handleDocumentEvent({ type: 'opened', doc: descriptor('A', 'writer', { state: 'loading' }) });
    handleDocumentEvent({ type: 'updated', doc: a });
    handleDocumentEvent({ type: 'opened', doc: descriptor('B', 'writer', { state: 'loading' }) });
    // the user closes A meanwhile
    handleDocumentEvent({ type: 'updated', doc: descriptor('A', 'writer', { state: 'closed' }) });
    handleDocumentEvent({ type: 'closed', docId: 'A' });
    expect(docIds()).toEqual(['B']);
    // main: B loaded; openDialog resolves with both descriptors as they were when each finished loading
    const b = descriptor('B', 'writer', { state: 'ready' });
    handleDocumentEvent({ type: 'updated', doc: b });
    answer.resolve([a, b]);
    await pending;
    await flush();
    expect(docIds()).toEqual(['B']);
    expect(useApp.getState().activeDocId).toBe('B');
  });

  it('a multi-file open keeps the state the events reported while the other files loaded', async () => {
    const answer = deferred<DocumentDescriptor[]>();
    ipc.handleAsync('documents:openDialog', () => answer.promise);
    const pending = openWithDialog();
    const a = descriptor('A', 'writer', { state: 'ready' });
    handleDocumentEvent({ type: 'opened', doc: descriptor('A', 'writer', { state: 'loading' }) });
    handleDocumentEvent({ type: 'updated', doc: a });
    handleDocumentEvent({ type: 'opened', doc: descriptor('B', 'writer', { state: 'loading' }) });
    // the user types in A: main reports modified once
    handleDocumentEvent({ type: 'updated', doc: { ...a, modified: true } });
    const b = descriptor('B', 'writer', { state: 'ready' });
    handleDocumentEvent({ type: 'updated', doc: b });
    answer.resolve([a, b]);
    await pending;
    await flush();
    expect(useApp.getState().documents.find((d) => d.docId === 'A')?.modified).toBe(true);
    expect(useApp.getState().activeDocId).toBe('B');
  });

  it('a created or opened document keeps the state its events reported, and is not brought back once closed', async () => {
    const created = deferred<DocumentDescriptor>();
    ipc.handleAsync('documents:create', () => created.promise);
    const creating = createDocument('calc');
    handleDocumentEvent({ type: 'opened', doc: descriptor('c1', 'calc', { state: 'loading' }) });
    handleDocumentEvent({ type: 'updated', doc: descriptor('c1', 'calc', { modified: true }) });
    created.resolve(descriptor('c1', 'calc', { state: 'loading' }));
    await creating;
    expect(useApp.getState().documents).toEqual([descriptor('c1', 'calc', { modified: true })]);
    expect(useApp.getState().activeDocId).toBe('c1');

    const opened = deferred<DocumentDescriptor>();
    ipc.handleAsync('documents:open', () => opened.promise);
    const opening = openPath('C:\\a\\Rapor.docx');
    handleDocumentEvent({ type: 'opened', doc: descriptor('w1', 'writer', { state: 'loading', path: 'C:\\a\\Rapor.docx' }) });
    handleDocumentEvent({ type: 'closed', docId: 'w1' }); // closed while loading
    opened.resolve(descriptor('w1', 'writer', { path: 'C:\\a\\Rapor.docx' }));
    await opening;
    expect(docIds()).toEqual(['c1']);
    expect(useApp.getState().activeDocId).toBe('c1');

    const restored = deferred<DocumentDescriptor>();
    ipc.handleAsync('recovery:restore', () => restored.promise);
    const restoring = restoreRecovery('s1');
    handleDocumentEvent({ type: 'opened', doc: descriptor('w2', 'writer', { state: 'loading' }) });
    handleDocumentEvent({ type: 'closed', docId: 'w2' });
    restored.resolve(descriptor('w2', 'writer', { modified: true }));
    await restoring;
    expect(docIds()).toEqual(['c1']);
  });

  it('adds a result that no event delivered', async () => {
    ipc.handle('documents:create', ({ kind }) => descriptor('n1', kind));
    await createDocument('writer');
    expect(docIds()).toEqual(['n1']);
    expect(useApp.getState().activeDocId).toBe('n1');
  });

  it('ignores a late update of a closed document', () => {
    handleDocumentEvent({ type: 'opened', doc: descriptor('w1', 'writer') });
    handleDocumentEvent({ type: 'closed', docId: 'w1' });
    handleDocumentEvent({ type: 'updated', doc: descriptor('w1', 'writer', { state: 'closed' }) });
    expect(docIds()).toEqual([]);
  });
});

/** A PDF controller stand-in whose flush (saveDocument + pdf:update) the test finishes. */
function fakeController(docId: string, log: string[]) {
  let current = deferred<void>();
  const controller = {
    docId,
    pdfDocument: {},
    flush: () => {
      log.push(`flush ${docId}`);
      return current.promise;
    },
  };
  registerController(controller as unknown as PdfController);
  return {
    finish: () => current.resolve(),
    fail: () => current.reject(new Error('pdf:update failed')),
    reset: () => {
      current = deferred<void>();
    },
    dispose: () => unregisterController(controller as unknown as PdfController),
  };
}

describe('pending PDF edits', () => {
  let log: string[];
  beforeEach(() => {
    log = [];
    ipc.handle('documents:close', (req) => {
      log.push(`close ${req.docId}${req.force ? ' (force)' : ''}`);
      return 'closed' as const;
    });
    ipc.handle('documents:flushDone', (req) => {
      log.push(`flushDone ${req.requestId}`);
    });
  });

  it('closing a PDF waits until its edits are in the working copy', async () => {
    upsertDocument(descriptor('p1', 'pdf'));
    const pdf = fakeController('p1', log);
    const closing = closeDocument('p1');
    await flush();
    expect(log).toEqual(['flush p1']); // documents:close not sent yet
    pdf.finish();
    await closing;
    expect(log).toEqual(['flush p1', 'close p1']);
    pdf.dispose();
  });

  it('pushes the edits first for the tab close button, a middle click and Ctrl+W', async () => {
    upsertDocument(descriptor('w1', 'writer'));
    upsertDocument(descriptor('p1', 'pdf'));
    setActiveDocId('p1');
    const pdf = fakeController('p1', log);
    pdf.finish();
    render(<Shell />);
    await act(flush);
    const tablist = screen.getByRole('tablist', { name: 'Open documents' });

    fireEvent.click(within(tablist).getByRole('button', { name: 'Close p1.pdf' }));
    await act(flush);
    const pdfTab = within(tablist).getAllByRole('tab')[1]!;
    fireEvent(pdfTab, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    await act(flush);
    fireEvent.keyDown(window, { key: 'w', code: 'KeyW', ctrlKey: true });
    await act(flush);
    expect(log).toEqual(['flush p1', 'close p1', 'flush p1', 'close p1', 'flush p1', 'close p1']);
    pdf.dispose();
  });

  it('a second close while the first one still pushes edits is not sent twice; a forced close does not wait', async () => {
    upsertDocument(descriptor('p1', 'pdf'));
    const pdf = fakeController('p1', log);
    const first = closeDocument('p1');
    const second = closeDocument('p1');
    expect(second).toBe(first);
    pdf.finish();
    await first;
    expect(log).toEqual(['flush p1', 'close p1']);

    pdf.reset();
    await closeDocument('p1', true);
    expect(log).toEqual(['flush p1', 'close p1', 'close p1 (force)']);
    pdf.dispose();
  });

  it('answers a flush request of the main process after the edits were pushed, also when that failed', async () => {
    upsertDocument(descriptor('p1', 'pdf'));
    const pdf = fakeController('p1', log);
    handleDocumentEvent({ type: 'flushRequest', docId: 'p1', requestId: 'r1' });
    await flush();
    expect(log).toEqual(['flush p1']);
    pdf.finish();
    await flush();
    expect(log).toEqual(['flush p1', 'flushDone r1']);
    expect(ipc.callsTo('documents:flushDone').map((c) => c.req)).toEqual([{ requestId: 'r1' }]);

    pdf.reset();
    handleDocumentEvent({ type: 'flushRequest', docId: 'p1', requestId: 'r2' });
    pdf.fail();
    await flush();
    expect(log).toEqual(['flush p1', 'flushDone r1', 'flush p1', 'flushDone r2']);
    pdf.dispose();
  });

  it('answers at once when nothing holds edits (office documents, unknown ids)', async () => {
    upsertDocument(descriptor('w1', 'writer'));
    handleDocumentEvent({ type: 'flushRequest', docId: 'w1', requestId: 'r1' });
    handleDocumentEvent({ type: 'flushRequest', docId: 'gone', requestId: 'r2' });
    await flush();
    expect(log).toEqual(['flushDone r1', 'flushDone r2']);
  });
});

describe('Calc input line', () => {
  let lineVisible: boolean;

  beforeEach(() => {
    lineVisible = true; // LibreOffice's default in a new engine instance
    ipc.handle('engine:subscribe', (req) => req.commands.map((command) => ({ command, enabled: true, value: command === '.uno:InputLineVisible' ? lineVisible : null })));
    ipc.handle('engine:dispatch', (req) => {
      if (req.command !== '.uno:InputLineVisible') return;
      lineVisible = !lineVisible;
      // The engine streams the new state (FeatureStateEvent) after the toggle.
      setTimeout(() => handleDocumentEvent({ type: 'state', docId: req.docId, command: req.command, enabled: true, value: lineVisible }), 0);
    });
  });

  function Host() {
    const doc = useApp((s) => s.documents[0]) as DocumentDescriptor;
    return <CalcWorkspace doc={doc} active />;
  }

  const update = (patch: Partial<DocumentDescriptor>) =>
    act(async () => {
      handleDocumentEvent({ type: 'updated', doc: descriptor('c1', 'calc', patch) });
      await flush();
    });
  const toggles = () => ipc.callsTo('engine:dispatch').filter((c) => (c.req as { command: string }).command === '.uno:InputLineVisible').length;

  it('hides LibreOffice\'s input line again after a crash restore or an engine restart', async () => {
    upsertDocument(descriptor('c1', 'calc'));
    setActiveDocId('c1');
    render(<Host />);
    await act(flush);
    expect(lineVisible).toBe(false); // hidden once for the first engine
    expect(toggles()).toBe(1);

    // The engine crashes and the document is restored into a fresh instance (input line visible again).
    await update({ state: 'crashed' });
    lineVisible = true;
    await update({ state: 'loading' });
    await update({ state: 'ready' });
    expect(lineVisible).toBe(false);
    expect(toggles()).toBe(2);

    // A hang that resolves (busy → ready) keeps the same engine: no second toggle.
    await update({ state: 'busy' });
    await update({ state: 'ready' });
    expect(lineVisible).toBe(false);
    expect(toggles()).toBe(2);
  });

  it('forgets the command states of an engine that crashed', () => {
    upsertDocument(descriptor('c1', 'calc'));
    setCommandState('c1', '.uno:InputLineVisible', { enabled: true, value: false });
    handleDocumentEvent({ type: 'updated', doc: descriptor('c1', 'calc', { state: 'crashed' }) });
    expect(getCommandState('c1', '.uno:InputLineVisible')).toBeUndefined();
  });
});
