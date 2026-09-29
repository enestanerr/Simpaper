/** Inline messages of a PDF document (errors stay until dismissed, information fades after a while). */
import { IconAlertTriangle, IconInfoCircle, IconX } from '@tabler/icons-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { dismissNotice, usePdfDoc, type Notice } from '../state/store';

const INFO_TIMEOUT_MS = 7000;

function NoticeItem({ docId, notice }: { docId: string; notice: Notice }) {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    if (notice.kind !== 'info') return;
    const timer = setTimeout(() => dismissNotice(docId, notice.id), INFO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [docId, notice]);
  const text = i18n.exists(notice.key) ? t(notice.key, notice.values) : t(notice.kind === 'error' ? 'pdf.errors.operationFailed' : notice.key);
  const Icon = notice.kind === 'error' ? IconAlertTriangle : IconInfoCircle;
  return (
    <div className={`vpdf-notice vpdf-notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <Icon size={16} aria-hidden="true" className="vpdf-notice__icon" />
      <span className="vpdf-notice__text">{text}</span>
      <button type="button" className="vpdf-notice__close" aria-label={t('pdf.dialogs.close')} title={t('pdf.dialogs.close')} onClick={() => dismissNotice(docId, notice.id)}>
        <IconX size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function Notices({ docId }: { docId: string }) {
  const notices = usePdfDoc(docId, (s) => s.notices);
  if (notices.length === 0) return null;
  return (
    <div className="vpdf-notices">
      {notices.map((n) => (
        <NoticeItem key={n.id} docId={docId} notice={n} />
      ))}
    </div>
  );
}
