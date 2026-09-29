import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/api/app';
import type { CompatReport, DocumentDescriptor } from '@shared/api/documents';
import { getFormat } from '@shared/formats';
import { makeFinding } from '../../../src/main/compat/findings';
import { assessSaveRisk, chooseFilter, decideSaveTarget, isVbaPassthroughFormat, reloadParams, resolveSavePath, supportsEncryption } from '../../../src/main/documents/savePlan';
import { buildCsvImportOptions, guessSeparator, isCsvSeparator, isValidUtf8, isValidUtf8File, previewLines, readTextSample, textFilterOptions } from '../../../src/main/documents/textImport';
import { makeTempDir, removeDir } from './helpers/tmp';

const desc = (patch: Partial<DocumentDescriptor>): DocumentDescriptor => ({
  docId: 'd1',
  kind: 'writer',
  title: 'Rapor.docx',
  path: 'C:\\Belgeler\\Rapor.docx',
  format: 'docx',
  readOnly: false,
  modified: true,
  compat: null,
  state: 'ready',
  ...patch,
});

const report = (...ids: Parameters<typeof makeFinding>[0][]): CompatReport => ({
  format: 'docx',
  findings: ids.map((id) => makeFinding(id, 'writer')),
  analyzedAt: '2026-09-29T00:00:00.000Z',
});

describe('decideSaveTarget', () => {
  it('saves in place when the document has a writable path', () => {
    expect(decideSaveTarget(desc({}), {})).toMatchObject({ needsDialog: false, format: { id: 'docx' } });
  });

  it('asks for a path for new, read-only, Save As and format changes', () => {
    expect(decideSaveTarget(desc({ path: null, format: null }), {}).needsDialog).toBe(true);
    expect(decideSaveTarget(desc({ path: null, format: null, kind: 'calc' }), {}).format.id).toBe('xlsx');
    expect(decideSaveTarget(desc({ readOnly: true }), {}).needsDialog).toBe(true);
    expect(decideSaveTarget(desc({}), { saveAs: true }).needsDialog).toBe(true);
    expect(decideSaveTarget(desc({}), { format: 'odt' })).toMatchObject({ needsDialog: true, format: { id: 'odt' } });
  });

  it('redirects import-only formats to their fallback with a dialog', () => {
    expect(decideSaveTarget(desc({ kind: 'calc', format: 'xlsb', path: 'C:\\a.xlsb' }), {})).toMatchObject({ needsDialog: true, format: { id: 'xlsx' } });
    expect(decideSaveTarget(desc({ format: 'dotm', path: 'C:\\a.dotm' }), {})).toMatchObject({ needsDialog: true, format: { id: 'docm' } });
  });

  it('refuses a format of another module', () => {
    expect(() => decideSaveTarget(desc({}), { format: 'xlsx' })).toThrow('errors.save.wrongKind');
  });
});

describe('resolveSavePath', () => {
  it('derives the format from the chosen extension', () => {
    expect(resolveSavePath('C:\\x\\a.odt', 'writer', getFormat('docx')).format.id).toBe('odt');
    expect(resolveSavePath('C:\\x\\a', 'writer', getFormat('docx')).path).toBe('C:\\x\\a.docx');
    expect(resolveSavePath('C:\\x\\a.v2', 'writer', getFormat('docx')).path).toBe('C:\\x\\a.v2.docx');
    expect(() => resolveSavePath('C:\\x\\a.xlsb', 'calc', getFormat('xlsx'))).toThrow('errors.save.formatNotWritable');
    expect(() => resolveSavePath('C:\\x\\a.pdf', 'writer', getFormat('docx'))).toThrow('errors.save.usePdfExport');
    expect(() => resolveSavePath('C:\\x\\a.xlsx', 'writer', getFormat('docx'))).toThrow('errors.save.wrongKind');
  });
});

