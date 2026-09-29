/** Workspace of an office document: the native view placeholder plus loading / closing / crashed states. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconLoader2 } from '@tabler/icons-react';
import type { DocumentDescriptor } from '@shared/api/documents';
import { closeDocument, refreshRecovery, restoreRecovery, samePath } from '../../services/documents';
import { openBackstage, useApp } from '../../state/appStore';
import type { WorkspaceProps } from '../types';
import { DocumentSurface } from './DocumentSurface';

export function OfficeWorkspace({ doc, active }: WorkspaceProps) {
  const { t } = useTranslation();
  const backstageOpen = useApp((s) => s.backstage.open);
  const live = doc.state === 'ready' || doc.state === 'busy';
  const visible = active && live && !backstageOpen;
  return (
    <div className="vr-workspace vr-workspace--office">
      <DocumentSurface docId={doc.docId} visible={visible} label={t('shell.workspace.documentArea', { title: doc.title })} />
      {doc.state === 'loading' && <ProgressOverlay text={t('shell.workspace.loading', { title: doc.title })} />}
      {/* A normal close: main reports 'closed' first and the 'closed' event once the engine has shut down. */}
      {doc.state === 'closed' && <ProgressOverlay text={t('shell.workspace.closing', { title: doc.title })} />}
      {doc.state === 'crashed' && <CrashedOverlay doc={doc} />}
    </div>
  );
}

/** Neutral progress notice over the document area (opening, closing). */
function ProgressOverlay({ text }: { text: string }) {
  return (
    <div className="vr-surface-overlay" role="status" aria-live="polite">
      <IconLoader2 className="vr-spin" size={28} stroke={1.75} aria-hidden="true" />
      <div>{text}</div>
    </div>
  );
}

/** Newest recovery snapshot that belongs to this document (same file, or same title for unsaved documents). */
export function findRecoveryFor(doc: DocumentDescriptor, entries: ReturnType<typeof useApp.getState>['recovery']) {
  const matches = entries.filter((e) =>
    e.kind === doc.kind && (doc.path && e.originalPath ? samePath(doc.path, e.originalPath) : !e.originalPath && e.title === doc.title),
  );
  return matches.sort((a, b) => b.snapshotAt.localeCompare(a.snapshotAt))[0];
}

function CrashedOverlay({ doc }: { doc: DocumentDescriptor }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const recover = async () => {
    setBusy(true);
    try {
      await refreshRecovery();
      const entry = findRecoveryFor(doc, useApp.getState().recovery);
      if (!entry) {
        openBackstage('recover');
        return;
      }
      await restoreRecovery(entry.id);
      await closeDocument(doc.docId, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="vr-surface-overlay vr-surface-overlay--error" role="alert">
      <IconAlertTriangle size={32} stroke={1.6} aria-hidden="true" />
      <h2>{t('shell.workspace.crashedTitle')}</h2>
      <p>{t('shell.workspace.crashedBody')}</p>
      <div className="vr-surface-overlay__actions">
        <button type="button" className="vr-btn vr-btn--primary" disabled={busy} onClick={() => void recover()}>
          {t('shell.workspace.recover')}
        </button>
        <button type="button" className="vr-btn" disabled={busy} onClick={() => void closeDocument(doc.docId, true)}>
          {t('shell.workspace.closeDocument')}
        </button>
      </div>
    </div>
  );
}
