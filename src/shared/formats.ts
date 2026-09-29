import type { ModuleKind, OfficeKind } from './modules';

/**
 * File-format registry. Drives open/save dialogs, engine filter selection and the
 * compatibility matrix (docs/COMPATIBILITY.md). Filter names were taken from the
 * LibreOffice 26.8.0.3 filter configuration (share/registry/*.xcd); see docs/research/formats.md.
 *
 * `support`:
 *  - `native`      opened and saved back in the same format by the engine.
 *  - `import-only` opened by the engine; saving must go to another format (`saveFallback`).
 *  - `pdf`         handled by the PDF module (pdf.js + pdf-lib), not by the office engine.
 */
export type FormatId =
  | 'docx' | 'doc' | 'docm' | 'dotx' | 'dotm' | 'rtf' | 'txt' | 'odt'
  | 'xlsx' | 'xls' | 'xlsm' | 'xlsb' | 'xltx' | 'xltm' | 'csv' | 'tsv' | 'ods'
  | 'pptx' | 'ppt' | 'pptm' | 'pps' | 'ppsx' | 'ppsm' | 'potx' | 'potm' | 'odp'
  | 'pdf';

export type FormatFamily = 'ooxml' | 'odf' | 'binary' | 'text' | 'pdf';
export type FormatSupport = 'native' | 'import-only' | 'pdf';

export interface FormatInfo {
  id: FormatId;
  kind: ModuleKind;
  extensions: readonly string[];
  family: FormatFamily;
  /** Priority formats of milestone 1 are `primary`. */
  tier: 'primary' | 'secondary';
  support: FormatSupport;
  /** i18n key under `formats.*`. */
  labelKey: string;
  /** Explicit LibreOffice import filter. Undefined = engine type detection (preferred for OOXML/ODF). */
  importFilter?: string;
  /** Import FilterOptions (CSV/TXT). May contain `{lcid}` which is replaced with the locale id. */
  importFilterOptions?: string;
  /** LibreOffice export filter used when saving a document that was not loaded from this format. */
  exportFilter?: string;
  /** Export FilterOptions (CSV/TXT). */
  exportFilterOptions?: string;
  /** When saving back to the same format, reuse the filter LibreOffice used on load (keeps ECMA vs ISO flavour). */
  keepLoadFilter?: boolean;
  macroEnabled: boolean;
  template: boolean;
  /** Format proposed by "Save" when the same format cannot be written. */
  saveFallback?: FormatId;
  /** PPS/PPSX start a slideshow when opened with the autodetected filter; we load them for editing instead. */
  editImportFilter?: string;
  /** Content that is known to be lost or changed when saving in this format (i18n keys under `compat.loss.*`). */
  knownLosses?: readonly string[];
}

const F = (f: FormatInfo) => f;

