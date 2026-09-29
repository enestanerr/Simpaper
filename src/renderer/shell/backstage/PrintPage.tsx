/** Print: hands over to the print dialog of the engine (office documents) or of the PDF module. */
import { useTranslation } from 'react-i18next';
import { IconPrinter } from '@tabler/icons-react';
import type { DocumentDescriptor } from '@shared/api/documents';
import { isOfficeKind } from '@shared/modules';
import { runShellAction } from '../../services/shellActions';
import { closeBackstage } from '../../state/appStore';

export function PrintPage({ doc }: { doc: DocumentDescriptor | null }) {
  const { t } = useTranslation();
  if (!doc) return null;
  return (
    <div className="vr-bs-content">
      <h1 className="vr-bs-title">{t('shell.backstage.print')}</h1>
      <button
        type="button"
        className="vr-btn vr-btn--primary vr-btn--big"
        onClick={() => {
          closeBackstage();
          void runShellAction('file.print', undefined, doc);
        }}
      >
        <IconPrinter size={18} stroke={1.75} aria-hidden="true" />
        {t('shell.print.button')}
      </button>
      <p className="vr-muted">{isOfficeKind(doc.kind) ? t('shell.print.hintOffice') : t('shell.print.hintPdf')}</p>
    </div>
  );
}
