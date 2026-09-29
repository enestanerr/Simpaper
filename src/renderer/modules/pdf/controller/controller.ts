/**
 * One open PDF: owns the pdf.js viewer, find controller and worker, keeps the main process' working copy
 * in sync with annotation/form edits and runs the file operations (pages, merge, extract, add content,
 * save, print) through the `pdf:*` channels.
 */
import type { PdfPageOp, PdfTextInsert } from '@shared/api/pdf';
import { i18n } from '@renderer/i18n';
import { invoke } from '@renderer/services/ipc';
import { useApp } from '@renderer/state/appStore';
import { fieldStops, nextStop, type FieldStop } from '../logic/fields';
import { clientToPdf, defaultImageSize, displayedPageSize, type Matrix, type ViewBox } from '../logic/geometry';
import { errorKeyOf, isCancellation } from '../logic/misc';
import { mapIndex, mapSelection } from '../logic/pages';
import { clampScale, nextZoomStep, parseZoomValue } from '../logic/zoom';
import { PdfjsL10n } from '../pdfjs/l10n';
import {
  AnnotationEditorParamsType,
  AnnotationEditorType,
  AnnotationMode,
  PasswordResponses,
  getDocument,
  pdfjsLib,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from '../pdfjs/lib';
import { ANNOTATION_ICONS, BundledBinaryDataFactory, createWorkerPort } from '../pdfjs/resources';
import { EventBus, PDFLinkService, PDFViewer, ScrollMode, SpreadMode, TurkishFindController, type PDFViewerOptions } from '../pdfjs/viewer';
import { docState, openFind, patchDoc, pushNotice, type ContentTool, type EditorTool, type PdfDocState } from '../state/store';
import { chooseImageFile, prepareImage, type PreparedImage } from './images';
import { renderPagesForPrint } from './print';

const EDITOR_MODE: Record<EditorTool, number> = {
  none: AnnotationEditorType.NONE,
  highlight: AnnotationEditorType.HIGHLIGHT,
  freetext: AnnotationEditorType.FREETEXT,
  ink: AnnotationEditorType.INK,
  stamp: AnnotationEditorType.STAMP,
};

const HIGHLIGHT_COLORS = 'yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F,yellow_HCM=#FFFFCC,green_HCM=#53FFBC,blue_HCM=#80EBFF,pink_HCM=#F6B8FF,red_HCM=#C50043';

const SCROLL_NAMES: Record<number, PdfDocState['scrollMode']> = {
  [ScrollMode.VERTICAL]: 'vertical',
  [ScrollMode.HORIZONTAL]: 'horizontal',
  [ScrollMode.WRAPPED]: 'wrapped',
  [ScrollMode.PAGE]: 'page',
};
const SPREAD_NAMES: Record<number, PdfDocState['spreadMode']> = {
  [SpreadMode.NONE]: 'none',
  [SpreadMode.ODD]: 'odd',
  [SpreadMode.EVEN]: 'even',
};

/** Debounce for syncing annotation/form edits to the working copy. */
const FLUSH_DELAY_MS = 700;

interface ViewPosition {
  page: number;
  scaleValue: string;
  rotation: number;
  /** Scroll offset inside the page, as a fraction of its height. */
  offset: number;
}

/** The parts of pdf.js' AnnotationEditor / AnnotationEditorUIManager used here. */
interface SelectedEditorLike {
  get comment(): { text?: string | null } | null;
  /** A string sets the comment (/Contents + /Popup on save); null deletes it. */
  set comment(value: string | null);
}

interface UiManagerLike {
  firstSelectedEditor?: SelectedEditorLike | null;
}

interface AnnotationStorageHooks {
  onSetModified: (() => void) | null;
}

type PdfWorker = InstanceType<typeof pdfjsLib.PDFWorker>;

export interface FindOptions {
  caseSensitive: boolean;
  entireWord: boolean;
  highlightAll: boolean;
}

function toolFromMode(mode: number): EditorTool {
  const entry = Object.entries(EDITOR_MODE).find(([, m]) => m === mode);
  return (entry?.[0] as EditorTool | undefined) ?? 'none';
}

export class PdfController {
  readonly docId: string;
  readonly #container: HTMLDivElement;
  readonly #eventBus: InstanceType<typeof EventBus>;
  readonly #linkService: InstanceType<typeof PDFLinkService>;
  readonly #findController: InstanceType<typeof TurkishFindController>;
  readonly #viewer: InstanceType<typeof PDFViewer>;
  readonly #l10n: PdfjsL10n;
  readonly #abort = new AbortController();
  #worker: { port: Worker; pdf: PdfWorker } | null = null;
  #task: PDFDocumentLoadingTask | null = null;
  #pdf: PDFDocumentProxy | null = null;
  #uiManager: UiManagerLike | null = null;
  #password: string | null = null;
  #passwordCallback: ((password: string) => void) | null = null;
  #passwordCancelled = false;
  #pendingPosition: ViewPosition | null = null;
  #flushedHash = '';
  #flushTimer: ReturnType<typeof setTimeout> | undefined;
  #flushDue = 0;
  #flushChain: Promise<void> = Promise.resolve();
  #pendingImage: PreparedImage | null = null;
  #printAbort: AbortController | null = null;
  #fields: FieldStop[] | null = null;
  #fieldCursor = -1;
  #lastFind: { query: string; opts: FindOptions } | null = null;
  #destroyed = false;
  #unsubscribeStore: () => void = () => undefined;

  constructor(docId: string, container: HTMLDivElement, viewerElement: HTMLDivElement) {
    this.docId = docId;
    this.#container = container;
    this.#eventBus = new EventBus();
    this.#linkService = new PDFLinkService({ eventBus: this.#eventBus });
    this.#findController = new TurkishFindController({ eventBus: this.#eventBus, linkService: this.#linkService, updateMatchesCountOnProgress: true });
    this.#l10n = new PdfjsL10n(i18n);
    const options: PDFViewerOptions = {
      container,
      viewer: viewerElement,
      eventBus: this.#eventBus,
      linkService: this.#linkService,
      findController: this.#findController as unknown as PDFViewerOptions['findController'],
      l10n: this.#l10n as unknown as PDFViewerOptions['l10n'],
      annotationMode: AnnotationMode.ENABLE_FORMS,
      annotationEditorMode: AnnotationEditorType.NONE,
      annotationEditorHighlightColors: HIGHLIGHT_COLORS,
      enablePermissions: false,
      imageResourcesPath: '',
      supportsPinchToZoom: true,
      enableAutoLinking: true,
    };
    this.#viewer = new PDFViewer({ ...options, abortSignal: this.#abort.signal } as PDFViewerOptions);
    this.#linkService.setViewer(this.#viewer);
    void this.#l10n.translate(container);
    this.#listen();
    // The shell's store mirrors the main process' descriptor (`updated` events): notice when it saves.
    this.#unsubscribeStore = useApp.subscribe((state, prev) => {
      if (state.documents === prev.documents) return;
      const now = state.documents.find((d) => d.docId === this.docId);
      if (now && !now.modified && prev.documents.find((d) => d.docId === this.docId)?.modified) this.#savedByMain();
    });
  }

  get pdfDocument(): PDFDocumentProxy | null {
    return this.#pdf;
  }

  get viewer(): InstanceType<typeof PDFViewer> {
    return this.#viewer;
  }

  // ------------------------------------------------------------------ lifecycle

  async open(): Promise<void> {
    this.#passwordCancelled = false;
    patchDoc(this.docId, { status: 'loading', errorKey: null });
    try {
      const bytes = await invoke('pdf:read', { docId: this.docId });
      if (this.#destroyed) return;
      await this.#load(bytes, null);
    } catch (err) {
      this.#fail(err, 'pdf.errors.open');
    }
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#unsubscribeStore();
    clearTimeout(this.#flushTimer);
    this.#printAbort?.abort();
    try {
      this.#viewer.setDocument(null as unknown as PDFDocumentProxy);
    } catch {
      // The viewer may not have a document yet.
    }
    this.#findController.setDocument(null as unknown as PDFDocumentProxy);
    this.#linkService.setDocument(null);
    this.#abort.abort();
    void this.#l10n.destroy();
    const task = this.#task;
    const worker = this.#worker;
    this.#task = null;
    this.#pdf = null;
    this.#worker = null;
    void (async () => {
      await task?.destroy().catch(() => undefined);
      worker?.pdf.destroy();
      worker?.port.terminate();
    })();
  }

  #ensureWorker(): PdfWorker {
    if (!this.#worker) {
      const port = createWorkerPort();
      // The typings declare `port`/`name` as null-only (JSDoc defaults); any MessagePort-like object is accepted.
      const options = { port, name: `varak-pdf-${this.docId}` } as unknown as ConstructorParameters<typeof pdfjsLib.PDFWorker>[0];
      const pdf = new pdfjsLib.PDFWorker(options);
      this.#worker = { port, pdf };
    }
    return this.#worker.pdf;
  }

  async #load(bytes: Uint8Array, position: ViewPosition | null): Promise<void> {
    const worker = this.#ensureWorker();
    const task = getDocument({
      data: bytes,
      worker,
      BinaryDataFactory: BundledBinaryDataFactory,
      useWorkerFetch: false,
      enableXfa: false,
      ...(this.#password !== null ? { password: this.#password } : {}),
    });
    task.onPassword = (update: (password: string) => void, reason: number) => {
      this.#passwordCallback = update;
      patchDoc(this.docId, { dialog: { kind: 'password', retry: reason === PasswordResponses.INCORRECT_PASSWORD } });
    };
    const previous = this.#task;
    this.#task = task;
    const pdf = await task.promise;
    if (this.#destroyed || this.#task !== task) {
      await task.destroy();
      return;
    }
    this.#pendingPosition = position;
    this.#uiManager = null;
    this.#fields = null;
    this.#fieldCursor = -1;
    this.#pdf = pdf;
    this.#viewer.setDocument(pdf);
    this.#linkService.setDocument(pdf, null);
    this.#flushedHash = this.#storageHash();
    (pdf.annotationStorage as unknown as AnnotationStorageHooks).onSetModified = () => this.#storageModified();
    // Destroying the previous document only after the new one is shown avoids a blank viewer.
    if (previous && previous !== task) void previous.destroy().catch(() => undefined);
    const encrypted = await pdf
      .getMetadata()
      .then((m) => Boolean((m.info as { EncryptFilterName?: string } | undefined)?.EncryptFilterName))
      .catch(() => this.#password !== null);
    const fields = await pdf.getFieldObjects().catch(() => null);
    this.#fields = fieldStops(fields);
    patchDoc(this.docId, (s) => ({
      status: 'ready',
      errorKey: null,
      version: s.version + 1,
      pageCount: pdf.numPages,
      encrypted,
      hasFormFields: this.#fields !== null && this.#fields.length > 0,
      selection: s.selection.filter((i) => i < pdf.numPages),
      editorTool: 'none',
      contentTool: 'none',
      canUndo: false,
      canRedo: false,
      hasSelectedEditor: false,
    }));
  }

  #fail(err: unknown, fallbackKey: string): void {
    if (this.#destroyed) return;
    let key = errorKeyOf(err) ?? (err instanceof Error && err.name === 'InvalidPDFException' ? 'pdf.errors.invalidPdf' : fallbackKey);
    if (this.#passwordCancelled) key = 'pdf.errors.passwordRequired';
    patchDoc(this.docId, { status: 'error', errorKey: key });
  }

  submitPassword(password: string | null): void {
    const callback = this.#passwordCallback;
    this.#passwordCallback = null;
    patchDoc(this.docId, { dialog: null });
    if (password === null || !callback) {
      // Destroying the task rejects the pending load, which then reports "password required".
      this.#passwordCancelled = true;
      void this.#task?.destroy();
      return;
    }
    this.#password = password;
    callback(password);
  }

  // ------------------------------------------------------------------ pdf.js events

  #listen(): void {
    const bus = this.#eventBus;
    const opts = { signal: this.#abort.signal };
    bus.on('pagesinit', () => this.#restorePosition(), opts);
    bus.on(
      'pagechanging',
      ({ pageNumber }: { pageNumber: number }) => patchDoc(this.docId, { currentPage: pageNumber }),
      opts,
    );
    bus.on(
      'scalechanging',
      ({ scale, presetValue }: { scale: number; presetValue?: string }) => patchDoc(this.docId, { scale, scaleValue: presetValue ?? String(scale) }),
      opts,
    );
    bus.on('rotationchanging', ({ pagesRotation }: { pagesRotation: number }) => patchDoc(this.docId, { viewRotation: pagesRotation }), opts);
    bus.on('scrollmodechanged', ({ mode }: { mode: number }) => patchDoc(this.docId, { scrollMode: SCROLL_NAMES[mode] ?? 'vertical' }), opts);
    bus.on('spreadmodechanged', ({ mode }: { mode: number }) => patchDoc(this.docId, { spreadMode: SPREAD_NAMES[mode] ?? 'none' }), opts);
    bus.on(
      'updatefindmatchescount',
      ({ matchesCount }: { matchesCount: { current: number; total: number } }) =>
        patchDoc(this.docId, (s) => ({ find: { state: s.find?.state ?? 0, current: matchesCount.current, total: matchesCount.total } })),
      opts,
    );
    bus.on(
      'updatefindcontrolstate',
      ({ state, matchesCount }: { state: number; matchesCount?: { current: number; total: number } }) =>
        patchDoc(this.docId, (s) => ({
          find: { state, current: matchesCount?.current ?? s.find?.current ?? 0, total: matchesCount?.total ?? s.find?.total ?? 0 },
        })),
      opts,
    );
    bus.on('annotationeditoruimanager', ({ uiManager }: { uiManager: UiManagerLike }) => (this.#uiManager = uiManager), opts);
    bus.on('annotationeditormodechanged', ({ mode }: { mode: number }) => patchDoc(this.docId, { editorTool: toolFromMode(mode) }), opts);
    bus.on(
      'switchannotationeditormode',
      (evt: { mode: number; editId?: string; isFromKeyboard?: boolean; mustEnterInEditMode?: boolean; editComment?: boolean }) => {
        try {
          this.#viewer.annotationEditorMode = evt;
        } catch {
          // Editing unavailable (e.g. pure XFA); pdf.js keeps the current mode.
        }
      },
      opts,
    );
    bus.on(
      'annotationeditorstateschanged',
      ({ details }: { details: { hasSomethingToUndo?: boolean; hasSomethingToRedo?: boolean; hasSelectedEditor?: boolean } }) => {
        patchDoc(this.docId, (s) => ({
          canUndo: details.hasSomethingToUndo ?? s.canUndo,
          canRedo: details.hasSomethingToRedo ?? s.canRedo,
          hasSelectedEditor: details.hasSelectedEditor ?? s.hasSelectedEditor,
        }));
        this.scheduleFlush();
      },
      opts,
    );
    bus.on('annotationlayerrendered', ({ source }: { source: { div?: HTMLElement } }) => this.#fixAnnotationIcons(source.div), opts);

    const c = this.#container;
    const schedule = () => this.scheduleFlush();
    for (const type of ['input', 'change', 'pointerup', 'keyup']) c.addEventListener(type, schedule, { ...opts, passive: true });
    c.addEventListener('click', (e) => this.#onClick(e), { ...opts, capture: true });
    c.addEventListener('auxclick', (e) => this.#onClick(e), { ...opts, capture: true });
    c.addEventListener('wheel', (e) => this.#onWheel(e), { ...opts, passive: false });
    c.addEventListener('keydown', (e) => this.#onKeyDown(e), opts);
    window.addEventListener('blur', () => void this.flush(), opts);
    // The components build does not refit preset zooms (page width, whole page) when the area resizes.
    let frame = 0;
    const refit = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const value = this.#viewer.currentScaleValue;
        if (this.#pdf && c.clientWidth > 0 && c.clientHeight > 0 && (value === 'page-width' || value === 'page-fit' || value === 'auto')) {
          this.#viewer.currentScaleValue = value;
        }
      });
    });
    refit.observe(c);
    this.#abort.signal.addEventListener('abort', () => {
      refit.disconnect();
      cancelAnimationFrame(frame);
    });
  }

  /** pdf.js expects annotation icons under `imageResourcesPath`; Vite gives them hashed URLs instead. */
  #fixAnnotationIcons(div: HTMLElement | undefined): void {
    if (!div) return;
    for (const img of div.querySelectorAll<HTMLImageElement>('.annotationLayer img')) {
      const name = (img.getAttribute('src') ?? '').split('/').pop() ?? '';
      const url = ANNOTATION_ICONS.get(name);
      if (url && img.getAttribute('src') !== url) img.src = url;
    }
  }

  #restorePosition(): void {
    const pos = this.#pendingPosition;
    this.#pendingPosition = null;
    const viewer = this.#viewer;
    if (!pos) {
      viewer.currentScaleValue = 'auto';
      return;
    }
    viewer.currentScaleValue = pos.scaleValue;
    viewer.pagesRotation = pos.rotation;
    const page = Math.min(Math.max(1, pos.page), viewer.pagesCount);
    viewer.currentPageNumber = page;
    const div = (viewer.getPageView(page - 1) as { div?: HTMLElement } | undefined)?.div;
    if (div) this.#container.scrollTop = div.offsetTop + pos.offset * div.offsetHeight;
  }

  #capturePosition(): ViewPosition {
    const viewer = this.#viewer;
    const page = viewer.currentPageNumber || 1;
    const div = (viewer.getPageView(page - 1) as { div?: HTMLElement } | undefined)?.div;
    const offset = div && div.offsetHeight > 0 ? Math.max(0, (this.#container.scrollTop - div.offsetTop) / div.offsetHeight) : 0;
    return { page, scaleValue: viewer.currentScaleValue || 'auto', rotation: viewer.pagesRotation, offset };
  }

  // ------------------------------------------------------------------ input handling

  #pageAt(target: EventTarget | null): { index: number; div: HTMLElement } | null {
    const div = target instanceof Element ? target.closest<HTMLElement>('.page[data-page-number]') : null;
    const n = Number(div?.dataset['pageNumber']);
    return div && Number.isInteger(n) && n >= 1 ? { index: n - 1, div } : null;
  }

  /** Viewport transform and on-screen content box of a rendered page. */
  #pageGeometry(index: number): { transform: Matrix; box: { left: number; top: number; width: number; height: number }; viewBox: ViewBox; rotation: number } | null {
    const view = this.#viewer.getPageView(index) as { div?: HTMLElement; viewport?: { transform: number[]; rotation: number; viewBox: number[] } } | undefined;
    if (!view?.div || !view.viewport) return null;
    const rect = view.div.getBoundingClientRect();
    const box = {
      left: rect.left + view.div.clientLeft,
      top: rect.top + view.div.clientTop,
      width: view.div.clientWidth,
      height: view.div.clientHeight,
    };
    return { transform: view.viewport.transform as Matrix, box, viewBox: view.viewport.viewBox as ViewBox, rotation: view.viewport.rotation };
  }

  #onClick(e: MouseEvent): void {
    const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (link && /^(https?|mailto|ftp|file|javascript):/i.test(link.getAttribute('href') ?? '')) {
      // Never navigate the app window; show the address instead (see docs/dev/pdf.md, "Links").
      e.preventDefault();
      e.stopPropagation();
      patchDoc(this.docId, { dialog: { kind: 'externalLink', url: link.href } });
      return;
    }
    const tool = docState(this.docId).contentTool;
    if (tool === 'none' || e.type !== 'click' || e.button !== 0) return;
    const page = this.#pageAt(e.target);
    if (!page) return;
    const geometry = this.#pageGeometry(page.index);
    const point = geometry ? clientToPdf(geometry.box, geometry.transform, e.clientX, e.clientY) : null;
    if (!point) return;
    e.preventDefault();
    e.stopPropagation();
    this.#placeContent(tool, page.index, point[0], point[1]);
  }

  /** Keyboard placement for the content tools: Enter places at the top-left margin of the current page. */
  #onKeyDown(e: KeyboardEvent): void {
    const tool = docState(this.docId).contentTool;
    if (tool === 'none') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.cancelContentTool();
    } else if (e.key === 'Enter' && e.target === this.#container) {
      e.preventDefault();
      const index = (this.#viewer.currentPageNumber || 1) - 1;
      const geometry = this.#pageGeometry(index);
      if (!geometry) return;
      const margin = 36 * (geometry.box.width / displayedPageSize(geometry.viewBox, geometry.rotation).width);
      const point = clientToPdf(geometry.box, geometry.transform, geometry.box.left + margin, geometry.box.top + margin);
      if (point) this.#placeContent(tool, index, point[0], point[1]);
    }
  }

  /** Ctrl+wheel and touchpad pinch zoom the document (around the pointer) instead of the whole window. */
  #onWheel(e: WheelEvent): void {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (!this.#pdf || e.deltaY === 0) return;
    const origin = [e.clientX, e.clientY];
    if (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
      this.#viewer.updateScale({ scaleFactor: Math.exp(-e.deltaY / 100), origin, drawingDelay: 400 });
    } else {
      this.#viewer.updateScale({ steps: e.deltaY < 0 ? 1 : -1, origin, drawingDelay: 400 });
    }
  }

  // ------------------------------------------------------------------ sync with the working copy

  #storageHash(): string {
    const pdf = this.#pdf;
    if (!pdf || pdf.annotationStorage.size === 0) return '';
    const serializable = pdf.annotationStorage.serializable as { hash?: string } | undefined;
    return serializable?.hash ?? '';
  }

  /** Whether the main process reports the document modified (the shell's store mirrors its descriptor). */
  #modifiedInMain(): boolean {
    return useApp.getState().documents.find((d) => d.docId === this.docId)?.modified === true;
  }

  /** Marks the document modified in the main process at once; the bytes follow with the next sync. */
  #markModified(): void {
    if (this.#destroyed) return;
    try {
      invoke('pdf:markModified', { docId: this.docId }).catch(() => {
        // The document is closing; the next sync (pdf:update) marks it modified as well.
      });
    } catch {
      // No preload bridge (previews): nothing to tell. Never throw into pdf.js' storage update.
    }
  }

  /**
   * pdf.js reports the first change after loading and after every saveDocument() (each sync). While the main
   * process considers the document clean (after loading, after every save) the change is reported at once
   * with pdf:markModified, independent of the debounced byte sync, so closing the tab or quitting right after
   * an edit never skips the "save changes?" prompt. The first sync after loading also runs at once.
   */
  #storageModified(): void {
    if (this.#destroyed) return;
    if (!this.#modifiedInMain()) this.#markModified();
    this.scheduleFlush(this.#flushedHash === '' ? 0 : FLUSH_DELAY_MS);
  }

  /**
   * The main process saved the working copy (modified went to false). Edits made after the last sync — e.g.
   * typed while the save ran — are not in the saved file: the document is modified again. pdf.js does not
   * report them a second time (its modified flag is only reset by the next saveDocument()).
   */
  #savedByMain(): void {
    if (this.#destroyed || !this.#pdf) return;
    try {
      if (this.#storageHash() === this.#flushedHash) return;
    } catch {
      return; // runs inside the store's update: never throw into it
    }
    this.#markModified();
    this.scheduleFlush();
  }

  scheduleFlush(delay = FLUSH_DELAY_MS): void {
    if (this.#destroyed) return;
    const due = Date.now() + delay;
    // Until the first sync, an earlier pending flush is kept: later input events must not postpone it.
    if (this.#flushTimer !== undefined && this.#flushedHash === '' && this.#flushDue <= due) return;
    clearTimeout(this.#flushTimer);
    this.#flushDue = due;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined;
      void this.flush().catch(() => undefined);
    }, delay);
  }

  /**
   * Writes pending annotation/form edits into the working copy (`saveDocument` → `pdf:update`), so the main
   * process marks the document modified and autosave/recovery see the edits. No-op when nothing changed.
   */
  flush(): Promise<void> {
    const run = async (): Promise<void> => {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = undefined;
      const pdf = this.#pdf;
      if (!pdf || this.#destroyed) return;
      const hash = this.#storageHash();
      if (hash === this.#flushedHash) return;
      // An empty storage after earlier flushes means every edit was undone: restore the loaded bytes.
      const bytes = hash ? await pdf.saveDocument() : await pdf.getData();
      if (pdf !== this.#pdf || this.#destroyed) return;
      await invoke('pdf:update', { docId: this.docId, bytes });
      this.#flushedHash = hash;
    };
    const next = this.#flushChain.then(run, run);
    this.#flushChain = next.catch(() => undefined);
    return next;
  }

  // ------------------------------------------------------------------ helpers

  #notifyError(err: unknown, fallbackKey: string): void {
    if (isCancellation(err)) return;
    const key = errorKeyOf(err) ?? fallbackKey;
    pushNotice(this.docId, { kind: 'error', key });
  }

  /** Runs a file operation with a busy indicator; errors become notices. */
  async #busy(key: string, work: () => Promise<void>, fallbackError = 'pdf.errors.operationFailed'): Promise<void> {
    if (docState(this.docId).busy || !this.#pdf) return;
    patchDoc(this.docId, { busy: { key } });
    try {
      await work();
    } catch (err) {
      this.#notifyError(err, fallbackError);
    } finally {
      if (!this.#destroyed) patchDoc(this.docId, { busy: null });
    }
  }

  #refuseEncrypted(): boolean {
    if (!docState(this.docId).encrypted) return false;
    pushNotice(this.docId, { kind: 'error', key: 'pdf.errors.encrypted' });
    return true;
  }

  // ------------------------------------------------------------------ navigation & view

  goToPage(pageNumber: number): void {
    if (!this.#pdf) return;
    const n = Math.min(Math.max(1, Math.round(pageNumber)), this.#pdf.numPages);
    this.#viewer.currentPageNumber = n;
  }

  firstPage(): void {
    this.goToPage(1);
  }

  lastPage(): void {
    this.goToPage(this.#pdf?.numPages ?? 1);
  }

  nextPage(): void {
    this.#viewer.nextPage();
  }

  previousPage(): void {
    this.#viewer.previousPage();
  }

  zoomIn(): void {
    if (!this.#pdf) return;
    this.#viewer.currentScale = clampScale(nextZoomStep(this.#viewer.currentScale, 1));
  }

  zoomOut(): void {
    if (!this.#pdf) return;
    this.#viewer.currentScale = clampScale(nextZoomStep(this.#viewer.currentScale, -1));
  }

  /** Accepts `page-width`/`page-fit`/`page-actual`/`auto`, percentages or scales. */
  setZoom(value: string): boolean {
    const parsed = parseZoomValue(value);
    if (!parsed || !this.#pdf) return false;
    this.#viewer.currentScaleValue = parsed;
    return true;
  }

  rotateView(delta: 90 | -90): void {
    if (!this.#pdf) return;
    this.#viewer.pagesRotation = (((this.#viewer.pagesRotation + delta) % 360) + 360) % 360;
  }

  setScrollMode(mode: PdfDocState['scrollMode']): void {
    const value = Number(Object.entries(SCROLL_NAMES).find(([, name]) => name === mode)?.[0]);
    if (this.#pdf && Number.isInteger(value)) this.#viewer.scrollMode = value;
  }

  setSpreadMode(mode: PdfDocState['spreadMode']): void {
    const value = Number(Object.entries(SPREAD_NAMES).find(([, name]) => name === mode)?.[0]);
    if (this.#pdf && Number.isInteger(value)) this.#viewer.spreadMode = value;
  }

  focusDocument(): void {
    this.#container.focus({ preventScroll: true });
  }

  /** Copies the selected text (the pdf.js copy handler normalises it). */
  copySelection(): boolean {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) return false;
    return document.execCommand('copy');
  }

  // ------------------------------------------------------------------ find

  find(query: string, opts: FindOptions, type: '' | 'again' | 'highlightallchange' | 'casesensitivitychange' | 'entirewordchange', findPrevious = false): void {
    this.#lastFind = { query, opts };
    this.#eventBus.dispatch('find', {
      source: this,
      type,
      query,
      caseSensitive: opts.caseSensitive,
      entireWord: opts.entireWord,
      highlightAll: opts.highlightAll,
      findPrevious,
      matchDiacritics: false,
    });
  }

  /** F3 / Shift+F3: repeats the last search; opens the find bar when there is none. */
  findAgain(previous: boolean): void {
    const last = this.#lastFind;
    if (!last?.query) {
      openFind(this.docId);
      return;
    }
    this.find(last.query, last.opts, 'again', previous);
  }

  closeFind(): void {
    this.#eventBus.dispatch('findbarclose', { source: this });
    patchDoc(this.docId, { findOpen: false, find: null });
  }

  // ------------------------------------------------------------------ annotations

  setEditorTool(tool: EditorTool): void {
    const pdf = this.#pdf;
    if (!pdf) return;
    this.cancelContentTool();
    if (!this.#uiManager) {
      // pdf.js creates the editor manager after the first page loads; XFA-only documents never get one.
      if (tool !== 'none') pushNotice(this.docId, { kind: 'info', key: pdf.isPureXfa ? 'pdf.errors.editingUnavailable' : 'pdf.notices.notReady' });
      return;
    }
    try {
      this.#viewer.annotationEditorMode = { mode: EDITOR_MODE[tool] };
      patchDoc(this.docId, { editorTool: tool });
    } catch {
      pushNotice(this.docId, { kind: 'error', key: 'pdf.errors.editingUnavailable' });
    }
  }

  /** Colour for the active tool (or the selected annotations of that kind). */
  setAnnotationColor(hex: string): void {
    const tool = docState(this.docId).editorTool;
    const type =
      tool === 'freetext'
        ? AnnotationEditorParamsType.FREETEXT_COLOR
        : tool === 'ink'
          ? AnnotationEditorParamsType.INK_COLOR
          : tool === 'highlight'
            ? AnnotationEditorParamsType.HIGHLIGHT_COLOR
            : null;
    if (type === null) {
      pushNotice(this.docId, { kind: 'info', key: 'pdf.notices.chooseToolForColor' });
      return;
    }
    this.#eventBus.dispatch('switchannotationeditorparams', { source: this, type, value: hex });
    this.scheduleFlush();
  }

  setFreeTextSize(size: number): void {
    if (!(size > 0)) return;
    if (docState(this.docId).editorTool !== 'freetext') this.setEditorTool('freetext');
    this.#eventBus.dispatch('switchannotationeditorparams', { source: this, type: AnnotationEditorParamsType.FREETEXT_SIZE, value: size });
    this.scheduleFlush();
  }

  setThickness(value: number): void {
    if (!(value > 0)) return;
    const tool = docState(this.docId).editorTool;
    const type = tool === 'highlight' ? AnnotationEditorParamsType.HIGHLIGHT_THICKNESS : AnnotationEditorParamsType.INK_THICKNESS;
    if (tool !== 'highlight' && tool !== 'ink') this.setEditorTool('ink');
    this.#eventBus.dispatch('switchannotationeditorparams', { source: this, type, value });
    this.scheduleFlush();
  }

  editingAction(name: 'undo' | 'redo' | 'delete' | 'selectAll' | 'highlightSelection'): void {
    this.#eventBus.dispatch('editingaction', { source: this, name });
    this.scheduleFlush();
  }

  /** The comment of the selected annotation (for the comment dialog), or null if none is selected. */
  selectedComment(): string | null {
    const editor = this.#uiManager?.firstSelectedEditor;
    if (!editor) return null;
    return editor.comment?.text ?? '';
  }

  setSelectedComment(text: string): boolean {
    const editor = this.#uiManager?.firstSelectedEditor;
    if (!editor) return false;
    editor.comment = text.trim() ? text : null;
    this.scheduleFlush(0);
    return true;
  }

  // ------------------------------------------------------------------ forms

  setFieldHighlight(on: boolean): void {
    this.#container.classList.toggle('varak-pdf-fields-plain', !on);
    patchDoc(this.docId, { highlightFields: on });
  }

  /** Moves the focus to the next/previous form field, scrolling its page into view first. */
  focusField(direction: 1 | -1): void {
    const stops = this.#fields ?? [];
    if (stops.length === 0) {
      pushNotice(this.docId, { kind: 'info', key: 'pdf.notices.noFields' });
      return;
    }
    const active = document.activeElement?.getAttribute('data-element-id');
    const current = active ? stops.findIndex((s) => s.id === active) : this.#fieldCursor;
    const index = nextStop(stops.length, current, direction);
    const stop = stops[index]!;
    this.#fieldCursor = index;
    const [x1, , , y2] = stop.rect;
    this.#viewer.scrollPageIntoView({ pageNumber: stop.page + 1, destArray: [null, { name: 'XYZ' }, x1 - 20, y2 + 40, null] });
    const tryFocus = (attempt: number) => {
      const el = this.#container.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(stop.id)}"]`);
      if (el) el.focus();
      else if (attempt < 20) setTimeout(() => tryFocus(attempt + 1), 50);
    };
    tryFocus(0);
  }

  // ------------------------------------------------------------------ page operations

  async applyPageOps(ops: PdfPageOp[], selectionAfter?: number[]): Promise<void> {
    if (ops.length === 0 || this.#refuseEncrypted()) return;
    await this.#busy('pdf.busy.pages', async () => {
      await this.flush();
      const pdf = this.#pdf;
      if (!pdf) return;
      const count = pdf.numPages;
      const position = this.#capturePosition();
      position.page = mapIndex(count, ops, position.page - 1) + 1;
      const selection = selectionAfter ?? mapSelection(count, ops, docState(this.docId).selection);
      const bytes = await invoke('pdf:pages', { docId: this.docId, ops });
      await this.#load(bytes, position);
      patchDoc(this.docId, { selection });
    });
  }

  async merge(): Promise<void> {
    if (this.#refuseEncrypted()) return;
    await this.#busy('pdf.busy.merge', async () => {
      await this.flush();
      const position = this.#capturePosition();
      const bytes = await invoke('pdf:merge', { docId: this.docId });
      await this.#load(bytes, position);
      pushNotice(this.docId, { kind: 'info', key: 'pdf.notices.merged' });
    });
  }

  async extract(pageIndices: number[]): Promise<void> {
    await this.#busy(
      'pdf.busy.extract',
      async () => {
        await this.flush();
        const result = await invoke('pdf:extract', { docId: this.docId, pageIndices });
        if (result.outcome === 'failed') pushNotice(this.docId, { kind: 'error', key: result.errorKey ?? 'pdf.errors.extractFailed' });
        else if (result.outcome !== 'cancelled') pushNotice(this.docId, { kind: 'info', key: 'pdf.notices.extracted', values: { path: result.path ?? '' } });
      },
      'pdf.errors.extractFailed',
    );
  }

  // ------------------------------------------------------------------ page content (text / image)

  startAddText(): void {
    if (this.#refuseEncrypted() || !this.#pdf) return;
    this.setEditorTool('none');
    patchDoc(this.docId, { contentTool: 'addText' });
    this.focusDocument();
  }

  /** Must be called from a user gesture (opens the file chooser). */
  async startAddImage(): Promise<void> {
    if (this.#refuseEncrypted() || !this.#pdf) return;
    const file = await chooseImageFile();
    if (!file) return;
    let image: PreparedImage;
    try {
      image = await prepareImage(file);
    } catch {
      pushNotice(this.docId, { kind: 'error', key: 'pdf.errors.imageFormat' });
      return;
    }
    // Leaving the annotation tools cancels any content tool, so the image is kept only afterwards.
    this.setEditorTool('none');
    this.#pendingImage = image;
    patchDoc(this.docId, { contentTool: 'addImage' });
    pushNotice(this.docId, { kind: 'info', key: 'pdf.notices.placeImage' });
    this.focusDocument();
  }

  cancelContentTool(): void {
    this.#pendingImage = null;
    if (docState(this.docId).contentTool !== 'none') patchDoc(this.docId, { contentTool: 'none' });
  }

  #placeContent(tool: ContentTool, pageIndex: number, x: number, y: number): void {
    if (tool === 'addText') {
      patchDoc(this.docId, { contentTool: 'none', dialog: { kind: 'addText', pageIndex, x, y } });
    } else if (tool === 'addImage') {
      const image = this.#pendingImage;
      this.cancelContentTool();
      const geometry = this.#pageGeometry(pageIndex);
      if (!image || !geometry) return;
      const page = displayedPageSize(geometry.viewBox, geometry.rotation);
      const size = defaultImageSize(image.width, image.height, page.width, page.height);
      void this.#busy('pdf.busy.content', async () => {
        await this.flush();
        const position = this.#capturePosition();
        const bytes = await invoke('pdf:insertImage', {
          docId: this.docId,
          item: { pageIndex, x, y, width: size.width, height: size.height, data: image.data, mime: image.mime },
        });
        await this.#load(bytes, position);
      });
    }
  }

  async insertText(item: PdfTextInsert): Promise<void> {
    await this.#busy('pdf.busy.content', async () => {
      await this.flush();
      const position = this.#capturePosition();
      const bytes = await invoke('pdf:insertText', { docId: this.docId, items: [item] });
      await this.#load(bytes, position);
    });
  }

  // ------------------------------------------------------------------ save & print

  async save(saveAs: boolean): Promise<void> {
    await this.#busy(
      'pdf.busy.saving',
      async () => {
        await this.flush();
        const result = await invoke('pdf:save', { docId: this.docId, saveAs });
        if (result.outcome === 'failed') pushNotice(this.docId, { kind: 'error', key: result.errorKey ?? 'pdf.errors.saveFailed' });
        else if (result.outcome === 'savedCopy') pushNotice(this.docId, { kind: 'info', key: 'pdf.notices.savedCopy', values: { path: result.path ?? '' } });
      },
      'pdf.errors.saveFailed',
    );
  }

  async print(): Promise<void> {
    const pdf = this.#pdf;
    if (!pdf || docState(this.docId).busy) return;
    const abort = new AbortController();
    this.#printAbort = abort;
    patchDoc(this.docId, { busy: { key: 'pdf.busy.printing', done: 0, total: pdf.numPages } });
    try {
      await this.flush();
      const pages = await renderPagesForPrint(pdf, {
        signal: abort.signal,
        onProgress: (done, total) => patchDoc(this.docId, { busy: { key: 'pdf.busy.printing', done, total } }),
      });
      patchDoc(this.docId, { busy: { key: 'pdf.busy.printDialog' } });
      await invoke('pdf:print', { docId: this.docId, pages });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) this.#notifyError(err, 'pdf.errors.printFailed');
    } finally {
      this.#printAbort = null;
      if (!this.#destroyed) patchDoc(this.docId, { busy: null });
    }
  }

  cancelPrint(): void {
    this.#printAbort?.abort();
  }
}
