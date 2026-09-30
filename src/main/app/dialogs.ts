/** Native open/save dialogs (Electron) for the document and PDF services. */
import { dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import type { UiLanguage } from '@shared/api/app';
import type { DocumentDialogs } from '../documents/ports';
import { openFilters, saveFilters } from './dialogFilters';
import { DIALOG_STRINGS, FORMAT_LABELS } from './strings';


export interface PdfDialogs {
  saveAs(win: BrowserWindow | null, defaultPath: string): Promise<string | null>;
  openPdfs(win: BrowserWindow | null): Promise<string[]>;
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
