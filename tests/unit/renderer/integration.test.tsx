// @vitest-environment jsdom
// @jsxRuntime automatic
/**
 * Shell ↔ module integration: `shell` actions go to the active module's ModuleDefinition.actions first (the
 * PDF module overrides save/print/undo/find/zoom), then to the shell's built-ins; the ribbon shows the PDF
 * module's `pdf:*` states and the engine's `.uno:` states; the title bar keeps its active look while a
 * native document view has the focus.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandState } from '@shared/engine-protocol';
import type { DocumentDescriptor } from '@shared/api/documents';
import { initI18n } from '../../../src/renderer/i18n';
import { calcModule } from '../../../src/renderer/modules/calc';
import { writerModule } from '../../../src/renderer/modules/writer';
import { impressModule } from '../../../src/renderer/modules/impress';
import { PDF_ACTIONS, pdfActions } from '../../../src/renderer/modules/pdf/actions';
import type { PdfController } from '../../../src/renderer/modules/pdf/controller/controller';
import { registerController, unregisterController } from '../../../src/renderer/modules/pdf/controller/registry';
import { pdfRibbon } from '../../../src/renderer/modules/pdf/ribbon';
import { startCommandBridge } from '../../../src/renderer/modules/pdf/state/commandBridge';
import { patchDoc, usePdfStore } from '../../../src/renderer/modules/pdf/state/store';
import { registerModules } from '../../../src/renderer/modules/registry';
import type { ModuleDefinition } from '../../../src/renderer/modules/types';
import { Ribbon } from '../../../src/renderer/ribbon/Ribbon';
import { keyTipInput, startKeyTips, useKeyTips } from '../../../src/renderer/ribbon/keytipStore';
import { runRibbonAction, useControlRuntime } from '../../../src/renderer/ribbon/runtime';
import { SHELL_ACTIONS, type RibbonAction, type RibbonStateBinding } from '../../../src/renderer/ribbon/types';
import { handleDocumentEvent } from '../../../src/renderer/services/bootstrap';
import { focusView } from '../../../src/renderer/services/engine';
import { isShellActionEnabled, runShellAction } from '../../../src/renderer/services/shellActions';
import { isAppActive, noteDocumentActivity, noteWindowFocus, noteWindowState, resetWindowActivity, useWindowActivity, VIEW_FOCUS_GRACE_MS } from '../../../src/renderer/services/windowActivity';
import { TitleBar } from '../../../src/renderer/shell/TitleBar';
import { openBackstage, setActiveDocId, upsertDocument, useApp } from '../../../src/renderer/state/appStore';
import { setCommandState, setContext } from '../../../src/renderer/state/commandStore';
import { descriptor, FakeIpc, flush, installIpc, removeIpc, resetRendererState } from './helpers';

const pdfModule = { kind: 'pdf', ribbon: pdfRibbon, actions: pdfActions, Workspace: () => null } as unknown as ModuleDefinition;

let ipc: FakeIpc;

beforeAll(() => {
  initI18n('tr');
  registerModules([writerModule, calcModule, impressModule, pdfModule]);
  startCommandBridge();
});

beforeEach(() => {
  resetRendererState();
  ipc = installIpc(new FakeIpc());
});

afterEach(() => {
  cleanup();
  removeIpc();
  usePdfStore.setState({ docs: {} } as never);
});

function open(doc: DocumentDescriptor): DocumentDescriptor {
  upsertDocument(doc);
  setActiveDocId(doc.docId);
  return doc;
}

/** A PDF controller stand-in that records what the module's actions ask of it. */
function fakePdfController(docId: string) {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return Promise.resolve();
    };
  const controller = {
    docId,
    pdfDocument: {},
    save: record('save'),
    print: record('print'),
    editingAction: record('editingAction'),
    zoomIn: record('zoomIn'),
    zoomOut: record('zoomOut'),
    setEditorTool: (tool: string) => {
      calls.push(['setEditorTool', tool]);
      patchDoc(docId, { editorTool: tool as never });
    },
  };
  registerController(controller as unknown as PdfController);
  return { calls, dispose: () => unregisterController(controller as unknown as PdfController) };
}

