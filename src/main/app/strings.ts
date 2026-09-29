/** The few strings the main process shows itself (native dialogs), in Turkish and English. */
import type { UiLanguage } from '@shared/api/app';
import type { FormatId } from '@shared/formats';
import type { ModuleKind } from '@shared/modules';

type T = Record<UiLanguage, string>;

export const FORMAT_LABELS: Record<FormatId, T> = {
  docx: { tr: 'Word Belgesi', en: 'Word Document' },
  docm: { tr: 'Makro İçerebilen Word Belgesi', en: 'Word Macro-Enabled Document' },
  dotx: { tr: 'Word Şablonu', en: 'Word Template' },
  dotm: { tr: 'Makro İçerebilen Word Şablonu', en: 'Word Macro-Enabled Template' },
  doc: { tr: 'Word 97-2003 Belgesi', en: 'Word 97-2003 Document' },
  rtf: { tr: 'Zengin Metin Biçimi', en: 'Rich Text Format' },
  txt: { tr: 'Düz Metin', en: 'Plain Text' },
  odt: { tr: 'OpenDocument Metni', en: 'OpenDocument Text' },
  xlsx: { tr: 'Excel Çalışma Kitabı', en: 'Excel Workbook' },
  xls: { tr: 'Excel 97-2003 Çalışma Kitabı', en: 'Excel 97-2003 Workbook' },
  xlsm: { tr: 'Makro İçerebilen Excel Çalışma Kitabı', en: 'Excel Macro-Enabled Workbook' },
  xlsb: { tr: 'Excel İkili Çalışma Kitabı', en: 'Excel Binary Workbook' },
  xltx: { tr: 'Excel Şablonu', en: 'Excel Template' },
  xltm: { tr: 'Makro İçerebilen Excel Şablonu', en: 'Excel Macro-Enabled Template' },
  csv: { tr: 'CSV (ayırıcılı metin)', en: 'CSV (delimited text)' },
  tsv: { tr: 'Sekmeyle ayrılmış metin', en: 'Tab-separated text' },
  ods: { tr: 'OpenDocument Hesap Tablosu', en: 'OpenDocument Spreadsheet' },
  pptx: { tr: 'PowerPoint Sunusu', en: 'PowerPoint Presentation' },
  ppt: { tr: 'PowerPoint 97-2003 Sunusu', en: 'PowerPoint 97-2003 Presentation' },
  pptm: { tr: 'Makro İçerebilen PowerPoint Sunusu', en: 'PowerPoint Macro-Enabled Presentation' },
  pps: { tr: 'PowerPoint 97-2003 Gösterisi', en: 'PowerPoint 97-2003 Show' },
  ppsx: { tr: 'PowerPoint Gösterisi', en: 'PowerPoint Show' },
  ppsm: { tr: 'Makro İçerebilen PowerPoint Gösterisi', en: 'PowerPoint Macro-Enabled Show' },
  potx: { tr: 'PowerPoint Şablonu', en: 'PowerPoint Template' },
  potm: { tr: 'Makro İçerebilen PowerPoint Şablonu', en: 'PowerPoint Macro-Enabled Template' },
  odp: { tr: 'OpenDocument Sunusu', en: 'OpenDocument Presentation' },
  pdf: { tr: 'PDF Belgesi', en: 'PDF Document' },
};

export const KIND_LABELS: Record<ModuleKind, T> = {
  writer: { tr: 'Belgeler', en: 'Documents' },
  calc: { tr: 'Hesap tabloları', en: 'Spreadsheets' },
  impress: { tr: 'Sunular', en: 'Presentations' },
  pdf: { tr: 'PDF dosyaları', en: 'PDF files' },
};

export const DIALOG_STRINGS = {
  open: { tr: 'Aç', en: 'Open' },
  saveAs: { tr: 'Farklı Kaydet', en: 'Save As' },
  exportPdf: { tr: 'PDF Olarak Dışa Aktar', en: 'Export as PDF' },
  choosePdfs: { tr: 'PDF Dosyalarını Seç', en: 'Choose PDF Files' },
  allSupported: { tr: 'Desteklenen tüm dosyalar', en: 'All supported files' },
  allFiles: { tr: 'Tüm dosyalar', en: 'All files' },
} satisfies Record<string, T>;
