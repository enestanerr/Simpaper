/** The PDF document surface: thumbnails, find bar, pdf.js viewer, messages and dialogs. */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { on } from '@renderer/services/ipc';
import type { WorkspaceProps } from '../../types';
import { PdfController } from '../controller/controller';
import { controllerFor, registerController, unregisterController } from '../controller/registry';
import { openFind, usePdfDoc, usePdfStore } from '../state/store';
import { PdfDialogs } from './Dialogs';
import { FindBar } from './FindBar';
import { Notices } from './Notices';
import { Thumbnails } from './Thumbnails';

function BusyBar({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const busy = usePdfDoc(docId, (s) => s.busy);
  if (!busy) return null;
  const progress = busy.total ? Math.round(((busy.done ?? 0) / busy.total) * 100) : undefined;
  return (
    <div className="vpdf-busy" role="status" aria-live="polite">
      <div className="vpdf-busy__track" role="progressbar" aria-label={t(busy.key)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div className={progress === undefined ? 'vpdf-busy__bar vpdf-busy__bar--indeterminate' : 'vpdf-busy__bar'} style={progress === undefined ? undefined : { width: `${progress}%` }} />
      </div>
      <span className="vpdf-busy__text">{busy.total ? t(busy.key, { done: busy.done ?? 0, total: busy.total }) : t(busy.key)}</span>
      {busy.key === 'pdf.busy.printing' && (
        <button type="button" className="vr-btn vr-btn--ghost" onClick={() => controllerFor(docId)?.cancelPrint()}>
          {t('pdf.dialogs.cancel')}
        </button>
      )}
    </div>
  );
}

function LoadState({ docId }: { docId: string }) {
  const { t, i18n } = useTranslation();
  const status = usePdfDoc(docId, (s) => s.status);
  const errorKey = usePdfDoc(docId, (s) => s.errorKey);
  if (status === 'loading') {
    return (
      <div className="vpdf-state" role="status">
        {t('pdf.status.loading')}
      </div>
    );
  }
  if (status === 'error') {
    const key = errorKey && i18n.exists(errorKey) ? errorKey : 'pdf.errors.open';
    return (
      <div className="vpdf-state vpdf-state--error" role="alert">
        <p>{t(key)}</p>
        <button type="button" className="vr-btn" onClick={() => void controllerFor(docId)?.open()}>
          {t('pdf.status.retry')}
        </button>
      </div>
    );
  }
  return null;
}

export function PdfWorkspace({ doc, active }: WorkspaceProps) {
  const { t } = useTranslation();
  const docId = doc.docId;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const findFocus = usePdfDoc(docId, (s) => s.findFocus);
  const sidebarOpen = usePdfDoc(docId, (s) => s.sidebarOpen);
  const findOpen = usePdfDoc(docId, (s) => s.findOpen);
  const contentTool = usePdfDoc(docId, (s) => s.contentTool);
  const editorTool = usePdfDoc(docId, (s) => s.editorTool);

  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;
    if (!container || !viewer) return;
    const controller = new PdfController(docId, container, viewer);
    registerController(controller);
    void controller.open();
    return () => {
      unregisterController(controller);
      controller.destroy();
      usePdfStore.getState().remove(docId);
    };
  }, [docId]);

  // Before the shell asks "save changes?", make sure the working copy holds the latest edits.
  useEffect(
    () =>
      on('documents:event', (event) => {
        if (event.type === 'prompt' && 'docId' in event.prompt && event.prompt.docId === docId) void controllerFor(docId)?.flush();
      }),
    [docId],
  );

  useEffect(() => {
    if (active) {
      controllerFor(docId)?.viewer.update();
    } else {
      void controllerFor(docId)?.flush();
    }
  }, [active, docId]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const controller = controllerFor(docId);
    if (!controller) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && !e.altKey && key === 'f') {
      e.preventDefault();
      openFind(docId);
    } else if (e.key === 'F3') {
      e.preventDefault();
      controller.findAgain(e.shiftKey);
    } else if (ctrl && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      controller.zoomIn();
    } else if (ctrl && e.key === '-') {
      e.preventDefault();
      controller.zoomOut();
    } else if (ctrl && e.key === '0') {
      e.preventDefault();
      controller.setZoom('page-width');
    } else if (e.key === 'Escape' && contentTool !== 'none') {
      e.preventDefault();
      controller.cancelContentTool();
    }
  };

  const stageClass = [
    'vpdf__stage',
    contentTool !== 'none' && 'vpdf__stage--placing',
    editorTool !== 'none' && `vpdf__stage--tool-${editorTool}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="vpdf" data-pdf-doc={docId} hidden={!active} onKeyDown={onKeyDown}>
      {findOpen && <FindBar docId={docId} focusToken={findFocus} />}
      <div className="vpdf__body">
        {sidebarOpen && <Thumbnails docId={docId} />}
        <div className={stageClass}>
          <Notices docId={docId} />
          <div
            ref={containerRef}
            className="vpdf__container"
            tabIndex={0}
            role="document"
            aria-label={t('pdf.workspace.document', { title: doc.title })}
            aria-describedby={contentTool !== 'none' ? `vpdf-hint-${docId}` : undefined}
          >
            <div ref={viewerRef} className="pdfViewer" />
          </div>
          {contentTool !== 'none' && (
            <p id={`vpdf-hint-${docId}`} className="vpdf__hint" role="status">
              {t(`pdf.hints.${contentTool}`)}
            </p>
          )}
          <LoadState docId={docId} />
          <BusyBar docId={docId} />
        </div>
      </div>
      <PdfDialogs docId={docId} />
    </div>
  );
}
