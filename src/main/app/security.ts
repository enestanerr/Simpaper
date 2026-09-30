/**
 * Renderer hardening (Electron security checklist): permission requests denied except a few harmless
 * ones for our own page, no navigation away from the app, no new windows, no <webview>, external links
 * only for allow-listed https URLs (opened in the system browser).
 */
import type { Session, WebContents } from 'electron';
import { BRAND } from '@shared/brand';
import type { Logger } from '../log';

/** https URL prefixes app:openExternal may open (project pages, licenses, engine attribution). */
export const EXTERNAL_URL_PREFIXES: readonly string[] = [
  `${BRAND.repositoryUrl}`,
  `${BRAND.issuesUrl}`,
  'https://www.mozilla.org/en-US/MPL/2.0/',
  'https://www.mozilla.org/MPL/2.0/',
  'https://www.libreoffice.org/',
  'https://www.documentfoundation.org/',
  'https://download.documentfoundation.org/libreoffice/src/',
  'https://github.com/mozilla/pdf.js',
];

export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const href = url.href;
  return EXTERNAL_URL_PREFIXES.some((prefix) => href === prefix || href.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
}

/** Permissions our own page may use: sanitized clipboard writes, fullscreen (slide shows) and the local font list. */
const GRANTED = new Set(['clipboard-sanitized-write', 'fullscreen', 'local-fonts']);

export function hardenSession(ses: Session, isAppUrl: (url: string) => boolean, log: Logger): void {
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    const ok = GRANTED.has(permission) && isAppUrl(wc.getURL());
    if (!ok) log.warn('permission request denied', { permission });
    callback(ok);
  });
  ses.setPermissionCheckHandler((wc, permission) => GRANTED.has(permission) && !!wc && isAppUrl(wc.getURL()));
  // Downloads never happen in Varak; refuse anything a page might trigger.
  ses.on('will-download', (event) => {
    event.preventDefault();
    log.warn('download blocked');
  });
}

export function hardenWebContents(contents: WebContents, opts: { isAppUrl: (url: string) => boolean; openExternal: (url: string) => void; log: Logger }): void {
  contents.on('will-navigate', (event) => {
    const url = event.url;
    if (opts.isAppUrl(url)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) opts.openExternal(url);
    else opts.log.warn('navigation blocked', { scheme: url.split(':')[0] });
  });
  contents.on('will-redirect', (event) => {
    if (!opts.isAppUrl(event.url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) opts.openExternal(url);
    else opts.log.warn('window.open blocked', { scheme: url.split(':')[0] });
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}