describe('chooseFilter', () => {
  const base = { locale: 'tr-TR', csv: DEFAULT_SETTINGS.csv };

  it('reuses the load filter for the same format (keeps the OOXML flavour)', () => {
    expect(chooseFilter({ ...base, target: getFormat('docx'), loadFilter: 'Office Open XML Text', filterFormat: 'docx' }).filter).toBe('Office Open XML Text');
    expect(chooseFilter({ ...base, target: getFormat('docx'), loadFilter: 'MS Word 97', filterFormat: 'doc' }).filter).toBe('MS Word 2007 XML');
    // PPSX is loaded with the non-AutoPlay filter for editing; saving must use the AutoPlay filter.
    expect(chooseFilter({ ...base, target: getFormat('ppsx'), loadFilter: 'Impress MS PowerPoint 2007 XML', filterFormat: 'ppsx' }).filter).toBe('Impress MS PowerPoint 2007 XML AutoPlay');
  });

  it('builds CSV/TSV export options from settings, the import separator and the locale', () => {
    expect(chooseFilter({ ...base, target: getFormat('csv') }).filterOptions).toMatch(/^59,34,76,1,/);
    expect(chooseFilter({ ...base, locale: 'en-US', target: getFormat('csv') }).filterOptions).toMatch(/^44,34,76,/);
    expect(chooseFilter({ ...base, target: getFormat('csv'), csvSeparator: '\t' }).filterOptions).toMatch(/^9,/);
    expect(chooseFilter({ ...base, target: getFormat('tsv') }).filterOptions).toMatch(/^9,34,76,.*,true$/);
    expect(chooseFilter({ ...base, csv: { ...base.csv, exportSeparator: ',', exportBom: false }, target: getFormat('csv') }).filterOptions).toMatch(/^44,.*,false$/);
  });

  it('expands text export options', () => {
    expect(chooseFilter({ ...base, target: getFormat('txt') }).filterOptions).toBe('UTF8,CRLF,,tr-TR,true,false');
  });

  it('refuses import-only targets', () => {
    expect(() => chooseFilter({ ...base, target: getFormat('xlsb') })).toThrow('errors.save.formatNotWritable');
  });

  it('derives how a file it wrote is loaded again (crash restore before the next snapshot)', () => {
    const csv = chooseFilter({ ...base, target: getFormat('csv'), csvSeparator: '\t' });
    expect(reloadParams(getFormat('csv'), csv, 'tr-TR')).toEqual({ filter: 'Text - txt - csv (StarCalc)', filterOptions: '9,34,76,1,,1055,false,true,true,false,false,0,false,false,true' });
    expect(reloadParams(getFormat('xlsx'), chooseFilter({ ...base, target: getFormat('xlsx') }), 'tr-TR')).toEqual({});
    expect(reloadParams(getFormat('txt'), chooseFilter({ ...base, target: getFormat('txt') }), 'en-US')).toEqual({ filter: 'Text (encoded)', filterOptions: 'UTF8,CRLF,,en-US' });
    expect(reloadParams(getFormat('ppsx'), chooseFilter({ ...base, target: getFormat('ppsx') }), 'tr-TR')).toEqual({ filter: 'Impress MS PowerPoint 2007 XML' });
  });
});

