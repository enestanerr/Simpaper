/** Home screen shown when no document is open: new documents, open, recent files, recovery banner. */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFileTypePdf, IconFolderOpen, IconHistory, IconInfoCircle, IconSettings } from '@tabler/icons-react';
import { OFFICE_KINDS } from '@shared/modules';
import { BRAND } from '@shared/brand';
import { createDocument, openWithDialog, refreshRecent, refreshRecovery } from '../services/documents';
import { openBackstage, useApp } from '../state/appStore';
import { LOGO_URL, MODULE_ICON_URL, MODULE_NAME_KEY } from './brand';
import { RecentList } from './backstage/RecentList';

export function StartScreen() {
  const { t } = useTranslation();
  const recovery = useApp((s) => s.recovery);

  useEffect(() => {
    void refreshRecent();
    void refreshRecovery();
  }, []);

  return (
    <main className="vr-start" aria-labelledby="vr-start-title">
      <div className="vr-start__inner">
        <header className="vr-start__hero">
          <img src={LOGO_URL} width={56} height={56} alt="" draggable={false} />
          <div>
            <h1 id="vr-start-title" className="vr-start__title">
              {BRAND.productName}
            </h1>
            <p className="vr-start__tagline">{t('shell.start.tagline')}</p>
          </div>
        </header>

        {recovery.length > 0 && (
          <div className="vr-banner vr-banner--warning" role="status">
            <IconHistory size={18} stroke={1.75} aria-hidden="true" />
            <span>{t('shell.start.recoveryAvailable', { count: recovery.length })}</span>
            <button type="button" className="vr-btn vr-btn--primary" onClick={() => openBackstage('recover')}>
              {t('shell.start.showRecovery')}
            </button>
          </div>
        )}

        <section aria-labelledby="vr-start-new">
          <h2 id="vr-start-new" className="vr-section-title">
            {t('shell.start.new')}
          </h2>
          <div className="vr-tiles">
            {OFFICE_KINDS.map((kind) => (
              <button key={kind} type="button" className="vr-tile" data-kind={kind} onClick={() => void createDocument(kind)}>
                <img src={MODULE_ICON_URL[kind]} width={40} height={40} alt="" draggable={false} />
                <span className="vr-tile__label">{t(`shell.start.blank.${kind}`)}</span>
                <span className="vr-tile__hint">{t(MODULE_NAME_KEY[kind])}</span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="vr-start-open" className="vr-start__open">
          <h2 id="vr-start-open" className="vr-section-title">
            {t('shell.start.open')}
          </h2>
          <div className="vr-start__actions">
            <button type="button" className="vr-btn vr-btn--primary" onClick={() => void openWithDialog()}>
              <IconFolderOpen size={16} stroke={1.75} aria-hidden="true" />
              {t('shell.start.openFile')}
            </button>
            <button type="button" className="vr-btn" onClick={() => void openWithDialog('pdf')}>
              <IconFileTypePdf size={16} stroke={1.75} aria-hidden="true" />
              {t('shell.start.openPdf')}
            </button>
          </div>
        </section>

        <section aria-labelledby="vr-start-recent">
          <h2 id="vr-start-recent" className="vr-section-title">
            {t('shell.start.recent')}
          </h2>
          <RecentList />
        </section>

        <footer className="vr-start__footer">
          <button type="button" className="vr-btn vr-btn--ghost" onClick={() => openBackstage('options')}>
            <IconSettings size={16} stroke={1.75} aria-hidden="true" />
            {t('shell.backstage.options')}
          </button>
          <button type="button" className="vr-btn vr-btn--ghost" onClick={() => openBackstage('about')}>
            <IconInfoCircle size={16} stroke={1.75} aria-hidden="true" />
            {t('shell.backstage.about')}
          </button>
        </footer>
      </div>
    </main>
  );
}
