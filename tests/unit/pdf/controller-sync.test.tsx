// @vitest-environment jsdom
/**
 * PdfController ↔ main process sync of annotation/form edits: the first edit while the main process considers
 * the document clean (after loading, after every save) is reported at once with pdf:markModified, before the
 * debounced byte sync (pdf:update), so closing or quitting right after an edit never skips the "save changes?"
 * prompt. pdf.js is replaced by stand-ins here (its viewer needs a real layout); the storage hooks behave like
 * pdf.js 6.3: onSetModified fires on the first change after loading and after every saveDocument().
 * (.tsx: tests importing renderer modules stay out of tsconfig.node.json, whose composite project cannot include
 * src/renderer; they are type-checked with tests/unit/pdf/tsconfig.renderer-tests.json.)
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPdf } from '../../../src/renderer/modules/pdf/actions';
import { PdfController } from '../../../src/renderer/modules/pdf/controller/controller';
import { registerController, unregisterController } from '../../../src/renderer/modules/pdf/controller/registry';
import { usePdfStore } from '../../../src/renderer/modules/pdf/state/store';
import { handleDocumentEvent } from '../../../src/renderer/services/bootstrap';
import { upsertDocument } from '../../../src/renderer/state/appStore';
import { descriptor, FakeIpc, installIpc, removeIpc, resetRendererState } from '../renderer/helpers';

/** pdf.js' annotation storage as far as the controller uses it. */
class FakeStorage {
  size = 0;
  hash = '';
  onSetModified: (() => void) | null = null;
  #modified = false;

  get serializable(): { hash: string } {
    return { hash: this.hash };
  }

  /** A user edit: pdf.js calls onSetModified only on its own false → true transition. */
  edit(hash: string): void {
    this.size = 1;
    this.hash = hash;
    if (!this.#modified) {
      this.#modified = true;
      this.onSetModified?.();
    }
  }

  /** saveDocument() resets pdf.js' modified flag. */
  resetModified(): void {
    this.#modified = false;
  }
}

const storage = new FakeStorage();
const fakePdf = {
  numPages: 1,
  isPureXfa: false,
  annotationStorage: storage,
  getMetadata: () => Promise.resolve({ info: {} }),
  getFieldObjects: () => Promise.resolve(null),
  saveDocument: () => {
    storage.resetModified();
    return Promise.resolve(new Uint8Array([37, 80, 68, 70, 2]));
  },
  getData: () => Promise.resolve(new Uint8Array([37, 80, 68, 70, 1])),
};

vi.mock('../../../src/renderer/modules/pdf/pdfjs/lib', () => ({
  AnnotationEditorParamsType: {},
  AnnotationEditorType: { NONE: 0, FREETEXT: 3, HIGHLIGHT: 9, STAMP: 13, INK: 15 },
  AnnotationMode: { ENABLE_FORMS: 2 },
  PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
  getDocument: () => ({ promise: Promise.resolve(fakePdf), destroy: () => Promise.resolve(), onPassword: null }),
  pdfjsLib: {
    PDFWorker: class {
      destroy(): void {}
    },
  },
}));

vi.mock('../../../src/renderer/modules/pdf/pdfjs/resources', () => ({
  ANNOTATION_ICONS: new Map<string, string>(),
  BundledBinaryDataFactory: class {},
  createWorkerPort: () => ({ terminate: () => undefined }),
}));

vi.mock('../../../src/renderer/modules/pdf/pdfjs/viewer', () => {
  class EventBus {
    on(): void {}
    off(): void {}
    dispatch(): void {}
  }
  class PDFLinkService {
    setViewer(): void {}
    setDocument(): void {}
  }
  class PDFViewer {
    currentScaleValue = 'auto';
    currentScale = 1;
    pagesRotation = 0;
    currentPageNumber = 1;
    pagesCount = 1;
    setDocument(): void {}
    update(): void {}
    getPageView(): undefined {
      return undefined;
    }
  }
  class TurkishFindController {
    setDocument(): void {}
  }
  return { EventBus, PDFLinkService, PDFViewer, TurkishFindController, ScrollMode: { VERTICAL: 0 }, SpreadMode: { NONE: 0 } };
});

