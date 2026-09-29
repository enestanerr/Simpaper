// @vitest-environment jsdom
// @jsxRuntime automatic
/**
 * Airspace manager (freeze-frame): HTML popups that overlap the native LibreOffice view freeze it before they
 * are painted and unfreeze it after they close; nothing happens for PDF documents (pdf.js is HTML). The freeze
 * follows the document whose view is shown (activation, backstage, engine state), and open dialogs keep it
 * when overlays are released at once (window blur, LibreOffice dialog).
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings, type WindowState } from '@shared/api/app';
import { initI18n, setLanguage } from '../../../src/renderer/i18n';
import { calcModule } from '../../../src/renderer/modules/calc';
import { impressModule } from '../../../src/renderer/modules/impress';
import { registerModules } from '../../../src/renderer/modules/registry';
import { writerModule } from '../../../src/renderer/modules/writer';
import { Ribbon } from '../../../src/renderer/ribbon/Ribbon';
import { handleDocumentEvent, wireEvents } from '../../../src/renderer/services/bootstrap';
import {
  acquireOverlay,
  isOverlayHeld,
  overlapsNativeView,
  overlayPending,
  rectsIntersect,
  releaseAllOverlays,
  REVEAL_TIMEOUT_MS,
  whenOverlayReady,
} from '../../../src/renderer/services/overlay';
import { Shell } from '../../../src/renderer/shell/Shell';
import { closeBackstage, openBackstage, removeDocument, setActiveDocId, upsertDocument, useApp } from '../../../src/renderer/state/appStore';
import { registerSurface, useViews } from '../../../src/renderer/state/viewStore';
import { DocumentSurface } from '../../../src/renderer/modules/common/DocumentSurface';
import { Dialog } from '../../../src/renderer/ui/Dialog';
import { Popup } from '../../../src/renderer/ui/Popup';
import { descriptor, FakeIpc, flush, installIpc, removeIpc, resetRendererState } from './helpers';

const SNAPSHOT = 'data:image/png;base64,iVBORw0KGgo=';
const OVER_DOCUMENT = { left: 100, top: 150, right: 300, bottom: 400 };
const OVER_RIBBON = { left: 100, top: 10, right: 300, bottom: 90 };

let ipc: FakeIpc;
let unregisterSurface: () => void = () => {};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A document surface placeholder covering the area below the ribbon (jsdom has no layout). */
function mountSurface(docId: string): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 0, top: 120, right: 1000, bottom: 700, x: 0, y: 120, width: 1000, height: 580, toJSON: () => ({}) });
  document.body.append(el);
  unregisterSurface = registerSurface(docId, el);
  return el;
}

function openDocument(docId: string, kind: 'writer' | 'calc' | 'impress' | 'pdf') {
  upsertDocument(descriptor(docId, kind));
  setActiveDocId(docId);
  if (kind !== 'pdf') mountSurface(docId);
}

const freezes = () => ipc.callsTo('view:freeze').map((c) => c.req);
const unfreezes = () => ipc.callsTo('view:unfreeze').map((c) => c.req);

beforeEach(() => {
  resetRendererState();
  ipc = installIpc(new FakeIpc());
  ipc.handle('view:freeze', () => SNAPSHOT);
  ipc.handle('view:unfreeze', () => undefined);
});

afterEach(() => {
  cleanup();
  unregisterSurface();
  document.body.innerHTML = '';
  vi.useRealTimers();
  releaseAllOverlays();
  removeIpc();
});

describe('overlap test', () => {
  it('intersects rectangles only when they share area', () => {
    expect(rectsIntersect(OVER_DOCUMENT, { left: 0, top: 120, right: 1000, bottom: 700 })).toBe(true);
    expect(rectsIntersect(OVER_RIBBON, { left: 0, top: 120, right: 1000, bottom: 700 })).toBe(false);
    expect(rectsIntersect({ left: 0, top: 0, right: 10, bottom: 120 }, { left: 0, top: 120, right: 1000, bottom: 700 })).toBe(false);
  });

  it('knows whether a popup would be hidden behind the native view', () => {
    openDocument('w1', 'writer');
    expect(overlapsNativeView(OVER_DOCUMENT)).toBe(true);
    expect(overlapsNativeView(OVER_RIBBON)).toBe(false);
    expect(overlapsNativeView(null)).toBe(true); // unknown extent (dialog scrim): assume it overlaps
  });
});

