/** Recently opened files (documents:recent). */
import { useTranslation } from 'react-i18next';
import { closeBackstage, useApp } from '../../state/appStore';
import { fileNameOf, openPath } from '../../services/documents';
import { ModuleIcon } from '../brand';
import { formatDateTime } from '../format';

export function folderOf(path: string): string {
  const name = fileNameOf(path);
  return path.slice(0, Math.max(0, path.length - name.length - 1));
}

export function RecentList({ limit }: { limit?: number }) {
  const { t, i18n } = useTranslation();
  const recent = useApp((s) => s.recent);
  const items = limit ? recent.slice(0, limit) : recent;
  if (items.length === 0) return <p className="vr-empty">{t('shell.recent.empty')}</p>;
  return (
    <ul className="vr-recent" aria-label={t('shell.recent.label')}>
      {items.map((r) => (
        <li key={r.path}>
          <button
            type="button"
            className="vr-recent__item"
            disabled={!r.exists}
            title={r.path}
            onClick={() => {
              closeBackstage();
              void openPath(r.path);
            }}
          >
            <ModuleIcon kind={r.kind} size={24} />
            <span className="vr-recent__text">
              <span className="vr-recent__title">{r.title}</span>
              <span className="vr-recent__path">{folderOf(r.path)}</span>
            </span>
            <span className="vr-recent__meta">
              {r.exists ? formatDateTime(r.openedAt, i18n.language) : <span className="vr-recent__missing">{t('shell.recent.missing')}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