describe('assessSaveRisk', () => {
  // vbaPassthrough defaults to what the service sets for a file loaded directly (true for DOCM/PPTM ...).
  const risk = (source: string, target: string, r: CompatReport | null, extra: Partial<{ hasMacros: boolean; encrypted: boolean; kind: 'writer' | 'calc' | 'impress'; vbaPassthrough: boolean }> = {}) =>
    assessSaveRisk({
      kind: extra.kind ?? 'writer',
      report: r,
      source: getFormat(source as never),
      target: getFormat(target as never),
      hasMacros: extra.hasMacros ?? false,
      encrypted: extra.encrypted ?? false,
      vbaPassthrough: extra.vbaPassthrough ?? isVbaPassthroughFormat(getFormat(source as never)),
    }).map((f) => f.messageKey);

  it('is empty for a plain round trip', () => {
    expect(risk('docx', 'docx', report())).toEqual([]);
    expect(risk('docx', 'docx', report('charts', 'trackedChanges', 'missingFonts'))).toEqual([]);
  });

  it('flags macro loss when a macro-enabled document goes to a macro-free format', () => {
    expect(risk('docm', 'docx', report('macros'))).toEqual(['compat.loss.macros']);
    expect(risk('docm', 'docm', report('macros'))).toEqual([]);
    expect(risk('odt', 'odt', null, { hasMacros: true })).toEqual([]);
    expect(risk('odt', 'docx', null, { hasMacros: true })).toEqual(['compat.loss.macros']);
  });

  it('DOCM/PPTM keep macros only while the model still has the VBA project of the file it was loaded from', () => {
    // Loaded from the DOCM itself: LibreOffice copies the VBA project back.
    expect(risk('docm', 'docm', report('macros'))).toEqual([]);
    // Restored from an ODF recovery snapshot: the model has no VBA project any more.
    expect(risk('docm', 'docm', report('macros'), { vbaPassthrough: false })).toEqual(['compat.loss.macros']);
    expect(risk('pptm', 'pptm', report('macros'), { kind: 'impress', vbaPassthrough: false })).toEqual(['compat.loss.macros']);
    // Basic of an ODT/ODP (or a DOC's macros) never becomes a VBA project of a DOCM/PPTM.
    expect(risk('odt', 'docm', null, { hasMacros: true })).toEqual(['compat.loss.macros']);
    expect(risk('odp', 'pptm', null, { kind: 'impress', hasMacros: true })).toEqual(['compat.loss.macros']);
    expect(risk('doc', 'docm', null, { hasMacros: true })).toEqual(['compat.loss.macros']);
    // XLSM regenerates its VBA project from the Basic modules.
    expect(risk('ods', 'xlsm', null, { kind: 'calc', hasMacros: true })).toEqual([]);
    expect(risk('xlsm', 'xlsm', report('macros'), { kind: 'calc', vbaPassthrough: false })).toEqual([]);
    expect(['docm', 'dotm', 'pptm', 'ppsm', 'potm'].every((f) => isVbaPassthroughFormat(getFormat(f as never)))).toBe(true);
    expect(['docx', 'xlsm', 'odt', 'doc'].some((f) => isVbaPassthroughFormat(getFormat(f as never)))).toBe(false);
  });

  it('flags content the engine drops on any save, most severe first', () => {
    const r: CompatReport = { format: 'xlsx', analyzedAt: '', findings: [makeFinding('pivotTables', 'calc'), makeFinding('slicers', 'calc'), makeFinding('threadedComments', 'calc')] };
    expect(risk('xlsx', 'xlsx', r, { kind: 'calc' })).toEqual(['compat.finding.slicers', 'compat.finding.threadedComments']);
  });

  it('adds the target format known losses (legacy, CSV, text)', () => {
    expect(risk('docx', 'doc', report())).toEqual(['compat.loss.legacyBinary']);
    expect(risk('xlsx', 'csv', report(), { kind: 'calc' })).toEqual(['compat.loss.csv']);
    expect(risk('docx', 'txt', report('contentControls'))).toEqual(['compat.finding.contentControls', 'compat.loss.plainText']);
  });

  it('handles password protection by target support', () => {
    expect(risk('xlsx', 'xlsx', report(), { kind: 'calc', encrypted: true })).toEqual([]);
    expect(risk('xlsx', 'csv', report(), { kind: 'calc', encrypted: true })).toEqual(['compat.loss.encryption', 'compat.loss.csv']);
    expect(risk('doc', 'doc', report(), { encrypted: true })).toEqual(['compat.loss.encryptionWeak', 'compat.loss.legacyBinary']);
    expect(supportsEncryption(getFormat('dotx'))).toBe(false);
    expect(supportsEncryption(getFormat('ppt'))).toBe(false);
    expect(supportsEncryption(getFormat('odp'))).toBe(true);
  });
});

