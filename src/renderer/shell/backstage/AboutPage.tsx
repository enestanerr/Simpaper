/** About: versions, license, engine attribution, third-party notices, privacy statement. */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IconExternalLink, IconShieldCheck } from '@tabler/icons-react';
import { BRAND } from '@shared/brand';
import type { DocumentDescriptor } from '@shared/api/documents';
import { hasBridge, invoke } from '../../services/ipc';
import { useApp } from '../../state/appStore';
import { LOGO_URL } from '../brand';

/** External pages (all on the main process allow-list for app:openExternal). */
export const ABOUT_LINKS = {
  repository: BRAND.repositoryUrl,
  issues: BRAND.issuesUrl,
  notices: `${BRAND.repositoryUrl}/blob/main/THIRD_PARTY_NOTICES.md`,
  license: 'https://www.mozilla.org/en-US/MPL/2.0/',
  libreoffice: 'https://www.libreoffice.org/',
  engineSource: 'https://download.documentfoundation.org/libreoffice/src/',
} as const;

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <button
      type="button"
      className="vr-link-btn"
      onClick={() => {
        if (hasBridge()) void invoke('app:openExternal', { url: href }).catch(() => undefined);
      }}
    >
      {children}
      <IconExternalLink size={13} stroke={1.75} aria-hidden="true" />
    </button>
  );
}

export function AboutPage(_props: { doc: DocumentDescriptor | null }) {
  const { t } = useTranslation();
  const info = useApp((s) => s.appInfo);

  useEffect(() => {
    if (!hasBridge()) return;
    invoke('app:info', undefined)
      .then((appInfo) => useApp.setState({ appInfo }))
      .catch(() => undefined);
  }, []);

  const engine = info?.engine;
  return (
    <div className="vr-bs-content vr-about">
      <div className="vr-about__head">
        <img src={LOGO_URL} width={64} height={64} alt="" draggable={false} />
        <div>
          <h1 className="vr-bs-title">{BRAND.productName}</h1>
          <div className="vr-muted">{t('shell.about.version', { version: info?.version ?? '—' })}</div>
        </div>
      </div>
      <p>{t('shell.about.description')}</p>

      <dl className="vr-props">
        <dt>{t('shell.about.engine')}</dt>
        <dd>
          {engine?.available
            ? t('shell.about.engineVersion', { version: engine.officeVersion ?? '?' })
            : t('shell.about.engineMissing', { error: engine?.error ?? '' })}
        </dd>
        <dt>Electron</dt>
        <dd>{info?.electronVersion ?? '—'}</dd>
        <dt>Chromium</dt>
        <dd>{info?.chromeVersion ?? '—'}</dd>
        <dt>{t('shell.about.platform')}</dt>
        <dd>{info?.platform ?? '—'}</dd>
      </dl>

      <h2 className="vr-bs-subtitle">{t('shell.about.licenseTitle')}</h2>
      <p>{t('shell.about.license')}</p>
      <p className="vr-about__attribution">{BRAND.engineAttribution}</p>
      <p>{t('shell.about.engineLicense')}</p>
      <ul className="vr-about__links">
        <li>
          <ExternalLink href={ABOUT_LINKS.license}>{t('shell.about.linkLicense')}</ExternalLink>
        </li>
        <li>
          <ExternalLink href={ABOUT_LINKS.notices}>{t('shell.about.linkNotices')}</ExternalLink>
        </li>
        <li>
          <ExternalLink href={ABOUT_LINKS.engineSource}>{t('shell.about.linkEngineSource')}</ExternalLink>
        </li>
        <li>
          <ExternalLink href={ABOUT_LINKS.repository}>{t('shell.about.linkRepository')}</ExternalLink>
        </li>
        <li>
          <ExternalLink href={ABOUT_LINKS.issues}>{t('shell.about.linkIssues')}</ExternalLink>
        </li>
      </ul>

      <div className="vr-banner vr-banner--info">
        <IconShieldCheck size={18} stroke={1.75} aria-hidden="true" />
        <span>{t('shell.about.privacy')}</span>
      </div>
      <p className="vr-muted vr-about__trademark">{t('shell.about.trademarks')}</p>
    </div>
  );
}
