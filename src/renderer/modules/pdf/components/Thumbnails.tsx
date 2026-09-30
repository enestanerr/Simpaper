/**
 * Page thumbnails: lazily rendered canvases, a multi-select listbox (click, Ctrl/Shift+click, keyboard)
 * and drag & drop / Alt+arrow reordering that becomes `pdf:pages` move operations.
 */
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PDF_ACTIONS, runPdfAction } from '../actions';
import { controllerFor } from '../controller/registry';
import { planMove } from '../logic/pages';
import { AnnotationMode, type PDFDocumentProxy, type RenderTask } from '../pdfjs/lib';
import { patchDoc, usePdfDoc } from '../state/store';

const THUMB_WIDTH = 116;
const DRAG_TYPE = 'application/x-simpaper-pdf-pages';

function range(a: number, b: number): number[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** Renders one thumbnail; failures (cancelled, document replaced, broken page) leave the placeholder. */
async function renderThumbnail(pdf: PDFDocumentProxy, index: number, canvas: HTMLCanvasElement, viewRotation: number, signal: AbortSignal): Promise<void> {
  let task: RenderTask | null = null;
  const cancel = () => task?.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const page = await pdf.getPage(index + 1);
    if (signal.aborted) return;
    const rotation = (page.rotate + viewRotation) % 360;
    const base = page.getViewport({ scale: 1, rotation });
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (THUMB_WIDTH / base.width) * dpr, rotation });
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    canvas.style.width = `${THUMB_WIDTH}px`;
    canvas.style.height = `${Math.round(viewport.height / dpr)}px`;
    task = page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE_FORMS });
    await task.promise;
  } catch {
    // Nothing to report: the thumbnail keeps its placeholder.
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

interface ThumbProps {
  docId: string;
  index: number;
  version: number;
  viewRotation: number;
  selected: boolean;
  current: boolean;
  focused: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  root: HTMLElement | null;
  onClick: (index: number, e: MouseEvent) => void;
  onDragStart: (index: number, e: DragEvent) => void;
  onDragOver: (index: number, e: DragEvent<HTMLDivElement>) => void;
}

function Thumb(p: ThumbProps) {
  const { t } = useTranslation();
  const itemRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { docId, index, version, viewRotation, root, current, focused } = p;

  useEffect(() => {
    const item = itemRef.current;
    const canvas = canvasRef.current;
    const pdf = controllerFor(docId)?.pdfDocument;
    if (!item || !canvas || !pdf) return;
    const abort = new AbortController();
    let started = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((e) => e.isIntersecting)) return;
        started = true;
        observer.disconnect();
        void renderThumbnail(pdf, index, canvas, viewRotation, abort.signal);
      },
      { root, rootMargin: '200px 0px' },
    );
    observer.observe(item);
    return () => {
      observer.disconnect();
      abort.abort();
    };
    // `version` changes whenever a new pdf.js document was loaded for this docId.
  }, [docId, index, version, viewRotation, root]);

  useEffect(() => {
    if (current && !itemRef.current?.parentElement?.contains(document.activeElement)) itemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  useEffect(() => {
    if (focused && itemRef.current?.parentElement?.contains(document.activeElement)) itemRef.current.focus({ preventScroll: false });
  }, [focused]);

  return (
    <div
      ref={itemRef}
      role="option"
      id={`vpdf-thumb-${p.docId}-${p.index}`}
      aria-selected={p.selected}
      aria-current={p.current ? 'page' : undefined}
      aria-label={t('pdf.thumbnails.page', { page: p.index + 1 })}
      tabIndex={p.focused ? 0 : -1}
      draggable
      className={['vpdf-thumb', p.selected && 'vpdf-thumb--selected', p.current && 'vpdf-thumb--current', p.dropBefore && 'vpdf-thumb--drop-before', p.dropAfter && 'vpdf-thumb--drop-after']
        .filter(Boolean)
        .join(' ')}
      onClick={(e) => p.onClick(p.index, e)}
      onDragStart={(e) => p.onDragStart(p.index, e)}
      onDragOver={(e) => p.onDragOver(p.index, e)}
    >
      <div className="vpdf-thumb__frame">
        <canvas ref={canvasRef} className="vpdf-thumb__canvas" aria-hidden="true" />
      </div>
      <span className="vpdf-thumb__label" aria-hidden="true">
        {p.index + 1}
      </span>
    </div>
  );
}

export function Thumbnails({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const version = usePdfDoc(docId, (s) => s.version);
  const pageCount = usePdfDoc(docId, (s) => s.pageCount);
  const currentPage = usePdfDoc(docId, (s) => s.currentPage);
  const selection = usePdfDoc(docId, (s) => s.selection);
  const viewRotation = usePdfDoc(docId, (s) => s.viewRotation);
  const busy = usePdfDoc(docId, (s) => s.busy !== null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const anchor = useRef<number | null>(null);
  const dragging = useRef(false);
  const selected = new Set(selection);

  useEffect(() => {
    if (!root?.contains(document.activeElement)) setFocusIndex(Math.max(0, Math.min(pageCount - 1, currentPage - 1)));
  }, [currentPage, pageCount, root]);

  const run = (id: string) => void runPdfAction(id, docId);
  const select = (pages: number[]) => patchDoc(docId, { selection: pages });
  const goTo = (index: number) => controllerFor(docId)?.goToPage(index + 1);

  const onClick = (index: number, e: MouseEvent) => {
    setFocusIndex(index);
    if (e.shiftKey && anchor.current !== null) {
      select(range(anchor.current, index));
      return;
    }
    anchor.current = index;
    if (e.ctrlKey || e.metaKey) {
      select(selected.has(index) ? selection.filter((i) => i !== index) : [...selection, index]);
      return;
    }
    select([index]);
    goTo(index);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (pageCount === 0) return;
    const move = (to: number) => {
      const next = Math.max(0, Math.min(pageCount - 1, to));
      setFocusIndex(next);
      if (e.shiftKey) {
        anchor.current ??= focusIndex;
        select(range(anchor.current, next));
      }
    };
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (!selected.has(focusIndex)) select([focusIndex]);
      run(e.key === 'ArrowUp' ? PDF_ACTIONS.movePagesUp : PDF_ACTIONS.movePagesDown);
      return;
    }
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        move(focusIndex - 1);
        break;
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        move(focusIndex + 1);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(pageCount - 1);
        break;
      case ' ':
        e.preventDefault();
        anchor.current = focusIndex;
        if (ctrl) select(selected.has(focusIndex) ? selection.filter((i) => i !== focusIndex) : [...selection, focusIndex]);
        else select([focusIndex]);
        break;
      case 'Enter':
        e.preventDefault();
        anchor.current = focusIndex;
        select([focusIndex]);
        goTo(focusIndex);
        break;
      case 'Delete':
        e.preventDefault();
        if (!selected.has(focusIndex) && selection.length === 0) select([focusIndex]);
        run(PDF_ACTIONS.deletePages);
        break;
      case 'a':
      case 'A':
        if (ctrl) {
          e.preventDefault();
          select(Array.from({ length: pageCount }, (_, i) => i));
        }
        break;
      default:
        break;
    }
  };

  const onDragStart = (index: number, e: DragEvent) => {
    if (busy) {
      e.preventDefault();
      return;
    }
    dragging.current = true;
    if (!selected.has(index)) select([index]);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_TYPE, docId);
  };

  const onDragOver = (index: number, e: DragEvent<HTMLDivElement>) => {
    if (!dragging.current || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    setDropSlot(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
  };

  const onDrop = (e: DragEvent) => {
    if (!dragging.current || dropSlot === null) return;
    e.preventDefault();
    const ops = planMove(selection.length > 0 ? selection : [focusIndex], dropSlot, pageCount);
    dragging.current = false;
    setDropSlot(null);
    if (ops.length > 0) void controllerFor(docId)?.applyPageOps(ops);
  };

  const endDrag = () => {
    dragging.current = false;
    setDropSlot(null);
  };

  return (
    <aside className="vpdf-thumbs" aria-label={t('pdf.thumbnails.region')}>
      <div
        ref={setRoot}
        className="vpdf-thumbs__list"
        role="listbox"
        aria-multiselectable="true"
        aria-label={t('pdf.thumbnails.list', { count: pageCount })}
        aria-busy={busy || undefined}
        onKeyDown={onKeyDown}
        onDrop={onDrop}
        onDragEnd={endDrag}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropSlot(null);
        }}
      >
        {Array.from({ length: pageCount }, (_, i) => (
          <Thumb
            key={`${version}:${i}`}
            docId={docId}
            index={i}
            version={version}
            viewRotation={viewRotation}
            selected={selected.has(i)}
            current={currentPage === i + 1}
            focused={focusIndex === i}
            dropBefore={dropSlot === i}
            dropAfter={dropSlot === pageCount && i === pageCount - 1}
            root={root}
            onClick={onClick}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
          />
        ))}
      </div>
      <p className="vpdf-thumbs__hint">{selection.length > 1 ? t('pdf.thumbnails.selected', { count: selection.length }) : t('pdf.thumbnails.hint')}</p>
    </aside>
  );
}