export const FORMATS: readonly FormatInfo[] = [
  // ---------------------------------------------------------------- Documents
  F({ id: 'docx', kind: 'writer', extensions: ['docx'], family: 'ooxml', tier: 'primary', support: 'native', labelKey: 'formats.docx', exportFilter: 'MS Word 2007 XML', keepLoadFilter: true, macroEnabled: false, template: false }),
  F({ id: 'docm', kind: 'writer', extensions: ['docm'], family: 'ooxml', tier: 'secondary', support: 'native', labelKey: 'formats.docm', exportFilter: 'MS Word 2007 XML VBA', keepLoadFilter: true, macroEnabled: true, template: false }),
  F({ id: 'dotx', kind: 'writer', extensions: ['dotx'], family: 'ooxml', tier: 'secondary', support: 'native', labelKey: 'formats.dotx', exportFilter: 'MS Word 2007 XML Template', keepLoadFilter: true, macroEnabled: false, template: true }),
  F({ id: 'dotm', kind: 'writer', extensions: ['dotm'], family: 'ooxml', tier: 'secondary', support: 'import-only', labelKey: 'formats.dotm', macroEnabled: true, template: true, saveFallback: 'docm', knownLosses: ['compat.loss.macroTemplate'] }),
  F({ id: 'doc', kind: 'writer', extensions: ['doc'], family: 'binary', tier: 'secondary', support: 'native', labelKey: 'formats.doc', exportFilter: 'MS Word 97', macroEnabled: false, template: false, knownLosses: ['compat.loss.legacyBinary'] }),
  F({ id: 'rtf', kind: 'writer', extensions: ['rtf'], family: 'text', tier: 'secondary', support: 'native', labelKey: 'formats.rtf', exportFilter: 'Rich Text Format', macroEnabled: false, template: false, knownLosses: ['compat.loss.rtf'] }),
  F({ id: 'txt', kind: 'writer', extensions: ['txt'], family: 'text', tier: 'secondary', support: 'native', labelKey: 'formats.txt', importFilter: 'Text (encoded)', importFilterOptions: 'UTF8,CRLF,,{bcp47}', exportFilter: 'Text (encoded)', exportFilterOptions: 'UTF8,CRLF,,{bcp47},true,false', macroEnabled: false, template: false, knownLosses: ['compat.loss.plainText'] }),
  F({ id: 'odt', kind: 'writer', extensions: ['odt'], family: 'odf', tier: 'secondary', support: 'native', labelKey: 'formats.odt', exportFilter: 'writer8', macroEnabled: false, template: false }),
  // ---------------------------------------------------------------- Spreadsheets
  F({ id: 'xlsx', kind: 'calc', extensions: ['xlsx'], family: 'ooxml', tier: 'primary', support: 'native', labelKey: 'formats.xlsx', exportFilter: 'Calc MS Excel 2007 XML', keepLoadFilter: true, macroEnabled: false, template: false }),
  F({ id: 'xlsm', kind: 'calc', extensions: ['xlsm'], family: 'ooxml', tier: 'secondary', support: 'native', labelKey: 'formats.xlsm', exportFilter: 'Calc MS Excel 2007 VBA XML', keepLoadFilter: true, macroEnabled: true, template: false }),
  F({ id: 'xltx', kind: 'calc', extensions: ['xltx'], family: 'ooxml', tier: 'secondary', support: 'native', labelKey: 'formats.xltx', exportFilter: 'Calc MS Excel 2007 XML Template', keepLoadFilter: true, macroEnabled: false, template: true }),
  F({ id: 'xltm', kind: 'calc', extensions: ['xltm'], family: 'ooxml', tier: 'secondary', support: 'import-only', labelKey: 'formats.xltm', macroEnabled: true, template: true, saveFallback: 'xlsm', knownLosses: ['compat.loss.macroTemplate'] }),
  F({ id: 'xlsb', kind: 'calc', extensions: ['xlsb'], family: 'binary', tier: 'secondary', support: 'import-only', labelKey: 'formats.xlsb', importFilter: 'Calc MS Excel 2007 Binary', macroEnabled: false, template: false, saveFallback: 'xlsx' }),
  F({ id: 'xls', kind: 'calc', extensions: ['xls'], family: 'binary', tier: 'secondary', support: 'native', labelKey: 'formats.xls', exportFilter: 'MS Excel 97', macroEnabled: false, template: false, knownLosses: ['compat.loss.legacyBinary'] }),
  F({ id: 'csv', kind: 'calc', extensions: ['csv'], family: 'text', tier: 'secondary', support: 'native', labelKey: 'formats.csv', importFilter: 'Text - txt - csv (StarCalc)', exportFilter: 'Text - txt - csv (StarCalc)', macroEnabled: false, template: false, knownLosses: ['compat.loss.csv'] }),
  F({ id: 'tsv', kind: 'calc', extensions: ['tsv', 'tab'], family: 'text', tier: 'secondary', support: 'native', labelKey: 'formats.tsv', importFilter: 'Text - txt - csv (StarCalc)', exportFilter: 'Text - txt - csv (StarCalc)', macroEnabled: false, template: false, knownLosses: ['compat.loss.csv'] }),
  F({ id: 'ods', kind: 'calc', extensions: ['ods'], family: 'odf', tier: 'secondary', support: 'native', labelKey: 'formats.ods', exportFilter: 'calc8', macroEnabled: false, template: false }),
  // ---------------------------------------------------------------- Presentations
  F({ id: 'pptx', kind: 'impress', extensions: ['pptx'], family: 'ooxml', tier: 'primary', support: 'native', labelKey: 'formats.pptx', exportFilter: 'Impress MS PowerPoint 2007 XML', keepLoadFilter: true, macroEnabled: false, template: false }),
  F({ id: 'pptm', kind: 'impress', extensions: ['pptm'], family: 'ooxml', tier: 'secondary', support: 'native', labelKey: 'formats.pptm', exportFilter: 'Impress MS PowerPoint 2007 XML VBA', keepLoadFilter: true, macroEnabled: true, template: false }),
  F({ id: 'ppsx', kind: 'impress', extensions: ['ppsx'], family: 'ooxml', tier: 'secondary', support: 'native', labelKey: 'formats.ppsx', exportFilter: 'Impress MS PowerPoint 2007 XML AutoPlay', editImportFilter: 'Impress MS PowerPoint 2007 XML', macroEnabled: false, template: false }),
  F({ id: 'ppsm', kind: 'impress', extensions: ['ppsm'], family: 'ooxml', tier: 'secondary', support: 'import-only', labelKey: 'formats.ppsm', editImportFilter: 'Impress MS PowerPoint 2007 XML', macroEnabled: true, template: false, saveFallback: 'pptm', knownLosses: ['compat.loss.macroTemplate'] }),
  F({ id: 'potx', kind: 'impress', extensions: ['potx'], family: 'ooxml', tier: 'secondary', support: 'native', labelKey: 'formats.potx', exportFilter: 'Impress MS PowerPoint 2007 XML Template', keepLoadFilter: true, macroEnabled: false, template: true }),
  F({ id: 'potm', kind: 'impress', extensions: ['potm'], family: 'ooxml', tier: 'secondary', support: 'import-only', labelKey: 'formats.potm', macroEnabled: true, template: true, saveFallback: 'pptm', knownLosses: ['compat.loss.macroTemplate'] }),
  F({ id: 'ppt', kind: 'impress', extensions: ['ppt'], family: 'binary', tier: 'secondary', support: 'native', labelKey: 'formats.ppt', exportFilter: 'MS PowerPoint 97', macroEnabled: false, template: false, knownLosses: ['compat.loss.legacyBinary'] }),
  F({ id: 'pps', kind: 'impress', extensions: ['pps'], family: 'binary', tier: 'secondary', support: 'native', labelKey: 'formats.pps', exportFilter: 'MS PowerPoint 97 AutoPlay', editImportFilter: 'MS PowerPoint 97', macroEnabled: false, template: false, knownLosses: ['compat.loss.legacyBinary'] }),
  F({ id: 'odp', kind: 'impress', extensions: ['odp'], family: 'odf', tier: 'secondary', support: 'native', labelKey: 'formats.odp', exportFilter: 'impress8', macroEnabled: false, template: false }),
  // ---------------------------------------------------------------- PDF
  F({ id: 'pdf', kind: 'pdf', extensions: ['pdf'], family: 'pdf', tier: 'primary', support: 'pdf', labelKey: 'formats.pdf', macroEnabled: false, template: false }),
];

