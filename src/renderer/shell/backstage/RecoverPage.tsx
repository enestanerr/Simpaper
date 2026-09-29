/** Recovered unsaved work (recovery:list / restore / discard). */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DocumentDescriptor } from '@shared/api/documents';
import { discardRecovery, refreshRecovery, restoreRecovery } from '../../services/documents';
import { closeBackstage, useApp } from '../../state/appStore';
import { ModuleIcon } from '../brand';
import { formatBytes, formatDateTime } from '../format';

export function RecoverPage(_props: { doc: DocumentDescriptor | null }) {
  const { t, i18n } = useTranslation();
  const entries = useApp((s) => s.recovery);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void refreshRecovery();
  }, []);

  const run = async (id: string, fn: (id: string) => Promise<void>, close: boolean) => {
    setBusy(id);
    try {
      await fn(id);
      if (close) closeBackstage();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="vr-bs-content">
      <h1 className="vr-bs-title">{t('shell.backstage.recover')}</h1>
      <p className="vr-muted">{t('shell.recover.intro')}</p>
      {entries.length === 0 ? (
        <p className="vr-empty">{t('shell.recover.empty')}</p>
      ) : (
        <ul className="vr-recovery">
          {entries.map((e) => (
            <li key={e.id} className="vr-recovery__item">
              <ModuleIcon kind={e.kind} size={28} />
              <div className="vr-recovery__text">
                <div className="vr-recovery__title">{e.title}</div>
                <div className="vr-recovery__meta">
                  {t(e.reason === 'engine-crash' ? 'shell.recover.reasonCrash' : 'shell.recover.reasonShutdown')} ·{' '}
                  {formatDateTime(e.snapshotAt, i18n.language)} · {formatBytes(e.sizeBytes, i18n.language)}
                </div>
                {e.originalPath && <div className="vr-recovery__path">{e.originalPath}</div>}
              </div>
              <div className="vr-recovery__actions">
                <button type="button" className="vr-btn vr-btn--primary" disabled={busy !== null} onClick={() => void run(e.id, restoreRecovery, true)}>
                  {t('shell.recover.restore')}
                </button>
                <button type="button" className="vr-btn vr-btn--danger" disabled={busy !== null} onClick={() => void run(e.id, discardRecovery, false)}>
                  {t('shell.recover.discard')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
