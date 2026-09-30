/**
 * Options › File types: which of the file types the installer registers (build/installer.nsh) open with Simpaper
 * today, and the Settings page where the user changes that. Windows leaves the default-app choice to the user (the
 * UserChoice hash, guarded by the UCPD driver), so the app only reads the state and opens Settings; see
 * docs/adr/0010-file-associations.md.
 */
import type { FileTypeGroup, FileTypesStatus } from '@shared/api/app';
import { BRAND } from '@shared/brand';
import { FILE_ASSOCIATIONS, progIdOf } from '@shared/fileAssociations';
import { MODULE_KINDS } from '@shared/modules';
import type { AssociationQuery } from '../platform/types';

const canonical = (p: string) => p.replace(/\//g, '\\').toLowerCase();

function samePath(a: string | null, b: string): boolean {
  return a !== null && canonical(a) === canonical(b);
}

/** Reads the state from Windows (about fifty association lookups on worker threads). */
export async function fileTypesStatus(query: AssociationQuery | undefined, execPath: string): Promise<FileTypesStatus> {
  const claimed = FILE_ASSOCIATIONS.filter((a) => a.claim);
  const groups: FileTypeGroup[] = MODULE_KINDS.map((kind) => ({ kind, extensions: claimed.filter((a) => a.kind === kind).map((a) => a.ext), withSimpaper: [] }));
  if (!query) return { supported: false, registration: null, thisCopy: false, groups };
  const [registration, registered, handlers] = await Promise.all([
    query.registeredApp(BRAND.registeredAppName),
    query.handler(progIdOf('docx')),
    Promise.all(claimed.map((a) => query.handler(`.${a.ext}`))),
  ]);
  claimed.forEach((a, i) => {
    const h = handlers[i];
    const ours = h !== undefined && (h.progId?.toLowerCase() === a.progId.toLowerCase() || samePath(h.executable, execPath));
    if (ours) groups.find((g) => g.kind === a.kind)?.withSimpaper.push(a.ext);
  });
  return { supported: true, registration, thisCopy: samePath(registered.executable, execPath), groups };
}

/**
 * Settings › Apps › Default apps on Simpaper's page (Windows 11 21H2/22H2 with the April 2023 update, 23H2 and later;
 * Windows 10 opens the list of default apps).
 */
export function defaultAppsUri(registration: 'user' | 'machine'): string {
  const param = registration === 'machine' ? 'registeredAppMachine' : 'registeredAppUser';
  return `ms-settings:defaultapps?${param}=${encodeURIComponent(BRAND.registeredAppName)}`;
}
