/** Info: file facts and the compatibility report (what may not survive saving in this format). */
import { useTranslation } from 'react-i18next';
import { IconAlertCircle, IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import type { CompatFinding, DocumentDescriptor } from '@shared/api/documents';
import { getFormat } from '@shared/formats';
import { translateExternal } from '../../i18n';
import { setBackstagePage } from '../../state/appStore';
import { ModuleIcon, MODULE_NAME_KEY } from '../brand';
import { formatDateTime } from '../format';

export function severityIcon(severity: CompatFinding['severity']) {
  if (severity === 'risk') return <IconAlertCircle size={18} stroke={1.75} className="vr-sev vr-sev--risk" aria-hidden="true" />;
  if (severity === 'warning') return <IconAlertTriangle size={18} stroke={1.75} className="vr-sev vr-sev--warning" aria-hidden="true" />;
  return <IconInfoCircle size={18} stroke={1.75} className="vr-sev vr-sev--info" aria-hidden="true" />;
}

export function FindingList({ findings }: { findings: readonly CompatFinding[] }) {
  const { t } = useTranslation();
  return (
    <ul className="vr-findings">
      {findings.map((f) => (
        <li key={f.id} className={`vr-finding vr-finding--${f.severity}`}>
          {severityIcon(f.severity)}
          <div>
            <div className="vr-finding__text">
              <span className="vr-visually-hidden">{t(`shell.compat.severity.${f.severity}`)}: </span>
              {translateExternal(f.messageKey, { count: f.count ?? 1 }, 'shell.compat.unknownFinding')}
            </div>
            {f.detail && f.detail.length > 0 && <div className="vr-finding__detail">{f.detail.join(', ')}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function InfoPage({ doc }: { doc: DocumentDescriptor | null }) {
  const { t, i18n } = useTranslation();
  if (!doc) return null;
  const format = doc.format ? getFormat(doc.format) : null;
  const findings = doc.compat?.findings ?? [];
  return (
    <div className="vr-bs-content">
      <h1 className="vr-bs-title">{t('shell.backstage.info')}</h1>
      <div className="vr-info-head">
        <ModuleIcon kind={doc.kind} size={40} />
        <div>
          <div className="vr-info-head__title">{doc.title}</div>
          <div className="vr-info-head__path">{doc.path ?? t('shell.info.notSaved')}</div>
        </div>
      </div>
      <dl className="vr-props">
        <dt>{t('shell.info.type')}</dt>
        <dd>{t(MODULE_NAME_KEY[doc.kind])}</dd>
        <dt>{t('shell.info.format')}</dt>
        <dd>{format ? t(format.labelKey) : t('shell.info.formatNew')}</dd>
        <dt>{t('shell.info.status')}</dt>
        <dd>
          {[doc.modified ? t('shell.info.modified') : t('shell.info.unmodified'), doc.readOnly ? t('shell.title.readOnly') : null].filter(Boolean).join(' · ')}
        </dd>
        {doc.recoveredAt && (
          <>
            <dt>{t('shell.info.recovered')}</dt>
            <dd>{formatDateTime(doc.recoveredAt, i18n.language)}</dd>
          </>
        )}
      </dl>

      <h2 className="vr-bs-subtitle">{t('shell.info.compatTitle')}</h2>
      {findings.length === 0 ? (
        <p className="vr-muted">{doc.compat ? t('shell.info.compatClean') : t('shell.info.compatNone')}</p>
      ) : (
        <>
          <p className="vr-muted">{t('shell.info.compatIntro')}</p>
          <FindingList findings={findings} />
          <button type="button" className="vr-btn" onClick={() => setBackstagePage('saveAs')}>
            {t('shell.info.saveCopy')}
          </button>
        </>
      )}
    </div>
  );
}
