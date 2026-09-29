/** Native open/save dialogs (Electron) for the document and PDF services. */
import { dialog, type BrowserWindow, type FileFilter, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import type { UiLanguage } from '@shared/api/app';
import { FORMATS, getFormat, type FormatId } from '@shared/formats';
import { MODULE_KINDS, type ModuleKind } from '@shared/modules';
import type { DocumentDialogs } from '../documents/ports';
import { DIALOG_STRINGS, FORMAT_LABELS, KIND_LABELS } from './strings';

export interface PdfDialogs {
  saveAs(win: BrowserWindow | null, defaultPath: string): Promise<string | null>;
  openPdfs(win: BrowserWindow | null): Promise<string[]>;
}

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

export function createDialogs(language: () => UiLanguage): DocumentDialogs & { pdf: PdfDialogs } {
  const showOpen = async (win: BrowserWindow | null, options: OpenDialogOptions): Promise<string[]> => {
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return r.canceled ? [] : r.filePaths;
  };
  const showSave = async (win: BrowserWindow | null, options: SaveDialogOptions): Promise<string | null> => {
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    return r.canceled || !r.filePath ? null : r.filePath;
  };

  const savePdf = (win: BrowserWindow | null, defaultPath: string) => {
    const lang = language();
    return showSave(win, { title: DIALOG_STRINGS.exportPdf[lang], defaultPath, filters: [{ name: FORMAT_LABELS.pdf[lang], extensions: ['pdf'] }], properties: ['showOverwriteConfirmation'] });
  };

  return {
    openDocuments(win, kind) {
      const lang = language();
      return showOpen(win, { title: DIALOG_STRINGS.open[lang], filters: openFilters(lang, kind), properties: ['openFile', 'multiSelections'] });
    },
    saveDocument(win, { defaultPath, kind, format }) {
      const lang = language();
      return showSave(win, { title: DIALOG_STRINGS.saveAs[lang], defaultPath, filters: saveFilters(lang, kind, format), properties: ['showOverwriteConfirmation'] });
    },
    savePdf,
    pdf: {
      saveAs: savePdf,
      openPdfs(win) {
        const lang = language();
        return showOpen(win, { title: DIALOG_STRINGS.choosePdfs[lang], filters: [{ name: FORMAT_LABELS.pdf[lang], extensions: ['pdf'] }], properties: ['openFile', 'multiSelections'] });
      },
    },
  };
}