const BY_ID = new Map<FormatId, FormatInfo>(FORMATS.map((f) => [f.id, f]));
const BY_EXT = new Map<string, FormatInfo>();
for (const f of FORMATS) for (const e of f.extensions) BY_EXT.set(e, f);

export function getFormat(id: FormatId): FormatInfo {
  const f = BY_ID.get(id);
  if (!f) throw new Error(`Unknown format ${id}`);
  return f;
}

/** Looks up a format by file name or extension (case-insensitive). Returns undefined for unsupported files. */
export function formatFromPath(pathOrExt: string): FormatInfo | undefined {
  const m = /\.?([^.\\/]+)$/.exec(pathOrExt.trim());
  const ext = (m?.[1] ?? '').toLowerCase();
  return BY_EXT.get(ext);
}

export function formatsForKind(kind: ModuleKind): FormatInfo[] {
  return FORMATS.filter((f) => f.kind === kind);
}

/** Default format for "Save" of a new document of the given kind. */
export const DEFAULT_SAVE_FORMAT: Record<ModuleKind, FormatId> = {
  writer: 'docx',
  calc: 'xlsx',
  impress: 'pptx',
  pdf: 'pdf',
};

/** LibreOffice PDF export filter per engine document kind. */
export const PDF_EXPORT_FILTER: Record<OfficeKind, string> = {
  writer: 'writer_pdf_Export',
  calc: 'calc_pdf_Export',
  impress: 'impress_pdf_Export',
};

