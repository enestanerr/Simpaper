/** Status bar items for the active PDF: page x / y, active tool, zoom (−, value, +). */
import { IconMinus, IconPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { DocumentDescriptor } from '@shared/api/documents';
import { controllerFor } from '../controller/registry';
import { zoomPercent } from '../logic/zoom';
import { patchDoc, usePdfDoc } from '../state/store';

export function PdfStatusBar({ doc }: { doc: DocumentDescriptor }) {
  const { t } = useTranslation();
  const docId = doc.docId;
  const status = usePdfDoc(docId, (s) => s.status);
  const page = usePdfDoc(docId, (s) => s.currentPage);
  const pages = usePdfDoc(docId, (s) => s.pageCount);
  const scale = usePdfDoc(docId, (s) => s.scale);
  const tool = usePdfDoc(docId, (s) => s.editorTool);
  const contentTool = usePdfDoc(docId, (s) => s.contentTool);
  const selection = usePdfDoc(docId, (s) => s.selection.length);
  const ready = status === 'ready';
  const activeTool = contentTool !== 'none' ? t(`pdf.status.content.${contentTool}`) : tool !== 'none' ? t(`pdf.status.tool.${tool}`) : null;

  return (
    <div className="vpdf-status" role="group" aria-label={t('pdf.status.region')}>
      <button
        type="button"
        className="vpdf-status__item vpdf-status__button"
        disabled={!ready}
        title={t('pdf.status.goToPage')}
        onClick={() => patchDoc(docId, { dialog: { kind: 'goToPage' } })}
      >
        {ready ? t('pdf.status.page', { page, pages }) : t('pdf.status.loading')}
      </button>
      {selection > 1 && <span className="vpdf-status__item">{t('pdf.status.selected', { count: selection })}</span>}
      {activeTool && (
        <span className="vpdf-status__item vpdf-status__tool" role="status">
          {activeTool}
        </span>
      )}
      <span className="vpdf-status__spacer" />
      <span className="vpdf-status__zoom">
        <button type="button" className="vpdf-status__button vpdf-status__icon" disabled={!ready} aria-label={t('pdf.ribbon.zoomOut')} title={t('pdf.ribbon.zoomOut')} onClick={() => controllerFor(docId)?.zoomOut()}>
          <IconMinus size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="vpdf-status__button vpdf-status__value"
          disabled={!ready}
          title={t('pdf.status.fitWidth')}
          aria-label={t('pdf.status.zoom', { value: zoomPercent(scale) })}
          onClick={() => controllerFor(docId)?.setZoom('page-width')}
        >
          {t('pdf.zoom.percent', { value: zoomPercent(scale) })}
        </button>
        <button type="button" className="vpdf-status__button vpdf-status__icon" disabled={!ready} aria-label={t('pdf.ribbon.zoomIn')} title={t('pdf.ribbon.zoomIn')} onClick={() => controllerFor(docId)?.zoomIn()}>
          <IconPlus size={14} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}
