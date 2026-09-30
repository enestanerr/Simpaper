/**
 * XLSX generator (exceljs). Formulas are written WITHOUT cached results (except one deliberately stale
 * cell), so every value found after a round trip must come from the engine's own recalculation.
 * Expected results are computed here in JavaScript from the same source data.
 */
import ExcelJS from 'exceljs';
import { AUTHOR, FIXED_DATE, TR, excelSerial } from './constants.mjs';
import { normalizeZip } from './zip.mjs';

const APPLICATION = 'Simpaper corpus generator (exceljs 4.4.0)';

/** Source rows of the "Veriler" sheet (synthetic figures, not statistics). */
export const XLSX_ROWS = [
  { city: 'İstanbul', region: 'Marmara', population: 1_500_000, area: 5461.25, founded: [2020, 1, 15], growth: 0.125, ok: 'Evet' },
  { city: 'Ankara', region: 'İç Anadolu', population: 900_000, area: 2530.5, founded: [2019, 3, 1], growth: 0.0875, ok: 'Evet' },
  { city: 'İzmir', region: 'Ege', population: 700_000, area: 1203.75, founded: [2021, 6, 30], growth: 0.05, ok: 'Hayır' },
  { city: 'Bursa', region: 'Marmara', population: 450_000, area: 1036, founded: [2018, 11, 11], growth: 0.0625, ok: 'Evet' },
  { city: 'Antalya', region: 'Akdeniz', population: 400_000, area: 1417.8, founded: [2022, 2, 28], growth: 0.1, ok: 'Hayır' },
  { city: 'Iğdır', region: 'Doğu Anadolu', population: 60_000, area: 3664.4, founded: [2017, 7, 4], growth: 0.025, ok: 'Evet' },
  { city: 'Şırnak', region: 'Güneydoğu Anadolu', population: 55_000, area: 7078.2, founded: [2016, 10, 29], growth: 0.0375, ok: 'Hayır' },
  { city: 'Muğla', region: 'Ege', population: 250_000, area: 1284.1, founded: [2023, 4, 23], growth: 0.075, ok: 'Evet' },
];

export const XLSX_HEADERS = ['Şehir', 'Bölge', 'Nüfus', 'Alan (km²)', 'Kuruluş', 'Büyüme', 'Onay'];
export const XLSX_FORMATS = { population: '#,##0', area: '#,##0.00', founded: 'dd.mm.yyyy', growth: '0.00%' };

const sum = (values) => values.reduce((a, b) => a + b, 0);

/** Formula cells of the "Hesaplar" sheet with their independently computed results. */
function formulaCells() {
  const rows = XLSX_ROWS;
  const total = sum(rows.map((r) => r.population));
  const avgArea = sum(rows.map((r) => r.area)) / rows.length;
  const date = excelSerial(2026, 9, 29);
  const byCity = (c) => rows.find((r) => r.city === c);
  const round2 = (x) => Math.round(x * 100) / 100;
  return [
    { label: 'Toplam nüfus', formula: 'SUM(Veriler!C2:C9)', expected: total },
    { label: 'Ortalama alan', formula: 'AVERAGE(Veriler!D2:D9)', expected: avgArea, numFmt: '#,##0.00' },
    { label: 'Büyüklük (EĞER)', formula: 'IF(B2>1000000,"Büyük","Küçük")', expected: total > 1_000_000 ? 'Büyük' : 'Küçük' },
    { label: 'İzmir nüfusu (DÜŞEYARA)', formula: 'VLOOKUP("İzmir",Veriler!A2:G9,3,FALSE)', expected: byCity('İzmir').population },
    { label: 'Iğdır bölgesi (İNDİS/KAÇINCI)', formula: 'INDEX(Veriler!B2:B9,MATCH("Iğdır",Veriler!A2:A9,0))', expected: byCity('Iğdır').region },
    { label: 'Tarih (TARİH)', formula: 'DATE(2026,9,29)', expected: date, numFmt: 'dd.mm.yyyy', kind: 'date' },
    { label: 'Tarih metni (METNEÇEVİR)', formula: 'TEXT(B7,"dd.mm.yyyy")', expected: '29.09.2026' },
    { label: 'Mutlak ve sayfalar arası başvuru', formula: '$B$2*Veriler!$F$2', expected: total * rows[0].growth },
    { label: 'Marmara sayısı (EĞERSAY)', formula: 'COUNTIF(Veriler!B2:B9,"Marmara")', expected: rows.filter((r) => r.region === 'Marmara').length },
    { label: 'Yuvarlama (YUVARLA)', formula: 'ROUND(B3/7,2)', expected: round2(avgArea / 7) },
    { label: 'Türkçe uzunluk (UZUNLUK)', formula: 'LEN("çğıİöşü")', expected: 7 },
    { label: 'Hata yakalama (EĞERHATA)', formula: 'IFERROR(1/0,"hata")', expected: 'hata' },
    { label: 'Mod (MOD)', formula: 'MOD(-3,2)', expected: 1 },
    { label: 'Negatif yuvarlama', formula: 'ROUND(-2.5,0)', expected: -3 },
    { label: 'Adlandırılmış aralık', formula: 'SUM(Nufus)', expected: total },
    { label: 'Bayat önbellek (yeniden hesaplanmalı)', formula: 'B2+1', expected: total + 1, staleCache: -1 },
    { label: 'Birleştirme (BİRLEŞTİR)', formula: 'CONCATENATE(Veriler!A7," - ",Veriler!B7)', expected: `${rows[5].city} - ${rows[5].region}` },
    { label: 'Tarih farkı', formula: 'DATE(2026,12,31)-DATE(2026,1,1)', expected: excelSerial(2026, 12, 31) - excelSerial(2026, 1, 1) },
    { label: 'Yüzde toplamı', formula: 'Veriler!F2+Veriler!F3', expected: rows[0].growth + rows[1].growth, numFmt: '0.00%' },
    { label: 'Mantıksal (VE)', formula: 'AND(B2>0,B5=700000)', expected: total > 0 && byCity('İzmir').population === 700_000 },
    { label: 'Büyük harf (BÜYÜKHARF)', formula: 'UPPER("çğıöşü")', expected: 'ÇĞIÖŞÜ' },
  ].map((c, i) => ({ ...c, sheet: 'Hesaplar', address: `B${i + 2}` }));
}

