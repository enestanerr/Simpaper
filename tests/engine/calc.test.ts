/**
 * Calc through the engine under a Turkish and an English profile (UI language + locale):
 *  - OOXML is recalculated on load: stale cached results and unknown functions never show through;
 *  - formulas in the API grammar (English names, `;` separators) and through the formula bar in the
 *    profile's own language (TOPLA/EĞER … in Turkish), with their expected values and displays;
 *  - CSV import/export with the options of src/shared/formats.ts (exact bytes);
 *  - a performance smoke test with a 20 000-row sheet (timings are reported, not asserted).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { csvExportOptions, csvImportOptions } from '@shared/formats';
import type { CellInfo } from '@shared/engine-protocol';
import type { EngineInstance, EngineManager } from '../../src/main/engine/types';
import { engineAvailable, fileUrl, makeManager, outDir, printTimings, timed } from './helpers';

const CSV_FILTER = 'Text - txt - csv (StarCalc)';
const XLSX_FILTER = 'Calc MS Excel 2007 XML';
const DATE_2026_09_29 = 46294; // spreadsheet serial number

/** Workbook written by an independent writer (exceljs) with deliberately wrong cached results. */
async function writeFixture(path: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const data = wb.addWorksheet('Veri');
  data.addRow(['Ad', 'Tutar', 'Tarih']);
  data.addRow(['Çağrı', 10, new Date(Date.UTC(2026, 8, 29))]);
  data.addRow(['İşçi', 20.5, new Date(Date.UTC(2026, 0, 1))]);
  data.addRow(['Öykü', 30, new Date(Date.UTC(2025, 11, 31))]);
  const sheet = wb.addWorksheet('Özet');
  const stale: Array<[string, string, number | string]> = [
    ['A1', 'SUM(Veri!B2:B4)', 999],
    ['A2', 'FOOBAR(1)', 42],
    ['A3', '1+1', 5],
    ['A4', 'AVERAGE(Veri!B2:B4)', 0],
    ['A5', 'VLOOKUP("İşçi",Veri!A2:B4,2,FALSE)', 0],
    ['A6', 'IF(Veri!B3>20,"büyük","küçük")', 'eski'],
    ['A7', 'TEXT(Veri!C2,"DD.MM.YYYY")', 'eski'],
    ['A8', 'DATE(2026,9,29)', 0],
    ['A9', 'Veri!$B$2*Veri!B3', 0],
  ];
  for (const [address, formula, result] of stale) sheet.getCell(address).value = { formula, result };
  await wb.xlsx.writeFile(path);
}

interface Locale {
  lang: 'tr' | 'en';
  locale: string;
  /** Number display of 60.5 etc. */
  decimal: ',' | '.';
  /** The formula bar grammar of this profile. */
  typed: { sum: string; ifElse: string; number: string; date: string };
  local: { sum: string; average: string; ifElse: string; vlookup: string; date: string; text: string };
  csv: { separator: ';' | ','; bom: boolean };
}

const LOCALES: Locale[] = [
  {
    lang: 'tr',
    locale: 'tr-TR',
    decimal: ',',
    typed: { sum: '=TOPLA($Veri.B2:B4)', ifElse: '=EĞER($Veri.B3>20;"büyük";"küçük")', number: '1,5', date: '29.09.2026' },
    local: {
      sum: '=TOPLA(B1:B3)',
      average: '=ORTALAMA(B1:B3)',
      ifElse: '=EĞER(B1>5;"büyük";"küçük")',
      vlookup: '=DÜŞEYARA(2;$B$1:$C$3;2;0)',
      date: '=TARİH(2026;9;29)',
      text: '=METNEÇEVİR(B3;"0.00")',
    },
    csv: { separator: ';', bom: true },
  },
  {
    lang: 'en',
    locale: 'en-US',
    decimal: '.',
    typed: { sum: '=SUM($Veri.B2:B4)', ifElse: '=IF($Veri.B3>20,"büyük","küçük")', number: '1.5', date: '9/29/2026' },
    local: {
      sum: '=SUM(B1:B3)',
      average: '=AVERAGE(B1:B3)',
      ifElse: '=IF(B1>5,"büyük","küçük")',
      vlookup: '=VLOOKUP(2,$B$1:$C$3,2,0)',
      date: '=DATE(2026,9,29)',
      text: '=TEXT(B3,"0.00")',
    },
    csv: { separator: ',', bom: false },
  },
];

