/** The four editors of the suite. Office kinds are backed by the LibreOffice engine, `pdf` by pdf.js. */
export type ModuleKind = 'writer' | 'calc' | 'impress' | 'pdf';

export type OfficeKind = Exclude<ModuleKind, 'pdf'>;

export const OFFICE_KINDS: readonly OfficeKind[] = ['writer', 'calc', 'impress'] as const;
export const MODULE_KINDS: readonly ModuleKind[] = ['writer', 'calc', 'impress', 'pdf'] as const;

export function isOfficeKind(kind: ModuleKind): kind is OfficeKind {
  return kind !== 'pdf';
}

/** LibreOffice factory URLs for new documents. */
export const NEW_DOCUMENT_URL: Record<OfficeKind, string> = {
  writer: 'private:factory/swriter',
  calc: 'private:factory/scalc',
  impress: 'private:factory/simpress',
};
