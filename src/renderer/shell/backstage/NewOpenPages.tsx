/** New and Open pages of the backstage. */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFileTypePdf, IconFolderOpen } from '@tabler/icons-react';
import { OFFICE_KINDS } from '@shared/modules';
import type { DocumentDescriptor } from '@shared/api/documents';
import { createDocument, openWithDialog, refreshRecent } from '../../services/documents';
import { closeBackstage } from '../../state/appStore';
import { MODULE_ICON_URL, MODULE_NAME_KEY } from '../brand';
import { RecentList } from './RecentList';

export function NewPage(_props: { doc: DocumentDescriptor | null }) {
  const { t } = useTranslation();
  return (
    <div className="vr-bs-content">
      <h1 className="vr-bs-title">{t('shell.backstage.new')}</h1>
      <div className="vr-tiles">
        {OFFICE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="vr-tile"
            data-kind={kind}
            onClick={() => {
              closeBackstage();
              void createDocument(kind);
            }}
          >
            <img src={MODULE_ICON_URL[kind]} width={40} height={40} alt="" draggable={false} />
            <span className="vr-tile__label">{t(`shell.start.blank.${kind}`)}</span>
            <span className="vr-tile__hint">{t(MODULE_NAME_KEY[kind])}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function OpenPage(_props: { doc: DocumentDescriptor | null }) {
  const { t } = useTranslation();
  useEffect(() => {
    void refreshRecent();
  }, []);
  return (
    <div className="vr-bs-content">
      <h1 className="vr-bs-title">{t('shell.backstage.open')}</h1>
      <div className="vr-start__actions">
        <button
          type="button"
          className="vr-btn vr-btn--primary"
          onClick={() => {
            closeBackstage();
            void openWithDialog();
          }}
        >
          <IconFolderOpen size={16} stroke={1.75} aria-hidden="true" />
          {t('shell.start.openFile')}
        </button>
        <button
          type="button"
          className="vr-btn"
          onClick={() => {
            closeBackstage();
            void openWithDialog('pdf');
          }}
        >
          <IconFileTypePdf size={16} stroke={1.75} aria-hidden="true" />
          {t('shell.start.openPdf')}
        </button>
      </div>
      <h2 className="vr-bs-subtitle">{t('shell.start.recent')}</h2>
      <RecentList />
    </div>
  );
}
