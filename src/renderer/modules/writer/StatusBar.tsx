/** Documents status bar: page x of y, word count, language. */
import { useTranslation } from 'react-i18next';
import type { DocumentDescriptor } from '@shared/api/documents';
import { dispatchUno } from '../../services/engine';
import { languageFromState } from '../../services/unoValues';
import { useCommandValue, useDocInfo } from '../common/hooks';
import { formatNumber, StatusButton, StatusText } from '../common/StatusItems';

export const WRITER_STATUS_TRIGGERS = ['.uno:StatePageNumber', '.uno:LanguageStatus', '.uno:Undo'] as const;

export function WriterStatusBar({ doc }: { doc: DocumentDescriptor }) {
  const { t, i18n } = useTranslation();
  const info = useDocInfo(doc, WRITER_STATUS_TRIGGERS);
  const language = languageFromState(useCommandValue(doc.docId, '.uno:LanguageStatus'));
  const ready = doc.state === 'ready';
  return (
    <>
      {info?.pageCount !== undefined && (
        <StatusButton
          label={t('writer.status.pageOf', { current: info.currentPage ?? 1, total: info.pageCount })}
          onClick={() => void dispatchUno(doc.docId, '.uno:GotoPage')}
          disabled={!ready}
        >
          {t('writer.status.pageOf', { current: info.currentPage ?? 1, total: info.pageCount })}
        </StatusButton>
      )}
      {info?.wordCount !== undefined && (
        <StatusButton
          label={t('writer.status.words', { count: info.wordCount, formatted: formatNumber(info.wordCount, i18n.language) })}
          onClick={() => void dispatchUno(doc.docId, '.uno:WordCountDialog')}
          disabled={!ready}
        >
          {t('writer.status.words', { count: info.wordCount, formatted: formatNumber(info.wordCount, i18n.language) })}
        </StatusButton>
      )}
      {language && <StatusText title={t('writer.status.language')}>{language}</StatusText>}
    </>
  );
}