describe('freeze-frame for office documents', () => {
  it('freezes once for nested popups and unfreezes after the last one closes (with a short grace period)', async () => {
    vi.useFakeTimers();
    openDocument('w1', 'writer');
    const releaseMenu = acquireOverlay(OVER_DOCUMENT);
    expect(freezes()).toEqual([{ docId: 'w1' }]);
    expect(useViews.getState().frozen['w1']).toBeNull(); // placeholder frozen at once, image follows
    await vi.runAllTimersAsync();
    expect(useViews.getState().frozen['w1']).toBe(SNAPSHOT);

    const releaseTip = acquireOverlay(OVER_DOCUMENT);
    expect(freezes()).toHaveLength(1);
    releaseMenu();
    await vi.advanceTimersByTimeAsync(500);
    expect(unfreezes()).toEqual([]);
    expect(isOverlayHeld()).toBe(true);

    releaseTip();
    releaseTip(); // releasing twice is harmless
    await vi.advanceTimersByTimeAsync(100);
    expect(unfreezes()).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(unfreezes()).toEqual([{ docId: 'w1' }]);
    expect(useViews.getState().frozen['w1']).toBeUndefined();
    expect(isOverlayHeld()).toBe(false);
  });

  it('keeps the view frozen while moving from one popup to the next (no flicker)', async () => {
    vi.useFakeTimers();
    openDocument('c1', 'calc');
    acquireOverlay(OVER_DOCUMENT)();
    await vi.advanceTimersByTimeAsync(50);
    const again = acquireOverlay(OVER_DOCUMENT);
    await vi.advanceTimersByTimeAsync(1000);
    expect(freezes()).toHaveLength(1);
    expect(unfreezes()).toHaveLength(0);
    again();
    await vi.advanceTimersByTimeAsync(1000);
    expect(unfreezes()).toHaveLength(1);
  });

  it('waits for a slow capture before unfreezing, and reveals popups at the latest after the timeout', async () => {
    vi.useFakeTimers();
    const capture = deferred<string | null>();
    ipc.handleAsync('view:freeze', () => capture.promise);
    openDocument('i1', 'impress');
    const release = acquireOverlay(OVER_DOCUMENT);
    expect(overlayPending()).toBe(true);
    let revealed = false;
    void whenOverlayReady().then(() => {
      revealed = true;
    });
    await vi.advanceTimersByTimeAsync(REVEAL_TIMEOUT_MS - 10);
    expect(revealed).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(revealed).toBe(true); // a hung engine never blocks the UI

    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(unfreezes()).toEqual([]); // the capture is still running
    capture.resolve(SNAPSHOT);
    await vi.runAllTimersAsync();
    expect(unfreezes()).toEqual([{ docId: 'i1' }]);
    expect(overlayPending()).toBe(false);
  });

  it('ignores popups outside the document area', () => {
    openDocument('w1', 'writer');
    const release = acquireOverlay(OVER_RIBBON);
    expect(freezes()).toEqual([]);
    expect(isOverlayHeld()).toBe(false);
    release();
  });

  it('releases everything at once (window blur, engine dialog)', async () => {
    openDocument('w1', 'writer');
    acquireOverlay(OVER_DOCUMENT);
    acquireOverlay(null);
    releaseAllOverlays();
    await flush();
    expect(unfreezes()).toEqual([{ docId: 'w1' }]);
    expect(isOverlayHeld()).toBe(false);
  });

  it('does not unfreeze a document that was closed meanwhile', async () => {
    vi.useFakeTimers();
    openDocument('w1', 'writer');
    const release = acquireOverlay(null);
    await vi.advanceTimersByTimeAsync(10);
    removeDocument('w1');
    release();
    await vi.advanceTimersByTimeAsync(500);
    expect(unfreezes()).toEqual([]);
  });
});

describe('no freeze-frame where no native view is shown', () => {
  it('never freezes for PDF documents', () => {
    openDocument('p1', 'pdf');
    const release = acquireOverlay(null);
    acquireOverlay(OVER_DOCUMENT)();
    release();
    expect(ipc.calls).toEqual([]);
    expect(overlayPending()).toBe(false);
  });

  it('never freezes while the backstage covers the window or no document is open', () => {
    acquireOverlay(null)();
    openDocument('w1', 'writer');
    openBackstage('info');
    acquireOverlay(null)();
    expect(ipc.calls).toEqual([]);
  });

  it('is a no-op without the preload bridge', () => {
    removeIpc();
    openDocument('w1', 'writer');
    expect(() => acquireOverlay(null)()).not.toThrow();
    expect(isOverlayHeld()).toBe(false);
  });
});