/** Number-format samples of the "Biçimler" sheet. */
function formatSamples() {
  return [
    { label: 'Genel', value: 1234.5, numFmt: 'General' },
    { label: 'Ondalık', value: 1234.5, numFmt: '0.00' },
    { label: 'Binlik ayırıcı', value: 1234567.891, numFmt: '#,##0.00' },
    { label: 'Yüzde', value: 0.1234, numFmt: '0.00%' },
    { label: 'Bilimsel', value: 12345.678, numFmt: '0.00E+00' },
    { label: 'Tarih', value: excelSerial(2026, 9, 29), numFmt: 'dd.mm.yyyy', kind: 'date' },
    { label: 'Saat', value: 0.5625, numFmt: 'hh:mm' },
    { label: 'Tarih ve saat', value: excelSerial(2026, 9, 29) + 0.5625, numFmt: 'dd.mm.yyyy hh:mm', kind: 'date' },
    { label: 'Türk lirası', value: 1234.5, numFmt: '#,##0.00 [$₺-41F]' },
    { label: 'ABD doları', value: 1234.5, numFmt: '[$$-409]#,##0.00' },
    { label: 'Metin', value: '00123', numFmt: '@' },
    { label: 'Kesir', value: 0.75, numFmt: '# ?/?' },
  ].map((s, i) => ({ ...s, sheet: 'Biçimler', address: `B${i + 4}` }));
}

// ---------------------------------------------------------------------------------------------- CSV oracle
function groupThousands(intPart, sep) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * Formats a number the way a `#,##0[.00]` / `0.00%` format renders in the given locale.
 * Turkish conventions: `.` groups thousands, `,` separates decimals and the percent sign precedes
 * the number (`%12,50`); LibreOffice applies this when it converts the en-US code `0.00%` to tr-TR.
 */
export function formatNumber(value, { decimals, thousands, percent }, locale) {
  const turkish = locale.startsWith('tr');
  const [dec, grp] = turkish ? [',', '.'] : ['.', ','];
  const v = percent ? value * 100 : value;
  const [i, f] = v.toFixed(decimals).split('.');
  const number = `${thousands ? groupThousands(i, grp) : i}${f ? dec + f : ''}`;
  if (!percent) return number;
  return turkish ? `%${number}` : `${number}%`;
}

/**
 * Expected text of the first sheet exported as CSV/TSV "as shown".
 * @param {'tr-TR' | 'en-US'} locale
 * @param {string} sep
 */