const num = (value: number, decimal: ',' | '.') => String(value).replace('.', decimal);

describe.skipIf(!engineAvailable)('Calc through the engine (tr and en profiles)', () => {
  const managers = new Map<string, EngineManager>();
  let dir: string;
  let fixture: string;

  beforeAll(async () => {
    dir = outDir('calc');
    fixture = join(dir, 'eski-sonuclar.xlsx');
    await writeFixture(fixture);
    for (const l of LOCALES) managers.set(l.lang, makeManager(`calc-${l.lang}`, { uiLanguage: l.lang, documentLocale: l.locale }));
  });

  afterAll(async () => {
    await Promise.allSettled([...managers.values()].map((m) => m.dispose()));
    printTimings('Calc timings');
  });

  const instance = (l: Locale): Promise<EngineInstance> => managers.get(l.lang)!.acquireDocumentInstance(`calc-${l.lang}`);
  const cell = (i: EngineInstance, docId: string, address: string, sheet?: string): Promise<CellInfo> =>
    i.call('calc.getCell', { docId, address, ...(sheet ? { sheet } : {}) });

  for (const l of LOCALES) {
    describe(`profile ${l.lang} (${l.locale})`, () => {
      it('recalculates OOXML on load: no stale cached value, unknown functions are errors', async () => {
        const i = await instance(l);
        const docId = `stale-${l.lang}`;
        const loaded = await i.call('doc.load', { docId, url: fileUrl(fixture), view: { mode: 'hidden' } });
        expect(loaded.sheetNames).toEqual(['Veri', 'Özet']);
        const expected: Record<string, number | string> = { A1: 60.5, A3: 2, A5: 20.5, A6: 'büyük', A7: '29.09.2026', A8: DATE_2026_09_29, A9: 205 };
        for (const [address, value] of Object.entries(expected)) {
          expect(await cell(i, docId, address, 'Özet'), address).toMatchObject({ type: 'formula', value });
        }
        expect((await cell(i, docId, 'A4', 'Özet')).value).toBeCloseTo(20.1666666667, 9);
        // The unknown function: an error, never the cached 42.
        const unknown = await cell(i, docId, 'A2', 'Özet');
        expect(unknown).toMatchObject({ type: 'formula', value: null, error: '#NAME?' });
        expect(unknown.display).toBe(l.lang === 'tr' ? '#AD?' : '#NAME?');
        // Cross-sheet references in the API grammar.
        expect((await cell(i, docId, 'A1', 'Özet')).formula).toBe('=SUM($Veri.B2:B4)');
        expect((await cell(i, docId, 'A9', 'Özet')).formula).toBe('=$Veri.$B$2*$Veri.B3');
        await i.call('doc.close', { docId });
      });

      it('evaluates SUM, AVERAGE, IF, VLOOKUP, DATE, TEXT and absolute references', async () => {
        const i = await instance(l);
        const docId = `f-${l.lang}`;
        await i.call('doc.new', { docId, kind: 'calc', view: { mode: 'hidden' } });
        const set = (address: string, v: { value?: number | string; formula?: string }) => i.call('calc.setCell', { docId, address, ...v });
        await set('B1', { value: 2 });
        await set('B2', { value: 3.5 });
        await set('B3', { value: 10 });
        await set('C1', { value: 'iki' });
        await set('C2', { value: 'üç buçuk' });
        await set('C3', { value: 'on' });
        const cases: Array<{ address: string; formula: string; value: number | string; display: string; local: string }> = [
          { address: 'D1', formula: '=SUM(B1:B3)', value: 15.5, display: num(15.5, l.decimal), local: l.local.sum },
          { address: 'D2', formula: '=AVERAGE(B1:B3)', value: 15.5 / 3, display: '', local: l.local.average },
          { address: 'D3', formula: '=IF(B1>5;"büyük";"küçük")', value: 'küçük', display: 'küçük', local: l.local.ifElse },
          { address: 'D4', formula: '=VLOOKUP(2;$B$1:$C$3;2;0)', value: 'iki', display: 'iki', local: l.local.vlookup },
          { address: 'D5', formula: '=DATE(2026;9;29)', value: DATE_2026_09_29, display: String(DATE_2026_09_29), local: l.local.date },
          // TEXT(10;"0.00") is "10,00" in Turkish and "10.00" in English.
          { address: 'D6', formula: '=TEXT(B3;"0.00")', value: `10${l.decimal}00`, display: `10${l.decimal}00`, local: l.local.text },
          { address: 'D7', formula: '=$B$1*B2', value: 7, display: '7', local: '=$B$1*B2' },
        ];
        for (const c of cases) await set(c.address, { formula: c.formula });
        for (const c of cases) {
          const info = await cell(i, docId, c.address);
          expect(info.formula, c.address).toBe(c.formula);
          expect(info.localFormula, c.address).toBe(c.local);
          if (typeof c.value === 'number') expect(info.value as number, c.address).toBeCloseTo(c.value, 10);
          else expect(info.value, c.address).toBe(c.value);
          if (c.display) expect(info.display, c.address).toBe(c.display);
        }
        // Relative vs absolute: after a change in B1 both recalculate.
        await set('B1', { value: 4 });
        expect((await cell(i, docId, 'D7')).value).toBe(14);
        expect((await cell(i, docId, 'D1')).value).toBe(17.5);
        await i.call('doc.close', { docId });
      });

      it('parses formula-bar input in the profile language (functions, decimals, dates)', async () => {
        const i = await instance(l);
        const docId = `typed-${l.lang}`;
        await i.call('doc.load', { docId, url: fileUrl(fixture), view: { mode: 'hidden' } });
        const type = async (reference: string, content: string) => {
          await i.call('calc.gotoCell', { docId, reference });
          await i.call('calc.setActiveCellContent', { docId, content });
          return cell(i, docId, reference.split('.').pop()!, 'Özet');
        };
        expect(await type('$Özet.C1', l.typed.sum)).toMatchObject({ type: 'formula', formula: '=SUM($Veri.B2:B4)', localFormula: l.typed.sum, value: 60.5, display: num(60.5, l.decimal) });
        expect(await type('$Özet.C2', l.typed.ifElse)).toMatchObject({ type: 'formula', value: 'büyük' });
        expect(await type('$Özet.C3', l.typed.number)).toMatchObject({ type: 'value', value: 1.5, display: l.typed.number });
        expect(await type('$Özet.C4', l.typed.date)).toMatchObject({ type: 'value', value: DATE_2026_09_29 });
        // The other language's number format is text here, not a number.
        expect((await type('$Özet.C5', l.lang === 'tr' ? '1.5' : '1,5')).type).not.toBe('formula');
        expect((await type('$Özet.C6', l.lang === 'tr' ? '9/29/2026' : '29.09.2026')).type).toBe('text');
        await i.call('doc.close', { docId });
      });

      it('imports and exports CSV with the regional options (exact bytes)', async () => {
        const i = await instance(l);
        // Import: separator, decimal and date format of the region; UTF-8 with BOM for Turkish.
        const source =
          l.lang === 'tr'
            ? '﻿Ad;Tutar;Tarih\r\nÇağrı;1.234,5;29.09.2026\r\nİşçi;-0,25;01.01.2026\r\n'
            : 'Ad,Tutar,Tarih\r\nÇağrı,"1,234.5",09/29/2026\r\nİşçi,-0.25,01/01/2026\r\n';
        const input = join(dir, `giris-${l.lang}.csv`);
        writeFileSync(input, source, 'utf8');
        const docId = `csv-${l.lang}`;
        const loaded = await i.call('doc.load', {
          docId,
          url: fileUrl(input),
          filter: CSV_FILTER,
          filterOptions: csvImportOptions({ separator: l.csv.separator, locale: l.locale }),
          view: { mode: 'hidden' },
        });
        expect(loaded.kind).toBe('calc');
        expect(await cell(i, docId, 'A1')).toMatchObject({ type: 'text', value: 'Ad' }); // BOM consumed
        expect(await cell(i, docId, 'A2')).toMatchObject({ type: 'text', value: 'Çağrı' });
        expect(await cell(i, docId, 'B2')).toMatchObject({ type: 'value', value: 1234.5 });
        expect(await cell(i, docId, 'B3')).toMatchObject({ type: 'value', value: -0.25 });
        expect(await cell(i, docId, 'C2')).toMatchObject({ type: 'value', value: DATE_2026_09_29 });
        await i.call('doc.close', { docId });

        // Export from a sheet built through the API: values as shown in the region, text quoted only when needed.
        const out = `out-${l.lang}`;
        await i.call('doc.new', { docId: out, kind: 'calc', view: { mode: 'hidden' } });
        const rows: Array<[string, number | string]> = [['Ad', 'Tutar'], ['Çağrı', 1234.5], ['İşçi', -0.25], ['Metin; noktalı "virgül"', 0]];
        for (const [r, [a, b]] of rows.entries()) {
          await i.call('calc.setCell', { docId: out, address: `A${r + 1}`, value: a });
          await i.call('calc.setCell', { docId: out, address: `B${r + 1}`, value: b });
        }
        const target = join(dir, `cikti-${l.lang}.csv`);
        await i.call('doc.store', { docId: out, url: fileUrl(target), filter: CSV_FILTER, filterOptions: csvExportOptions(l.csv) });
        const expected =
          l.lang === 'tr'
            ? '﻿Ad;Tutar\r\nÇağrı;1234,5\r\nİşçi;-0,25\r\n"Metin; noktalı ""virgül""";0\r\n'
            : 'Ad,Tutar\r\nÇağrı,1234.5\r\nİşçi,-0.25\r\n"Metin; noktalı ""virgül""",0\r\n';
        const bytes = readFileSync(target);
        expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(l.csv.bom);
        expect(bytes.equals(Buffer.from(expected, 'utf8'))).toBe(true);
        await i.call('doc.close', { docId: out });
      });
    });
  }

  it('performance smoke: a 20 000-row sheet is imported, stored as XLSX and reloaded', async () => {
    const l = LOCALES[1]!;
    const i = await instance(l);
    const rows = 20_000;
    const lines = ['No,Ad,Tutar,Tarih,Not'];
    for (let r = 1; r <= rows; r++) lines.push(`${r},Kişi ${r} Çağrı,${(r * 1.25).toFixed(2)},2026-09-${String((r % 28) + 1).padStart(2, '0')},satır ${r} ığdır`);
    const csv = join(dir, 'buyuk.csv');
    writeFileSync(csv, `${lines.join('\r\n')}\r\n`, 'utf8');
    const docId = 'perf';
    await timed(`perf: CSV import (${rows} rows × 5 columns)`, () =>
      i.call('doc.load', { docId, url: fileUrl(csv), filter: CSV_FILTER, filterOptions: csvImportOptions({ separator: ',', locale: 'en-US' }), view: { mode: 'hidden' } }, { timeoutMs: 300_000 }),
    );
    await timed('perf: SUM over 20 000 cells', () => i.call('calc.setCell', { docId, address: 'G1', formula: `=SUM(C2:C${rows + 1})` }));
    const expectedSum = (1.25 * rows * (rows + 1)) / 2;
    expect((await cell(i, docId, 'G1')).value).toBeCloseTo(expectedSum, 4);
    const xlsx = join(dir, 'buyuk.xlsx');
    await timed('perf: store XLSX', () => i.call('doc.store', { docId, url: fileUrl(xlsx), filter: XLSX_FILTER }, { timeoutMs: 300_000 }));
    await i.call('doc.close', { docId });
    await timed('perf: reload XLSX', () => i.call('doc.load', { docId: 'perf2', url: fileUrl(xlsx), view: { mode: 'hidden' } }, { timeoutMs: 300_000 }));
    expect(await cell(i, 'perf2', `A${rows + 1}`)).toMatchObject({ type: 'value', value: rows });
    expect(await cell(i, 'perf2', `B${rows + 1}`)).toMatchObject({ type: 'text', value: `Kişi ${rows} Çağrı` });
    expect((await cell(i, 'perf2', 'G1')).value).toBeCloseTo(expectedSum, 4);
    await timed('perf: close', () => i.call('doc.close', { docId: 'perf2' }));
  });
});