describe('components', () => {
  // jsdom has no layout: give elements a size so popups have an extent.
  const sizes = { offsetWidth: 180, offsetHeight: 200 } as const;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    for (const [prop, value] of Object.entries(sizes)) {
      originals.set(prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop));
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
    }
  });
  afterEach(() => {
    for (const [prop, descriptor] of originals) if (descriptor) Object.defineProperty(HTMLElement.prototype, prop, descriptor);
  });

  /** A ribbon-like button whose drop-down opens over the document area (jsdom has no layout, so stub it). */
  function Anchor({ onReady }: { onReady: (el: HTMLElement) => void }) {
    return (
      <button
        ref={(el) => {
          if (!el) return;
          el.getBoundingClientRect = () => ({ left: 100, top: 90, right: 200, bottom: 118, x: 100, y: 90, width: 100, height: 28, toJSON: () => ({}) });
          onReady(el);
        }}
      >
        anchor
      </button>
    );
  }

  async function renderPopup(open: boolean, anchor: HTMLElement | null) {
    return render(
      <Popup anchor={anchor} open={open} onClose={() => undefined} ariaLabel="menu" role="dialog">
        <button>item</button>
      </Popup>,
    );
  }

  it('freezes an office document before a popup is painted and unfreezes after it closes', async () => {
    const capture = deferred<string | null>();
    ipc.handleAsync('view:freeze', () => capture.promise);
    openDocument('w1', 'writer');
    let anchor: HTMLElement | null = null;
    render(<Anchor onReady={(el) => (anchor = el)} />);
    const view = await renderPopup(true, anchor);
    const popup = screen.getByRole('dialog', { name: 'menu' });
    expect(freezes()).toEqual([{ docId: 'w1' }]);
    expect(popup.style.opacity).toBe('0'); // laid out and focusable, not painted yet
    expect(popup.contains(document.activeElement)).toBe(true);
    await act(async () => {
      capture.resolve(SNAPSHOT);
      await flush();
    });
    expect(popup.style.opacity).toBe('');
    view.rerender(
      <Popup anchor={anchor} open={false} onClose={() => undefined} ariaLabel="menu" role="dialog">
        <button>item</button>
      </Popup>,
    );
    expect(screen.queryByRole('dialog', { name: 'menu' })).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(unfreezes()).toEqual([{ docId: 'w1' }]);
  });

  it('shows popups at once and never freezes for PDF documents', async () => {
    openDocument('p1', 'pdf');
    let anchor: HTMLElement | null = null;
    render(<Anchor onReady={(el) => (anchor = el)} />);
    await renderPopup(true, anchor);
    const popup = screen.getByRole('dialog', { name: 'menu' });
    expect(popup.style.opacity).toBe('');
    expect(popup.style.visibility).toBe('visible');
    expect(ipc.calls).toEqual([]);
  });

  it('dialogs hold the freeze-frame for their whole lifetime', async () => {
    openDocument('c1', 'calc');
    const view = render(
      <Dialog title="Test" onCancel={() => undefined}>
        <p>body</p>
      </Dialog>,
    );
    await act(flush);
    expect(freezes()).toEqual([{ docId: 'c1' }]);
    expect(screen.getByRole('dialog', { name: 'Test' }).style.opacity).toBe('');
    view.unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(unfreezes()).toEqual([{ docId: 'c1' }]);
  });

  it('the document surface shows the snapshot while frozen', async () => {
    upsertDocument(descriptor('w1', 'writer'));
    setActiveDocId('w1');
    ipc.handle('view:setBounds', () => undefined);
    ipc.handle('view:setVisible', () => undefined);
    const view = render(<DocumentSurface docId="w1" visible label="Belge alanı" />);
    const region = screen.getByRole('region', { name: 'Belge alanı' });
    // The surface registered itself; stub its layout like mountSurface does.
    region.getBoundingClientRect = () => ({ left: 0, top: 120, right: 1000, bottom: 700, x: 0, y: 120, width: 1000, height: 580, toJSON: () => ({}) });
    let release: () => void = () => {};
    await act(async () => {
      release = acquireOverlay(OVER_DOCUMENT);
      await flush();
    });
    expect(region.getAttribute('data-frozen')).toBe('true');
    expect(region.querySelector('img')?.getAttribute('src')).toBe(SNAPSHOT);
    expect(ipc.callsTo('view:setVisible')).toEqual([{ channel: 'view:setVisible', req: { docId: 'w1', visible: true } }]);
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(region.getAttribute('data-frozen')).toBeNull();
    view.unmount();
  });
});