export function expectedDelimited(locale, sep) {
  const quote = (s) => (s.includes(sep) || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s);
  const pad = (n) => String(n).padStart(2, '0');
  const lines = [XLSX_HEADERS.map(quote).join(sep)];
  for (const r of XLSX_ROWS) {
    const [y, m, d] = r.founded;
    lines.push(
      [
        r.city,
        r.region,
        formatNumber(r.population, { decimals: 0, thousands: true }, locale),
        formatNumber(r.area, { decimals: 2, thousands: true }, locale),
        `${pad(d)}.${pad(m)}.${y}`,
        formatNumber(r.growth, { decimals: 2, percent: true }, locale),
        r.ok,
      ]
        .map(quote)
        .join(sep),
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------- builder
const thin = { style: 'thin', color: { argb: 'FF1D2B53' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

function setup(wb) {
  wb.creator = AUTHOR;
  wb.lastModifiedBy = AUTHOR;
  wb.created = FIXED_DATE;
  wb.modified = FIXED_DATE;
  wb.title = 'Simpaper Tablo Testi';
  wb.subject = 'Türkçe XLSX test çalışma kitabı';
  // No cached results are written, so consumers must calculate on load.
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };
}

/** Child order of CT_Font in the SpreadsheetML schema (exceljs writes another order). */
const FONT_CHILD_ORDER = ['b', 'i', 'strike', 'condense', 'extend', 'outline', 'shadow', 'u', 'vertAlign', 'sz', 'color', 'name', 'family', 'charset', 'scheme'];

function schemaOrderFonts(xml) {
  return xml.replace(/<font>((?:<[a-zA-Z]+(?:\s[^>]*)?\/>)*)<\/font>/g, (_, inner) => {
    const children = inner.match(/<[a-zA-Z]+(?:\s[^>]*)?\/>/g) ?? [];
    const rank = (tag) => {
      const i = FONT_CHILD_ORDER.indexOf(/^<([a-zA-Z]+)/.exec(tag)[1]);
      return i < 0 ? FONT_CHILD_ORDER.length : i;
    };
    return `<font>${children.sort((a, b) => rank(a) - rank(b)).join('')}</font>`;
  });
}

/**
 * Post-processes exceljs parts: the hard-coded "Microsoft Excel" application name is replaced (we never
 * claim to be Office) and font children are put in schema order (Open XML SDK validation).
 */
function normalizeXlsxPart(name, content) {
  if (name === 'docProps/app.xml') {
    return content.toString('utf8').replace(/<Application>[^<]*<\/Application>/, `<Application>${APPLICATION}</Application>`);
  }
  if (name === 'xl/styles.xml') return schemaOrderFonts(content.toString('utf8'));
  return content;
}

export async function buildXlsx() {
  const wb = new ExcelJS.Workbook();
  setup(wb);

  // Sheet 1: data (first sheet = CSV export source)
  const data = wb.addWorksheet('Veriler', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2', activeCell: 'B2' }] });
  data.columns = [{ width: 14 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 13 }, { width: 11 }, { width: 9 }];
  data.addRow(XLSX_HEADERS);
  data.getRow(1).font = { bold: true };
  for (const r of XLSX_ROWS) {
    const [y, m, d] = r.founded;
    data.addRow([r.city, r.region, r.population, r.area, new Date(Date.UTC(y, m - 1, d)), r.growth, r.ok]);
  }
  for (let row = 2; row <= XLSX_ROWS.length + 1; row++) {
    data.getCell(`C${row}`).numFmt = XLSX_FORMATS.population;
    data.getCell(`D${row}`).numFmt = XLSX_FORMATS.area;
    data.getCell(`E${row}`).numFmt = XLSX_FORMATS.founded;
    data.getCell(`F${row}`).numFmt = XLSX_FORMATS.growth;
    data.getCell(`G${row}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"Evet,Hayır"'],
      showErrorMessage: true,
      errorTitle: 'Geçersiz değer',
      error: 'Evet ya da Hayır seçin.',
    };
  }
  for (let row = 1; row <= XLSX_ROWS.length + 1; row++) for (let col = 1; col <= 7; col++) data.getCell(row, col).border = box;
  data.addConditionalFormatting({
    ref: 'C2:C9',
    rules: [
      {
        type: 'cellIs',
        operator: 'greaterThan',
        priority: 1,
        formulae: ['1000000'],
        style: { font: { color: { argb: 'FF9C0006' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } },
      },
    ],
  });
  wb.definedNames.add('Veriler!$C$2:$C$9', 'Nufus');

  // Sheet 2: formulas without cached values
  const calc = wb.addWorksheet('Hesaplar');
  calc.columns = [{ width: 38 }, { width: 22 }];
  calc.addRow(['Hesap', 'Sonuç']);
  calc.getRow(1).font = { bold: true };
  const formulas = formulaCells();
  for (const f of formulas) {
    const row = calc.addRow([f.label]);
    const cell = row.getCell(2);
    cell.value = f.staleCache === undefined ? { formula: f.formula } : { formula: f.formula, result: f.staleCache };
    if (f.numFmt) cell.numFmt = f.numFmt;
  }

  // Sheet 3: formats, merged cells, borders
  const fmt = wb.addWorksheet('Biçimler');
  fmt.columns = [{ width: 18 }, { width: 22 }, { width: 24 }, { width: 12 }];
  fmt.mergeCells('A1:D1');
  const title = fmt.getCell('A1');
  title.value = 'Birleştirilmiş başlık — Biçimler';
  title.font = { bold: true, size: 14, color: { argb: 'FF1D2B53' } };
  title.alignment = { horizontal: 'center' };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC9A227' } };
  fmt.addRow([]);
  fmt.addRow(['Biçim', 'Değer', 'Kod']);
  fmt.getRow(3).font = { bold: true };
  const samples = formatSamples();
  for (const s of samples) {
    const row = fmt.addRow([s.label, s.value, s.numFmt]);
    row.getCell(2).numFmt = s.numFmt;
  }
  const last = 3 + samples.length;
  for (let row = 3; row <= last; row++) {
    for (let col = 1; col <= 3; col++) {
      fmt.getCell(row, col).border = {
        top: row === 3 ? { style: 'medium' } : thin,
        left: col === 1 ? { style: 'medium' } : thin,
        bottom: row === 3 ? { style: 'double' } : row === last ? { style: 'medium' } : thin,
        right: col === 3 ? { style: 'medium' } : thin,
      };
    }
  }

  const raw = Buffer.from(await wb.xlsx.writeBuffer());
  const buffer = await normalizeZip(raw, normalizeXlsxPart);

  const facts = {
    sheets: ['Veriler', 'Hesaplar', 'Biçimler'],
    headers: XLSX_HEADERS,
    rows: XLSX_ROWS.map((r) => ({ ...r, founded: excelSerial(...r.founded) })),
    dataFormats: XLSX_FORMATS,
    formulas: formulas.map(({ label, sheet, address, formula, expected, numFmt, kind, staleCache }) => ({ label, sheet, address, formula, expected, numFmt, kind, staleCache })),
    formats: samples.map(({ sheet, address, value, numFmt, kind }) => ({ sheet, address, value, numFmt, kind })),
    merges: { Biçimler: ['A1:D1'] },
    frozen: { Veriler: { xSplit: 1, ySplit: 1 } },
    dataValidations: { Veriler: { range: 'G2:G9', type: 'list', formula: '"Evet,Hayır"' } },
    conditionalFormats: { Veriler: ['C2:C9'] },
    definedNames: { Nufus: 'Veriler!$C$2:$C$9' },
    csv: {
      'tr-TR': { separator: ';', lines: expectedDelimited('tr-TR', ';') },
      'en-US': { separator: ',', lines: expectedDelimited('en-US', ',') },
    },
    tsv: { 'en-US': { separator: '\t', lines: expectedDelimited('en-US', '\t') } },
    application: APPLICATION,
  };
  return { buffer, facts };
}

/**
 * Large workbook written with the exceljs streaming writer (one sheet, `rows` data rows, a formula
 * column and a total row). Written to `path`; returns the facts.
 */
export async function writeLargeXlsx(path, rows = 100_000) {
  const { writeFileSync, readFileSync } = await import('node:fs');
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: path, useStyles: true, useSharedStrings: false });
  setup(wb);
  const ws = wb.addWorksheet('Büyük Veri');
  ws.columns = [{ width: 10 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 14 }];
  ws.addRow(['Sıra', 'Şehir', 'Değer', 'Tarih', 'İki katı']).commit();
  const base = excelSerial(2026, 1, 1);
  for (let i = 1; i <= rows; i++) {
    const r = i + 1;
    const row = ws.addRow([i, TR.places[i % TR.places.length], i * 1.5, base + (i % 365), { formula: `C${r}*2` }]);
    row.getCell(4).numFmt = 'dd.mm.yyyy';
    row.commit();
  }
  const totalRow = rows + 2;
  ws.addRow(['Toplam', null, { formula: `SUM(C2:C${rows + 1})` }]).commit();
  await ws.commit();
  await wb.commit();
  writeFileSync(path, await normalizeZip(readFileSync(path), normalizeXlsxPart));
  return { rows, totalCell: `C${totalRow}`, total: (1.5 * rows * (rows + 1)) / 2, sheet: 'Büyük Veri' };
}