/** Windows LCID used in CSV import options (token 6). */
export const CSV_LCID: Record<string, number> = { 'tr-TR': 1055, 'en-US': 1033, 'en-GB': 2057 };

export interface CsvOptions {
  /** Field separator: one character (see isCsvSeparatorChar). */
  separator: string;
  quote?: '"' | "'";
  /** LibreOffice charset id: 76 = UTF-8, 36 = Windows-1254 (Turkish), 1 = Windows-1252. */
  charset?: number;
  firstLine?: number;
  locale?: string;
  detectSpecialNumbers?: boolean;
  evaluateFormulas?: boolean;
  /** Export only: write a UTF-8 BOM (Excel needs it to detect UTF-8). */
  bom?: boolean;
}

/**
 * A usable field separator: exactly one character that is not a quote (the text delimiter), a line break or another
 * control character; tab is fine. The CSV filter takes it as a character code, so any such character works.
 */
export function isCsvSeparatorChar(v: unknown): v is string {
  if (typeof v !== 'string' || [...v].length !== 1 || v === '"' || v === "'") return false;
  const code = v.codePointAt(0) ?? 0;
  return code === 9 || (code >= 32 && code !== 127 && !(code >= 0x80 && code < 0xa0));
}

const sepCode = (separator: string): number => separator.codePointAt(0) ?? 59;

/** Builds the `Text - txt - csv (StarCalc)` import FilterOptions string (token order per LibreOffice help). */
export function csvImportOptions(o: CsvOptions): string {
  const lcid = CSV_LCID[o.locale ?? 'en-US'] ?? 0;
  const tokens = [
    String(sepCode(o.separator)),
    String((o.quote ?? '"').charCodeAt(0)),
    String(o.charset ?? 76),
    String(o.firstLine ?? 1),
    '',
    String(lcid),
    'false',
    String(o.detectSpecialNumbers ?? true),
    'true',
    'false',
    'false',
    '0',
    String(o.evaluateFormulas ?? false),
    'false',
    'true',
  ];
  return tokens.join(',');
}

/** Builds the `Text - txt - csv (StarCalc)` export FilterOptions string. */
export function csvExportOptions(o: CsvOptions): string {
  const tokens = [
    String(sepCode(o.separator)),
    String((o.quote ?? '"').charCodeAt(0)),
    String(o.charset ?? 76),
    '1',
    '',
    '0',
    'false',
    'true',
    'true',
    'false',
    'false',
    '0',
    'false',
    String(o.bom ?? false),
  ];
  return tokens.join(',');
}

/** Regional defaults: Turkish Excel uses `;` because `,` is the decimal separator. */
export function defaultCsvSeparator(locale: string): ';' | ',' {
  return locale.startsWith('tr') || locale.startsWith('de') || locale.startsWith('fr') ? ';' : ',';
}
