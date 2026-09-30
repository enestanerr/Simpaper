/**
 * The file types Simpaper registers with Windows (build/installer.nsh writes them at install time; the Options page
 * shows which of them currently open with Simpaper). Derived from FORMATS, so every format the app can open is
 * registered exactly once; tests/unit/main/fileAssociations.test.ts keeps the installer script in step with it.
 */
import { FORMATS, type FormatId } from './formats';
import type { ModuleKind } from './modules';

/** File-type icon per module: `resources/fileicons/<name>.ico`, installed to `resources\fileicons`. */
export const FILE_TYPE_ICON: Record<ModuleKind, 'document' | 'spreadsheet' | 'presentation' | 'pdf'> = {
  writer: 'document',
  calc: 'spreadsheet',
  impress: 'presentation',
  pdf: 'pdf',
};

/**
 * Plain-text formats: offered in "Open with" and on Simpaper's Default apps page, but never proposed as the
 * default (their ProgIDs carry AllowSilentDefaultTakeOver), so Notepad, spreadsheet apps and code editors keep them.
 */
export const OPEN_WITH_ONLY: ReadonlySet<FormatId> = new Set<FormatId>(['txt', 'csv', 'tsv']);

/** ProgID of a format. Never rename one: the user's default-app choices point at these names. */
export function progIdOf(format: FormatId): string {
  return `Simpaper.${format}`;
}

export interface FileAssociation {
  /** Extension without the dot, lower case. */
  ext: string;
  format: FormatId;
  kind: ModuleKind;
  progId: string;
  icon: (typeof FILE_TYPE_ICON)[ModuleKind];
  /** Proposed as the default where no other registered app owns the type (never overrides the user's choice). */
  claim: boolean;
}

export const FILE_ASSOCIATIONS: readonly FileAssociation[] = FORMATS.flatMap((f) =>
  f.extensions.map((ext) => ({ ext, format: f.id, kind: f.kind, progId: progIdOf(f.id), icon: FILE_TYPE_ICON[f.kind], claim: !OPEN_WITH_ONLY.has(f.id) })),
);
