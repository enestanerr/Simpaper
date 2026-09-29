import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { excelSerial } from '../../../scripts/corpus/lib/constants.mjs';
import { generateCorpus, readManifest, type CorpusManifest } from '../../../scripts/corpus/lib/index.mjs';
import { expectedDelimited, formatNumber } from '../../../scripts/corpus/lib/xlsx.mjs';
import { partHashes } from '../../../scripts/corpus/lib/zip.mjs';
import { CORPUS_OUTPUT } from '../../tools/paths';

mkdirSync(CORPUS_OUTPUT, { recursive: true });
const root = mkdtempSync(join(CORPUS_OUTPUT, 'unit-generator-'));
let a: CorpusManifest;
let b: CorpusManifest;

beforeAll(async () => {
  // Two independent runs without LibreOffice (derived formats are covered by the engine tests).
  a = await generateCorpus({ outDir: join(root, 'a'), derived: false });
  b = await generateCorpus({ outDir: join(root, 'b'), derived: false });
}, 180_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

describe('generateCorpus', () => {
  it('lists every written file with its size and hash', () => {
    expect(a.files.map((f) => f.id)).toEqual(['docx-basic', 'docx-changed', 'pptx-basic', 'pptx-changed', 'xlsx-basic', 'pdf-text', 'pdf-form', 'pdf-encrypted', 'pdf-scanned']);
    for (const f of a.files) {
      const p = join(root, 'a', f.path);
      expect(existsSync(p), f.path).toBe(true);
      expect(readFileSync(p).length).toBe(f.bytes);
      expect(sha(p)).toBe(f.sha256);
    }
    expect(a.license).toBe('CC0-1.0');
    expect(a.derivedSpecs).toEqual([]);
    expect(readManifest(join(root, 'a'))?.files).toHaveLength(a.files.length);
  });

  it('is byte-reproducible for all files marked deterministic', () => {
    for (const f of a.files) {
      const g = b.files.find((x) => x.id === f.id)!;
      if (f.deterministic) expect(g.sha256, f.id).toBe(f.sha256);
    }
    expect(a.files.filter((f) => !f.deterministic).map((f) => f.id)).toEqual(['pdf-encrypted']);
  });

  it('keeps identical package parts for OOXML files', async () => {
    for (const id of ['docx-basic', 'pptx-basic', 'xlsx-basic']) {
      const f = a.files.find((x) => x.id === id)!;
      expect(await partHashes(readFileSync(join(root, 'a', f.path)))).toEqual(await partHashes(readFileSync(join(root, 'b', f.path))));
    }
  });

  it('writes dates of the zip entries as a fixed timestamp', () => {
    const buf = readFileSync(join(root, 'a', 'docx-basic.docx'));
    // local file header: signature 0x04034b50, DOS time at offset 10, DOS date at offset 12
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    const dosDate = buf.readUInt16LE(12);
    expect([1980 + (dosDate >> 9), (dosDate >> 5) & 15, dosDate & 31]).toEqual([2026, 1, 1]);
  });
});

describe('expectation helpers', () => {
  it('computes Excel serial dates', () => {
    expect(excelSerial(2024, 2, 29)).toBe(45351);
    expect(excelSerial(2026, 1, 1)).toBe(46023);
    expect(excelSerial(2026, 9, 29)).toBe(46294);
  });

  it('formats numbers like tr-TR and en-US spreadsheets', () => {
    expect(formatNumber(1500000, { decimals: 0, thousands: true }, 'tr-TR')).toBe('1.500.000');
    expect(formatNumber(1500000, { decimals: 0, thousands: true }, 'en-US')).toBe('1,500,000');
    expect(formatNumber(5461.25, { decimals: 2, thousands: true }, 'tr-TR')).toBe('5.461,25');
    expect(formatNumber(0.125, { decimals: 2, percent: true }, 'tr-TR')).toBe('%12,50');
    expect(formatNumber(0.1, { decimals: 2, percent: true }, 'en-US')).toBe('10.00%');
  });

  it('quotes delimited fields only when they contain the separator', () => {
    const en = expectedDelimited('en-US', ',');
    expect(en[1]).toBe('İstanbul,Marmara,"1,500,000","5,461.25",15.01.2020,12.50%,Evet');
    const tr = expectedDelimited('tr-TR', ';');
    expect(tr[0]).toBe('Şehir;Bölge;Nüfus;Alan (km²);Kuruluş;Büyüme;Onay');
    expect(tr[6]).toBe('Iğdır;Doğu Anadolu;60.000;3.664,40;04.07.2017;%2,50;Evet');
  });
});