describe('text import', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await makeTempDir('text');
  });
  afterAll(async () => {
    await removeDir(dir);
  });

  it('guesses separators, preferring ; over the Turkish decimal comma', () => {
    expect(guessSeparator(['Ad;Tutar', 'Elma;1,5', 'Armut;2,25'])).toBe(';');
    expect(guessSeparator(['name,amount', 'apple,1.5', 'pear,2.25'])).toBe(',');
    expect(guessSeparator(['a\tb\tc', '1\t2\t3'])).toBe('\t');
    expect(guessSeparator(['"a;b",c', '"d;e",f'])).toBe(',');
    expect(guessSeparator([])).toBeUndefined();
  });

  it('validates UTF-8 while tolerating a cut multi-byte sequence', () => {
    const utf8 = Buffer.from('Şişli İğne ğüşiöç', 'utf8');
    expect(isValidUtf8(utf8)).toBe(true);
    expect(isValidUtf8(utf8.subarray(0, utf8.length - 1))).toBe(true);
    expect(isValidUtf8(Buffer.from([0x41, 0xde, 0x41]))).toBe(false);
  });

  it('decodes legacy Turkish text (Windows-1254) for the preview', async () => {
    const path = join(dir, 'eski.csv');
    // "Şehir;Nüfus" in Windows-1254: Ş = 0xDE, ü = 0xFC
    await writeFile(path, Buffer.from([0xde, 0x65, 0x68, 0x69, 0x72, 0x3b, 0x4e, 0xfc, 0x66, 0x75, 0x73, 0x0d, 0x0a]));
    const sample = await readTextSample(path, 'tr-TR');
    expect(sample.encoding).toBe('legacy');
    expect(previewLines(sample.text)).toEqual(['Şehir;Nüfus']);
    expect(buildCsvImportOptions(';', 'tr-TR', sample.encoding)).toBe('59,34,36,1,,1055,false,true,true,false,false,0,false,false,true');
  });

  it('accepts any one-character separator from the prompt, never a quote or a control character', () => {
    // "Other" in the import prompt: the preview split by it, the import used to fall back to the default.
    expect(buildCsvImportOptions('#', 'tr-TR', 'utf8').split(',')[0]).toBe('35');
    expect(buildCsvImportOptions(':', 'en-US', 'utf8').split(',')[0]).toBe('58');
    expect(buildCsvImportOptions('\t', 'tr-TR', 'utf8').split(',')[0]).toBe('9');
    for (const ok of [';', ',', '\t', ' ', '|', '#', ':', '~', '§']) expect(isCsvSeparator(ok), JSON.stringify(ok)).toBe(true);
    for (const bad of ['"', "'", '\n', '\r', '\u0000', '\u0085', '', ';;', 7, null]) expect(isCsvSeparator(bad), JSON.stringify(bad)).toBe(false);
  });

  it('decodes legacy text with the preview locale, whatever number format the prompt chooses', () => {
    // The preview is decoded with the UI locale; choosing English numbers must not switch Turkish text to Windows-1252.
    expect(buildCsvImportOptions(';', 'en-US', 'legacy', 'tr-TR').split(',').slice(2, 6)).toEqual(['36', '1', '', '1033']);
    expect(buildCsvImportOptions(';', 'tr-TR', 'legacy', 'en-US').split(',')[2]).toBe('1');
  });

  it('decides the encoding over the whole file: a legacy CSV with a long ASCII head is not UTF-8', async () => {
    const path = join(dir, 'musteri.csv');
    const rows: string[] = [];
    for (let i = 0, size = 0; size < 70_000; i++) {
      const row = `${i};${i * 3};OK\r\n`;
      rows.push(row);
      size += row.length;
    }
    // "9999;1;Şişli" in Windows-1254 (Ş = 0xDE, ş = 0xFE), after the first 64 KiB.
    const tail = Buffer.from([...Buffer.from('9999;1;', 'latin1'), 0xde, 0x69, 0xfe, 0x6c, 0x69, 0x0d, 0x0a]);
    await writeFile(path, Buffer.concat([Buffer.from(rows.join(''), 'latin1'), tail]));
    const sample = await readTextSample(path, 'tr-TR');
    expect(sample.encoding).toBe('legacy');
    expect(buildCsvImportOptions(';', 'tr-TR', sample.encoding).split(',')[2]).toBe('36');
    // The preview still comes from the start of the file only.
    expect(previewLines(sample.text)[0]).toBe('0;0;OK');
    expect(sample.text.length).toBeLessThanOrEqual(64 * 1024);

    // Valid UTF-8 after 64 KiB (a character across a read-chunk boundary) stays UTF-8; so does a cut last one.
    const utf8Path = join(dir, 'utf8.csv');
    await writeFile(utf8Path, Buffer.concat([Buffer.from(rows.join(''), 'latin1'), Buffer.from('9999;1;Şişli\r\n', 'utf8'), Buffer.from([0xc5])]));
    expect((await readTextSample(utf8Path, 'tr-TR')).encoding).toBe('utf8');
    expect(await isValidUtf8File(utf8Path, 0, 7)).toBe(true);
    expect(await isValidUtf8File(path, 0, 7)).toBe(false);
  });

  it('detects BOMs', async () => {
    const path = join(dir, 'bom.txt');
    await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('merhaba', 'utf8')]));
    expect(await readTextSample(path, 'tr-TR')).toEqual({ text: 'merhaba', encoding: 'utf8' });
  });

  it('expands Text (encoded) options with locale and charset', () => {
    expect(textFilterOptions('UTF8,CRLF,,{bcp47}', 'tr-TR')).toBe('UTF8,CRLF,,tr-TR');
    expect(textFilterOptions('UTF8,CRLF,,{bcp47}', 'tr-TR', 'legacy')).toBe('MS_1254,CRLF,,tr-TR');
    expect(textFilterOptions('UTF8,CRLF,,{bcp47}', 'en-US', 'utf16le')).toBe('UNICODE,CRLF,,en-US');
  });
});
