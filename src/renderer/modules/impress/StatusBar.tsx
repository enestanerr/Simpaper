/** Presentations status bar: slide x of y and the master slide in use. */
import { useTranslation } from 'react-i18next';
import type { DocumentDescriptor } from '@shared/api/documents';
import { unoString } from '../../services/unoValues';
import { useCommandValue, useDocInfo } from '../common/hooks';
import { StatusText } from '../common/StatusItems';

export const IMPRESS_STATUS_TRIGGERS = ['.uno:PageStatus', '.uno:LayoutStatus', '.uno:Undo'] as const;

export function ImpressStatusBar({ doc }: { doc: DocumentDescriptor }) {
  const { t } = useTranslation();
  const info = useDocInfo(doc, IMPRESS_STATUS_TRIGGERS);
  const master = unoString(useCommandValue(doc.docId, '.uno:LayoutStatus'));
  return (
    <>
      {info?.slideCount !== undefined && (
        <StatusText>{t('impress.status.slideOf', { current: (info.currentSlide ?? 0) + 1, total: info.slideCount })}</StatusText>
      )}
      {master && <StatusText title={t('impress.status.masterTip')}>{master}</StatusText>}
    </>
  );
}
