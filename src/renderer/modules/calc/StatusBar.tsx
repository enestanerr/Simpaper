/** Spreadsheets status bar: sheet position and the selection functions (Average/Sum ... from `.uno:StateTableCell`). */
import { useTranslation } from 'react-i18next';
import type { DocumentDescriptor } from '@shared/api/documents';
import { statusFunctionsFromState } from '../../services/unoValues';
import { useCommandValue, useDocInfo } from '../common/hooks';
import { StatusText } from '../common/StatusItems';

export const CALC_STATUS_TRIGGERS = ['.uno:StateTableCell', '.uno:StatusDocPos'] as const;

export function CalcStatusBar({ doc }: { doc: DocumentDescriptor }) {
  const { t } = useTranslation();
  const info = useDocInfo(doc, CALC_STATUS_TRIGGERS);
  const functions = statusFunctionsFromState(useCommandValue(doc.docId, '.uno:StateTableCell'));
  const sheets = info?.sheetNames ?? [];
  const index = info?.activeSheet ? sheets.indexOf(info.activeSheet) : -1;
  return (
    <>
      {info?.activeSheet && (
        <StatusText title={t('calc.status.sheetTip')}>
          {index >= 0 ? t('calc.status.sheetOf', { current: index + 1, total: sheets.length, name: info.activeSheet }) : info.activeSheet}
        </StatusText>
      )}
      {functions.length > 0 && (
        <span className="vr-status__group" aria-label={t('calc.status.selection')} role="group">
          {functions.map((f) => (
            <StatusText key={f}>{f}</StatusText>
          ))}
        </span>
      )}
    </>
  );
}
