/**
 * Save planning (pure functions): target format, engine filter + options, and the loss-risk
 * assessment shown in the `saveRisk` prompt.
 */
import { basename, dirname, join } from 'node:path';
import type { Settings } from '@shared/api/app';
import type { CompatFinding, CompatReport, DocumentDescriptor, SaveOptions } from '@shared/api/documents';
import {
  csvExportOptions,
  DEFAULT_SAVE_FORMAT,
  defaultCsvSeparator,
  formatFromPath,
  getFormat,
  type FormatId,
  type FormatInfo,
} from '@shared/formats';
import type { OfficeKind } from '@shared/modules';
import { FINDING_RULES, makeFinding } from '../compat/findings';
import { sanitizeFileName, withExtension } from '../files/fsUtil';
import { DocumentError } from './errors';
import type { LoadParams } from './record';
import type { CsvSeparator } from './textImport';
import { buildCsvImportOptions, textFilterOptions } from './textImport';

export const ODF_FORMAT: Record<OfficeKind, FormatId> = { writer: 'odt', calc: 'ods', impress: 'odp' };

export interface SaveTargetDecision {
  format: FormatInfo;
  /** The user must pick a path (new document, Save As, read-only source, format change ...). */
  needsDialog: boolean;
}

export function decideSaveTarget(desc: DocumentDescriptor, options: SaveOptions): SaveTargetDecision {
  const kind = desc.kind;
  if (kind === 'pdf') throw new DocumentError('errors.save.wrongKind');
  const current = desc.format ? getFormat(desc.format) : undefined;
  const requested = options.format ? getFormat(options.format) : undefined;
  if (requested && requested.kind !== kind) throw new DocumentError('errors.save.wrongKind');
  let format = requested ?? current ?? getFormat(DEFAULT_SAVE_FORMAT[kind]);
  let needsDialog = Boolean(options.saveAs) || !desc.path || desc.readOnly || (requested !== undefined && requested.id !== current?.id);
  if (format.support !== 'native') {
    // Import-only formats (XLSB, DOTM, XLTM, POTM, PPSM) must be saved as their fallback format.
    format = getFormat(format.saveFallback ?? DEFAULT_SAVE_FORMAT[kind]);
    needsDialog = true;
  }
  return { format, needsDialog };
}

/**
 * Format written for a path chosen in the dialog (or passed explicitly). Unknown extensions get the
 * intended format's extension appended.
 */
export function resolveSavePath(path: string, kind: OfficeKind, intended: FormatInfo): { path: string; format: FormatInfo } {
  const byExt = formatFromPath(path);
  if (!byExt || !/\.[^.\\/]+$/.test(basename(path))) return { path: `${path}.${intended.extensions[0]}`, format: intended };
  if (byExt.kind !== kind) {
    if (byExt.kind === 'pdf') throw new DocumentError('errors.save.usePdfExport');
    throw new DocumentError('errors.save.wrongKind');
  }
  if (byExt.support !== 'native') throw new DocumentError('errors.save.formatNotWritable');
  return { path, format: byExt };
}

/** Default path offered by Save As: the current file's folder and name with the target extension. */
export function defaultSavePath(desc: DocumentDescriptor, format: FormatInfo, fallbackDir: string): string {
  const ext = format.extensions[0] ?? format.id;
  if (desc.path) return withExtension(desc.path, ext);
  return join(fallbackDir, `${sanitizeFileName(desc.title)}.${ext}`);
}

export function defaultPdfPath(desc: DocumentDescriptor, fallbackDir: string): string {
  if (desc.path) return withExtension(desc.path, 'pdf');
  return join(fallbackDir, `${sanitizeFileName(desc.title)}.pdf`);
}

export interface FilterChoice {
  filter: string;
  filterOptions?: string;
  /** CSV/TSV: the field separator written. */
  separator?: CsvSeparator;
}

export interface FilterInput {
  target: FormatInfo;
  /** Filter the engine used to load the file, and the format it belongs to. */
  loadFilter?: string;
  filterFormat?: FormatId;
  locale: string;
  csv: Settings['csv'];
  /** Separator chosen when the CSV was imported. */
  csvSeparator?: CsvSeparator;
}

export function chooseFilter(input: FilterInput): FilterChoice {
  const { target } = input;
  let filter: string | undefined;
  // Same format as loaded: reuse the load filter to keep the ECMA-376 vs ISO 29500 flavour.
  if (target.keepLoadFilter && input.loadFilter && input.filterFormat === target.id) filter = input.loadFilter;
  filter ??= target.exportFilter;
  if (!filter) throw new DocumentError('errors.save.formatNotWritable');
  if (target.id === 'csv' || target.id === 'tsv') {
    const setting = input.csv.exportSeparator;
    const separator: CsvSeparator = target.id === 'tsv' ? '\t' : setting !== 'auto' ? setting : (input.csvSeparator ?? defaultCsvSeparator(input.locale));
    return { filter, filterOptions: csvExportOptions({ separator, bom: input.csv.exportBom }), separator };
  }
  if (target.exportFilterOptions) return { filter, filterOptions: textFilterOptions(target.exportFilterOptions, input.locale) };
  return { filter };
}

