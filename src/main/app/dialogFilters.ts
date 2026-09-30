/**
 * File-type filters of the open/save dialogs. Kept apart from dialogs.ts, which imports Electron: loading the
 * `electron` package outside Electron downloads its binary, which the unit tests must not do.
 */
import type { FileFilter } from 'electron';
import type { UiLanguage } from '@shared/api/app';
import { FORMATS, getFormat, type FormatId } from '@shared/formats';
import { MODULE_KINDS, type ModuleKind } from '@shared/modules';
import { DIALOG_STRINGS, FORMAT_LABELS, KIND_LABELS } from './strings';

function extensionsOf(kind?: ModuleKind): string[] {
  return FORMATS.filter((f) => !kind || f.kind === kind).flatMap((f) => [...f.extensions]);
}

export function openFilters(lang: UiLanguage, kind?: ModuleKind): FileFilter[] {
  const filters: FileFilter[] = [{ name: DIALOG_STRINGS.allSupported[lang], extensions: extensionsOf(kind) }];
  for (const k of kind ? [kind] : MODULE_KINDS) filters.push({ name: KIND_LABELS[k][lang], extensions: extensionsOf(k) });
  filters.push({ name: DIALOG_STRINGS.allFiles[lang], extensions: ['*'] });
  return filters;
}

/** Writable formats of the kind, the requested one first (it becomes the dialog's selected type). */
export function saveFilters(lang: UiLanguage, kind: ModuleKind, first: FormatId): FileFilter[] {
  const writable = FORMATS.filter((f) => f.kind === kind && f.support !== 'import-only');
  const ordered = [getFormat(first), ...writable.filter((f) => f.id !== first)];
  return ordered.map((f) => ({ name: FORMAT_LABELS[f.id][lang], extensions: [...f.extensions] }));
}