describe('shell action routing', () => {
  it('sends the generic ids of a PDF document to the PDF module instead of the shell built-ins', async () => {
    const doc = open(descriptor('p1', 'pdf', { format: 'pdf' }));
    patchDoc('p1', { status: 'ready' });
    const fake = fakePdfController('p1');
    for (const id of [SHELL_ACTIONS.save, SHELL_ACTIONS.saveAs, SHELL_ACTIONS.print, SHELL_ACTIONS.undo, SHELL_ACTIONS.redo, SHELL_ACTIONS.zoomIn, SHELL_ACTIONS.zoomOut, SHELL_ACTIONS.find]) {
      expect(isShellActionEnabled(id, doc), id).toBe(true);
      await runShellAction(id, undefined, doc);
    }
    expect(fake.calls).toEqual([['save', false], ['save', true], ['print'], ['editingAction', 'undo'], ['editingAction', 'redo'], ['zoomIn'], ['zoomOut']]);
    expect(usePdfStore.getState().docs['p1']?.findOpen).toBe(true);
    // Nothing went to the office document pipeline.
    expect(ipc.channels().filter((c) => c.startsWith('documents:') || c.startsWith('engine:'))).toEqual([]);
    fake.dispose();
  });

  it('runs the shell built-ins for office documents', async () => {
    ipc.handle('documents:save', () => ({ outcome: 'saved' as const }));
    ipc.handle('engine:dispatch', () => undefined);
    const doc = open(descriptor('w1', 'writer'));
    setCommandState('w1', '.uno:Zoom', { enabled: true, value: [{ __type: 'com.sun.star.beans.PropertyValue', Name: 'Value', Value: 100 }] });
    await runShellAction(SHELL_ACTIONS.save, undefined, doc);
    await runShellAction(SHELL_ACTIONS.undo, undefined, doc);
    await runShellAction(SHELL_ACTIONS.zoomIn, undefined, doc);
    await flush();
    expect(ipc.callsTo('documents:save')).toEqual([{ channel: 'documents:save', req: { docId: 'w1' } }]);
    expect(ipc.callsTo('engine:dispatch').map((c) => c.req)).toEqual([
      { docId: 'w1', command: '.uno:Undo' },
      { docId: 'w1', command: '.uno:Zoom', args: { 'Zoom.Value': 110 } },
    ]);
  });

  it('gates built-ins by the engine state (Undo disabled) and by the document kind', () => {
    const doc = open(descriptor('w1', 'writer'));
    expect(isShellActionEnabled(SHELL_ACTIONS.undo, doc)).toBe(true); // no state yet: optimistic
    setCommandState('w1', '.uno:Undo', { enabled: false, value: null });
    expect(isShellActionEnabled(SHELL_ACTIONS.undo, doc)).toBe(false);
    expect(isShellActionEnabled(SHELL_ACTIONS.exportPdf, doc)).toBe(true);
    const pdf = open(descriptor('p1', 'pdf'));
    expect(isShellActionEnabled(SHELL_ACTIONS.exportPdf, pdf)).toBe(false);
    expect(isShellActionEnabled(SHELL_ACTIONS.save, { ...pdf, state: 'loading' })).toBe(false);
    expect(isShellActionEnabled('no.such.action', doc)).toBe(false);
  });

  it('runs module-specific actions of office modules (Calc formula bar)', async () => {
    const doc = open(descriptor('c1', 'calc'));
    expect(useApp.getState().formulaBarVisible).toBe(true);
    await runShellAction('calc.toggleFormulaBar', undefined, doc);
    expect(useApp.getState().formulaBarVisible).toBe(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await runShellAction('no.such.action', undefined, doc);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('dispatches ribbon .uno: actions to the active document and returns the keyboard to it', async () => {
    ipc.handle('engine:dispatch', () => undefined);
    ipc.handle('view:focus', () => undefined);
    open(descriptor('w1', 'writer'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runRibbonAction({ type: 'uno', command: '.uno:Bold' });
    runRibbonAction({ type: 'uno', command: '.uno:InsertMultiIndex' });
    runRibbonAction({ type: 'uno', command: '.uno:RunMacro' }); // not on the allow-list: blocked in the renderer
    await flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('.uno:RunMacro'));
    warn.mockRestore();
    expect(ipc.calls.map((c) => [c.channel, (c.req as { command?: string }).command])).toEqual([
      ['engine:dispatch', '.uno:Bold'],
      ['engine:dispatch', '.uno:InsertMultiIndex'],
      ['view:focus', undefined],
      ['view:focus', undefined],
    ]);
  });
});

describe('control runtime', () => {
  function Probe({ action, binding, onState }: { action: RibbonAction; binding?: RibbonStateBinding; onState: (s: ReturnType<typeof useControlRuntime>) => void }) {
    onState(useControlRuntime(action, binding));
    return null;
  }

  it('reads pdf:* states published by the PDF module (pressed and enabled)', () => {
    open(descriptor('p1', 'pdf'));
    let state: ReturnType<typeof useControlRuntime> | null = null;
    const binding: RibbonStateBinding = { command: 'pdf:tool', pressed: (v) => v === 'highlight' };
    render(<Probe action={{ type: 'shell', id: PDF_ACTIONS.tool, payload: 'highlight' }} binding={binding} onState={(s) => (state = s)} />);
    act(() => patchDoc('p1', { status: 'loading' }));
    expect(state).toMatchObject({ enabled: false, pressed: false });
    act(() => patchDoc('p1', { status: 'ready', editorTool: 'highlight' }));
    expect(state).toMatchObject({ enabled: true, pressed: true, value: 'highlight' });
    act(() => patchDoc('p1', { editorTool: 'ink' }));
    expect(state).toMatchObject({ enabled: true, pressed: false });
  });

  it('disables office controls while the engine shows a dialog or the document is not ready', () => {
    open(descriptor('w1', 'writer'));
    let state: ReturnType<typeof useControlRuntime> | null = null;
    render(<Probe action={{ type: 'uno', command: '.uno:Bold' }} onState={(s) => (state = s)} />);
    expect(state).toMatchObject({ enabled: true, pressed: false });
    act(() => setCommandState('w1', '.uno:Bold', { enabled: true, value: true }));
    expect(state).toMatchObject({ enabled: true, pressed: true });
    act(() => useApp.setState({ busy: { w1: { busy: true, reason: 'dialog' } } }));
    expect(state).toMatchObject({ enabled: false });
    act(() => useApp.setState({ busy: {} }));
    act(() => upsertDocument(descriptor('w1', 'writer', { state: 'loading' })));
    expect(state).toMatchObject({ enabled: false });
  });
});

describe('ribbon', () => {
  it('shows the PDF tool state and routes PDF tool buttons to the module', async () => {
    const doc = open(descriptor('p1', 'pdf'));
    patchDoc('p1', { status: 'ready', editorTool: 'none' });
    const fake = fakePdfController('p1');
    render(<Ribbon module={pdfModule} doc={doc} />);
    const highlight = screen.getByRole('button', { name: 'Vurgula' });
    expect(highlight.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(highlight);
    await act(flush);
    expect(fake.calls).toContainEqual(['setEditorTool', 'highlight']);
    expect(highlight.getAttribute('aria-pressed')).toBe('true');
    act(() => patchDoc('p1', { status: 'loading' }));
    expect(highlight.getAttribute('aria-disabled')).toBe('true');
    expect(ipc.calls).toEqual([]); // PDF controls never reach the engine
    fake.dispose();
  });

  it('subscribes the visible tab of an office document and mirrors the engine state', async () => {
    const states: CommandState[] = [
      { command: '.uno:Bold', enabled: true, value: true },
      { command: '.uno:Italic', enabled: false, value: false },
    ];
    ipc.handle('engine:subscribe', () => states);
    ipc.handle('engine:dispatch', () => undefined);
    ipc.handle('view:focus', () => undefined);
    const doc = open(descriptor('w1', 'writer'));
    render(<Ribbon module={writerModule} doc={doc} extraCommands={['.uno:Undo']} />);
    await act(flush);
    const subscribed = ipc.callsTo('engine:subscribe').flatMap((c) => (c.req as { commands: string[] }).commands);
    expect(subscribed).toEqual(expect.arrayContaining(['.uno:Bold', '.uno:Italic', '.uno:CharFontName', '.uno:FontHeight', '.uno:Undo']));
    expect(subscribed.every((c) => c.startsWith('.uno:'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Kalın' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'İtalik' }).getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Kalın' }));
    await act(flush);
    expect(ipc.callsTo('engine:dispatch').map((c) => c.req)).toEqual([{ docId: 'w1', command: '.uno:Bold' }]);

    act(() => handleDocumentEvent({ type: 'state', docId: 'w1', command: '.uno:Bold', enabled: true, value: false }));
    expect(screen.getByRole('button', { name: 'Kalın' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows contextual tabs for the engine context and selects tabs with KeyTips', async () => {
    ipc.handle('engine:subscribe', () => []);
    const doc = open(descriptor('w1', 'writer'));
    render(<Ribbon module={writerModule} doc={doc} />);
    const tablist = screen.getByRole('tablist', { name: 'Şerit sekmeleri' });
    expect(within(tablist).queryByRole('tab', { name: 'Tablo Düzeni' })).toBeNull();
    act(() => setContext('w1', 'Table'));
    expect(within(tablist).getByRole('tab', { name: 'Tablo Düzeni' })).toBeTruthy();

    act(() => startKeyTips());
    expect(screen.getAllByText('N', { selector: '.rb-keytip' })).toHaveLength(1);
    act(() => {
      keyTipInput('n');
    });
    expect(within(tablist).getByRole('tab', { name: 'Ekle' }).getAttribute('aria-selected')).toBe('true');
    expect(useKeyTips.getState().scope).toBe('tab:insert');
    // Insert › Picture has the KeyTip P in this scope.
    expect(screen.getAllByText('P', { selector: '.rb-keytip' }).length).toBeGreaterThan(0);
  });

  it('collapses and pins the ribbon through the settings', async () => {
    ipc.handle('engine:subscribe', () => []);
    ipc.handle('app:settings:update', (req) => ({ ...useApp.getState().settings, ...req }));
    const doc = open(descriptor('c1', 'calc'));
    render(<Ribbon module={calcModule} doc={doc} />);
    expect(screen.getByRole('tabpanel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Şeridi daralt' }));
    await act(flush);
    expect(useApp.getState().settings.ui.ribbonCollapsed).toBe(true);
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(ipc.callsTo('app:settings:update').map((c) => c.req)).toEqual([{ ui: expect.objectContaining({ ribbonCollapsed: true }) }]);
  });
});

describe('title bar active look', () => {
  let now = 0;
  beforeEach(() => {
    now = 10_000;
    resetWindowActivity({ clock: () => now });
  });

  it('prefers WindowState.active from the main process', () => {
    open(descriptor('w1', 'writer'));
    noteWindowState({ maximized: false, fullScreen: false, focused: false, active: true });
    expect(isAppActive()).toBe(true);
    noteWindowState({ maximized: false, fullScreen: false, focused: false, active: false });
    expect(isAppActive()).toBe(false);
    noteWindowFocus(true);
    expect(isAppActive()).toBe(true);
  });

  it('stays active when the keyboard was handed to the document view just before the blur', async () => {
    ipc.handle('view:focus', () => undefined);
    open(descriptor('w1', 'writer'));
    await focusView('w1');
    now += 200;
    noteWindowFocus(false);
    expect(useWindowActivity.getState()).toMatchObject({ windowFocused: false, viewFocused: true });
    expect(isAppActive()).toBe(true);
    noteWindowFocus(false); // the IPC confirmation of the same blur changes nothing
    expect(isAppActive()).toBe(true);
    noteWindowFocus(true);
    now += VIEW_FOCUS_GRACE_MS * 2;
    noteWindowFocus(false);
    expect(isAppActive()).toBe(false); // switched to another application
  });

  it('becomes active again when the document reports activity while the window is blurred', () => {
    open(descriptor('w1', 'writer'));
    noteWindowFocus(false);
    expect(isAppActive()).toBe(false);
    noteDocumentActivity('other');
    expect(isAppActive()).toBe(false);
    handleDocumentEvent({ type: 'state', docId: 'w1', command: '.uno:Undo', enabled: true, value: 'Geri al: Yazma' });
    expect(isAppActive()).toBe(true);
  });

  it('stays active while a LibreOffice dialog of the document is open', () => {
    open(descriptor('c1', 'calc'));
    noteWindowFocus(false);
    expect(isAppActive()).toBe(false);
    handleDocumentEvent({ type: 'busy', docId: 'c1', busy: true, reason: 'dialog' });
    expect(isAppActive()).toBe(true);
  });

  it('ignores document activity for PDFs and while the backstage is open', () => {
    open(descriptor('p1', 'pdf'));
    noteWindowFocus(false);
    noteDocumentActivity('p1');
    expect(isAppActive()).toBe(false);
    open(descriptor('w1', 'writer'));
    openBackstage('info');
    noteDocumentActivity('w1');
    expect(isAppActive()).toBe(false);
  });

  it('renders the inactive title bar and the document title', () => {
    open(descriptor('w1', 'writer', { title: 'Rapor.docx', modified: true }));
    const { container } = render(<TitleBar />);
    const header = container.querySelector('header')!;
    expect(header.className).toBe('vr-titlebar');
    expect(document.title).toBe('• Rapor.docx — Simpaper');
    expect(within(header).getByText('Rapor.docx')).toBeTruthy();
    act(() => noteWindowFocus(false));
    expect(header.className).toContain('vr-titlebar--inactive');
    expect(header.getAttribute('data-active')).toBe('false');
  });
});