/**
 * How a file the save pipeline just wrote is loaded again (engine crash or restart before the next recovery
 * snapshot): the target format's import filter (none = type detection, e.g. CSV → XLSX) and, for text formats,
 * the options it was written with (always UTF-8; the separator used for CSV/TSV).
 */
export function reloadParams(target: FormatInfo, written: FilterChoice, locale: string): LoadParams {
  const filter = target.editImportFilter ?? target.importFilter;
  let filterOptions: string | undefined;
  if (target.id === 'csv' || target.id === 'tsv') filterOptions = buildCsvImportOptions(written.separator ?? (target.id === 'tsv' ? '\t' : defaultCsvSeparator(locale)), locale, 'utf8');
  else if (target.importFilterOptions) filterOptions = textFilterOptions(target.importFilterOptions, locale, 'utf8');
  return { ...(filter ? { filter } : {}), ...(filterOptions ? { filterOptions } : {}) };
}

/** Targets that can carry the document's password (template/VBA-less OOXML, ODF, DOC/XLS). */
export function supportsEncryption(target: FormatInfo): boolean {
  if (target.family === 'odf') return true;
  if (target.family === 'ooxml') return !target.template;
  if (target.family === 'binary') return target.id !== 'ppt' && target.id !== 'pps';
  return false;
}

export interface RiskInput {
  kind: OfficeKind;
  report: CompatReport | null;
  /** Format of the file the document came from (null for new documents). */
  source: FormatInfo | null;
  target: FormatInfo;
  /** The engine reported macros (covers ODF/legacy files the analyzer cannot see into). */
  hasMacros: boolean;
  encrypted: boolean;
  /** The model still carries the VBA project of the DOCM/PPTM it was loaded from (DocRecord.vbaPassthrough). */
  vbaPassthrough: boolean;
}

/**
 * Word/PowerPoint macro-enabled OOXML (DOCM, DOTM, PPTM, PPSM, POTM): LibreOffice keeps the VBA project of such a
 * file while it stays loaded and copies it back when saving DOCM/PPTM; it cannot generate one (from Basic, or
 * after the document went through an ODF recovery snapshot). Excel's XLSM export regenerates the project.
 */
export function isVbaPassthroughFormat(format: FormatInfo): boolean {
  return format.family === 'ooxml' && format.macroEnabled && (format.kind === 'writer' || format.kind === 'impress');
}

/** Findings that make saving to `target` lossy; empty = no prompt. */
export function assessSaveRisk(input: RiskInput): CompatFinding[] {
  const { kind, target } = input;
  const out: CompatFinding[] = [];
  const ctx = { kind, target };
  const macrosPresent = input.hasMacros || Boolean(input.report?.findings.some((f) => f.id === 'macros'));
  // ODF keeps Basic modules, legacy binaries keep their VBA storage when saved back to the same family; DOCM/PPTM
  // keep macros only while the model still has the VBA project of the macro-enabled file it was loaded from
  // (not after an ODF recovery snapshot, not for ODT/ODP Basic).
  const macrosKept = isVbaPassthroughFormat(target)
    ? input.vbaPassthrough
    : target.macroEnabled || (input.source !== null && input.source.family === target.family && (target.family === 'odf' || target.family === 'binary'));

  for (const f of input.report?.findings ?? []) {
    if (f.id === 'macros' || f.id === 'encryption') continue;
    // Content that is supported in general but lost in this target is at least a warning here.
    if (FINDING_RULES[f.id].atRisk(ctx)) out.push(f.severity === 'info' ? { ...f, severity: 'warning' } : f);
  }
  if (macrosPresent && !macrosKept) out.push(makeFinding('macros', kind, { severity: 'risk', messageKey: 'compat.loss.macros' }));
  if (input.encrypted) {
    if (!supportsEncryption(target)) out.push(makeFinding('encryption', kind, { severity: 'risk', messageKey: 'compat.loss.encryption' }));
    else if (target.family === 'binary') out.push(makeFinding('encryption', kind, { severity: 'warning', messageKey: 'compat.loss.encryptionWeak' }));
  }
  for (const key of target.knownLosses ?? []) {
    out.push({ id: key === 'compat.loss.macroTemplate' ? 'templateMacros' : 'legacyFormat', severity: 'warning', messageKey: key });
  }
  const seen = new Set<string>();
  const rank = { risk: 0, warning: 1, info: 2 } as const;
  return out
    .filter((f) => (seen.has(f.messageKey) ? false : (seen.add(f.messageKey), true)))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Identity of an accepted risk: the same target is not asked about twice in a session. */
export function riskKey(path: string, format: FormatInfo): string {
  return `${process.platform === 'win32' ? path.toLowerCase() : path}|${format.id}`;
}

export function folderOf(path: string | null, fallback: string): string {
  return path ? dirname(path) : fallback;
}