describe('the freeze follows the shown document', () => {
  it('unfreezes a view at once when another document is activated, and freezes that one while held', async () => {
    vi.useFakeTimers();
    openDocument('w1', 'writer');
    const release = acquireOverlay(OVER_DOCUMENT);
    await vi.advanceTimersByTimeAsync(10);
    expect(freezes()).toEqual([{ docId: 'w1' }]);

    upsertDocument(descriptor('w2', 'writer'));
    setActiveDocId('w2');
    await vi.advanceTimersByTimeAsync(10); // not after the 150 ms grace period
    expect(unfreezes()).toEqual([{ docId: 'w1' }]);
    expect(freezes()).toEqual([{ docId: 'w1' }, { docId: 'w2' }]);
    expect(useViews.getState().frozen['w1']).toBeUndefined();
    expect(useViews.getState().frozen['w2']).toBe(SNAPSHOT);

    release();
    await vi.advanceTimersByTimeAsync(200);
    expect(unfreezes()).toEqual([{ docId: 'w1' }, { docId: 'w2' }]);
    expect(isOverlayHeld()).toBe(false);
  });

  it('drops a pending release of the previous document when another one is activated', async () => {
    vi.useFakeTimers();
    openDocument('w1', 'writer');
    acquireOverlay(null)();
    await vi.advanceTimersByTimeAsync(10); // the popup closed; the grace period is running
    upsertDocument(descriptor('w2', 'writer'));
    setActiveDocId('w2');
    await vi.advanceTimersByTimeAsync(10);
    expect(unfreezes()).toEqual([{ docId: 'w1' }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(unfreezes()).toEqual([{ docId: 'w1' }]); // once; nothing is frozen for w2
    expect(freezes()).toEqual([{ docId: 'w1' }]);
  });

  it('unfreezes at once when the backstage opens and freezes again when it closes while a popup is open', async () => {
    vi.useFakeTimers();
    openDocument('w1', 'writer');
    const release = acquireOverlay(OVER_DOCUMENT);
    openBackstage('info');
    await vi.advanceTimersByTimeAsync(10);
    expect(unfreezes()).toEqual([{ docId: 'w1' }]); // after its capture, so the view host stays balanced
    closeBackstage();
    expect(freezes()).toEqual([{ docId: 'w1' }, { docId: 'w1' }]);
    release();
    await vi.advanceTimersByTimeAsync(200);
    expect(unfreezes()).toEqual([{ docId: 'w1' }, { docId: 'w1' }]);
  });

  it('keeps the freeze of a document whose engine stops responding and drops it when the engine crashes', async () => {
    vi.useFakeTimers();
    openDocument('w1', 'writer');
    const release = acquireOverlay(null);
    await vi.advanceTimersByTimeAsync(10);
    upsertDocument(descriptor('w1', 'writer', { state: 'busy' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(unfreezes()).toEqual([]); // the hung window stays hidden behind the dialog
    upsertDocument(descriptor('w1', 'writer', { state: 'crashed' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(unfreezes()).toEqual([{ docId: 'w1' }]);
    release();
    await vi.advanceTimersByTimeAsync(500);
    expect(unfreezes()).toEqual([{ docId: 'w1' }]);
    expect(freezes()).toHaveLength(1);
  });

  it('measures the surface of the shown document, not the hidden slot of the document frozen before', () => {
    const first = mountSurface('w1');
    upsertDocument(descriptor('w1', 'writer'));
    setActiveDocId('w1');
    const release = acquireOverlay(null); // a dialog freezes w1
    upsertDocument(descriptor('w2', 'writer'));
    setActiveDocId('w2');
    // w1's slot is hidden now (display: none, an empty rect); w2's surface covers the document area.
    first.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, x: 0, y: 0, width: 0, height: 0, toJSON: () => ({}) });
    const second = document.createElement('div');
    second.getBoundingClientRect = () => ({ left: 0, top: 120, right: 1000, bottom: 700, x: 0, y: 120, width: 1000, height: 580, toJSON: () => ({}) });
    document.body.append(second);
    const unregister = registerSurface('w2', second);
    // A menu opened over w2 now is counted (and keeps w2 frozen after the dialog closes).
    expect(overlapsNativeView(OVER_DOCUMENT)).toBe(true);
    expect(overlapsNativeView(OVER_RIBBON)).toBe(false);
    release();
    unregister();
  });
});

/** jsdom has no layout: every element covers the document area, and popups get a size. */
function stubLayout(): () => void {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 100, right: 1000, bottom: 700, x: 0, y: 100, width: 1000, height: 600, toJSON: () => ({}) }) as DOMRect;
  for (const [prop, value] of Object.entries({ offsetWidth: 180, offsetHeight: 200 })) {
    originals.set(prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop));
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
  }
  return () => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    for (const [prop, desc] of originals) if (desc) Object.defineProperty(HTMLElement.prototype, prop, desc);
  };
}

const BLURRED: WindowState = { maximized: false, fullScreen: false, focused: false, active: false };
const FOCUSED: WindowState = { maximized: false, fullScreen: false, focused: true, active: true };

describe('in the shell', () => {
  let off: () => void = () => {};
  let restoreLayout: () => void = () => {};

  beforeAll(() => registerModules([writerModule, calcModule, impressModule]));

  beforeEach(async () => {
    initI18n('en');
    await setLanguage('en');
    ipc.handle('documents:recent', () => []);
    ipc.handle('recovery:list', () => []);
    ipc.handle('documents:activate', () => undefined);
    ipc.handle('documents:answerPrompt', () => undefined);
    ipc.handle('engine:subscribe', () => []);
    ipc.handle('engine:dispatch', () => undefined);
    ipc.handle('engine:query', () => ({ docId: 'x', modified: false, title: 'x' }) as never);
    ipc.handle('view:setBounds', () => undefined);
    ipc.handle('view:setVisible', () => undefined);
    ipc.handle('view:focus', () => undefined);
    ipc.handle('app:settings:update', (req) => ({ ...useApp.getState().settings, ...req }) as Settings);
    off = wireEvents();
  });

  afterEach(() => {
    off();
    restoreLayout();
    restoreLayout = () => {};
  });

  const wait = (ms: number) =>
    act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });

  it('quit with two modified documents: the second prompt freezes the next document, the first is unfrozen at once', async () => {
    upsertDocument(descriptor('A', 'writer', { modified: true }));
    upsertDocument(descriptor('B', 'writer', { modified: true }));
    handleDocumentEvent({ type: 'activated', docId: 'A' });
    render(<Shell />);
    await act(flush);
    // main (quit): activate(A), prompt(A)
    await act(async () => {
      handleDocumentEvent({ type: 'activated', docId: 'A' });
      handleDocumentEvent({ type: 'prompt', prompt: { id: 'p1', kind: 'unsavedChanges', docId: 'A', fileName: 'A.docx' } });
      await flush();
    });
    expect(freezes()).toEqual([{ docId: 'A' }]);

    // "Don't save": main discards A and asks about B a few milliseconds later (within the release grace period).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /don.t save/i }));
    });
    await act(async () => {
      handleDocumentEvent({ type: 'activated', docId: 'B' });
      handleDocumentEvent({ type: 'prompt', prompt: { id: 'p2', kind: 'unsavedChanges', docId: 'B', fileName: 'B.docx' } });
      await flush();
    });
    expect(within(screen.getByRole('alertdialog')).getByText(/"B\.docx"/)).toBeTruthy();
    expect(freezes()).toEqual([{ docId: 'A' }, { docId: 'B' }]);
    expect(unfreezes()).toEqual([{ docId: 'A' }]);

    // B stays frozen (its window hidden) while its prompt is open.
    await wait(300);
    expect(unfreezes()).toEqual([{ docId: 'A' }]);
    expect(useViews.getState().frozen['B']).toBe(SNAPSHOT);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /don.t save/i }));
    });
    await wait(300);
    expect(unfreezes()).toEqual([{ docId: 'A' }, { docId: 'B' }]);
  });

  it('Ctrl+Tab while a ribbon menu is open moves the freeze to the next document', async () => {
    restoreLayout = stubLayout();
    upsertDocument(descriptor('A', 'writer'));
    upsertDocument(descriptor('B', 'writer'));
    setActiveDocId('A');
    render(<Shell />);
    await act(flush);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Paste options' }));
      await flush();
    });
    const menu = screen.getByRole('menu', { name: 'Paste' });
    expect(freezes()).toEqual([{ docId: 'A' }]);

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Tab', code: 'Tab', ctrlKey: true });
      await flush();
    });
    expect(useApp.getState().activeDocId).toBe('B');
    expect(menu.isConnected).toBe(true); // same ribbon: the menu stays open
    expect(freezes()).toEqual([{ docId: 'A' }, { docId: 'B' }]);
    expect(unfreezes()).toEqual([{ docId: 'A' }]);

    await act(async () => {
      fireEvent.keyDown(menu, { key: 'Escape' });
    });
    await wait(300);
    expect(screen.queryByRole('menu', { name: 'Paste' })).toBeNull();
    expect(unfreezes()).toEqual([{ docId: 'A' }, { docId: 'B' }]);
  });

  it('an open dialog keeps the document frozen across a window blur and a LibreOffice dialog', async () => {
    openDocument('w1', 'writer');
    const view = render(
      <Dialog title="Save changes?" onCancel={() => undefined}>
        <p>body</p>
      </Dialog>,
    );
    await act(flush);
    expect(freezes()).toEqual([{ docId: 'w1' }]);
    // Alt+Tab to another application and back; a LibreOffice dialog opens and closes meanwhile.
    await act(async () => {
      ipc.emit('app:windowState', BLURRED);
      ipc.emit('documents:event', { type: 'busy', docId: 'w1', busy: true, reason: 'dialog' });
      await flush();
      ipc.emit('documents:event', { type: 'busy', docId: 'w1', busy: false, reason: 'dialog' });
      ipc.emit('app:windowState', FOCUSED);
      await flush();
    });
    await wait(300);
    expect(unfreezes()).toEqual([]);
    expect(isOverlayHeld()).toBe(true);
    expect(useViews.getState().frozen['w1']).toBe(SNAPSHOT);
    expect(screen.getByRole('dialog', { name: 'Save changes?' })).toBeTruthy();

    view.unmount();
    await wait(300);
    expect(unfreezes()).toEqual([{ docId: 'w1' }]);
  });

  it('menus are still released at once when the window loses the focus', async () => {
    openDocument('w1', 'writer');
    acquireOverlay(OVER_DOCUMENT);
    await act(async () => {
      ipc.emit('app:windowState', BLURRED);
      await flush();
    });
    expect(unfreezes()).toEqual([{ docId: 'w1' }]);
    expect(isOverlayHeld()).toBe(false);
  });

  it('closes the peeking ribbon when a LibreOffice dialog or a window blur releases the overlays', async () => {
    restoreLayout = stubLayout();
    useApp.setState({ settings: { ...structuredClone(DEFAULT_SETTINGS), ui: { ...DEFAULT_SETTINGS.ui, ribbonCollapsed: true } } });
    openDocument('w1', 'writer');
    render(<Ribbon module={writerModule} doc={descriptor('w1', 'writer')} />);
    const insert = screen.getByRole('tab', { name: 'Insert' });
    await act(async () => {
      fireEvent.click(insert);
      await flush();
    });
    expect(useApp.getState().ribbonPeek).toBe(true);
    expect(freezes()).toHaveLength(1);

    // A command in the panel opens a LibreOffice dialog (Insert > Picture): the panel must not stay open
    // under the uncovered document window.
    await act(async () => {
      handleDocumentEvent({ type: 'busy', docId: 'w1', busy: true, reason: 'dialog' });
      await flush();
    });
    expect(useApp.getState().ribbonPeek).toBe(false);
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(unfreezes()).toHaveLength(1);

    // Clicking the tab again shows the panel over a frozen document again.
    await act(async () => {
      handleDocumentEvent({ type: 'busy', docId: 'w1', busy: false, reason: 'dialog' });
      fireEvent.click(insert);
      await flush();
    });
    expect(useApp.getState().ribbonPeek).toBe(true);
    expect(freezes().length - unfreezes().length).toBe(1);

    await act(async () => {
      ipc.emit('app:windowState', BLURRED);
      await flush();
    });
    expect(useApp.getState().ribbonPeek).toBe(false);
    expect(freezes().length - unfreezes().length).toBe(0);
  });
});