let ipc: FakeIpc;
let controller: PdfController;

beforeAll(() => {
  // jsdom has no ResizeObserver (the controller refits preset zooms with one).
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe(): void {}
    disconnect(): void {}
  };
});

beforeEach(async () => {
  vi.useFakeTimers();
  resetRendererState();
  storage.size = 0;
  storage.hash = '';
  storage.resetModified();
  ipc = installIpc(new FakeIpc());
  ipc.handle('pdf:read', () => new Uint8Array([37, 80, 68, 70, 1]));
  ipc.handle('pdf:update', () => undefined);
  ipc.handle('pdf:markModified', () => undefined);
  upsertDocument(descriptor('p1', 'pdf', { format: 'pdf' }));
  controller = new PdfController('p1', document.createElement('div'), document.createElement('div'));
  registerController(controller);
  await controller.open();
});

afterEach(() => {
  unregisterController(controller);
  controller.destroy();
  usePdfStore.getState().remove('p1');
  removeIpc();
  vi.useRealTimers();
});

const channels = () => ipc.channels().filter((c) => c === 'pdf:markModified' || c === 'pdf:update');
const mainReports = (modified: boolean) => handleDocumentEvent({ type: 'updated', doc: descriptor('p1', 'pdf', { format: 'pdf', modified }) });

describe('PDF edit sync', () => {
  it('reports the first edit after loading at once, before the bytes are synced', async () => {
    storage.edit('h1');
    // Synchronously, before any timer: a Ctrl+W right now already finds the document modified in main.
    expect(channels()).toEqual(['pdf:markModified']);
    expect(ipc.callsTo('pdf:markModified').map((c) => c.req)).toEqual([{ docId: 'p1' }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(channels()).toEqual(['pdf:markModified', 'pdf:update']);
  });

  it('does not report again while the main process has the document modified', async () => {
    storage.edit('h1');
    await vi.advanceTimersByTimeAsync(10);
    mainReports(true);
    storage.edit('h2'); // pdf.js reports again after saveDocument()
    await vi.advanceTimersByTimeAsync(1000);
    expect(channels()).toEqual(['pdf:markModified', 'pdf:update', 'pdf:update']);
  });

  it('reports the first edit after a save at once', async () => {
    storage.edit('h1');
    await vi.advanceTimersByTimeAsync(10);
    mainReports(true);
    mainReports(false); // saved: the working copy holds h1
    expect(channels()).toEqual(['pdf:markModified', 'pdf:update']); // nothing unsynced
    storage.edit('h2');
    expect(channels()).toEqual(['pdf:markModified', 'pdf:update', 'pdf:markModified']);
  });

  it('marks the document modified again when an edit made during a save is not in the saved file', async () => {
    storage.edit('h1');
    await vi.advanceTimersByTimeAsync(10);
    mainReports(true);
    storage.edit('h2'); // typed while the save runs: the debounced sync has not happened yet
    expect(channels()).toEqual(['pdf:markModified', 'pdf:update']);
    mainReports(false); // the save finished with the bytes of h1
    expect(channels()).toEqual(['pdf:markModified', 'pdf:update', 'pdf:markModified']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(channels()).toEqual(['pdf:markModified', 'pdf:update', 'pdf:markModified', 'pdf:update']);
  });

  it('the module flush hook pushes pending edits at once and resolves for documents without a controller', async () => {
    mainReports(true);
    storage.edit('h1');
    await flushPdf('p1');
    expect(channels()).toEqual(['pdf:update']);
    await expect(flushPdf('unknown')).resolves.toBeUndefined();
  });
});
