/**
 * Turkish text handling: dotted/dotless I in casing and matching, Turkish collation, and locale-aware
 * number/size/date formatting used by the shell (font sizes with a decimal comma, byte sizes, dates).
 */
import { describe, expect, it } from 'vitest';
import { collator, fold, includesFolded, localeTag, lower, normalizeKeyTipChar, sortLocale, upper } from '../../../src/renderer/i18n/turkish';
import { formatFontSize, mergeFontLists, parseFontSize } from '../../../src/renderer/services/fonts';
import { formatBytes, formatDateTime } from '../../../src/renderer/shell/format';

describe('casing', () => {
  it('upper-cases i to İ and ı to I in Turkish only', () => {
    expect(upper('istanbul ılık', 'tr')).toBe('İSTANBUL ILIK');
    expect(upper('istanbul', 'en')).toBe('ISTANBUL');
    expect(lower('İSTANBUL ILIK', 'tr')).toBe('istanbul ılık');
    expect(lower('ISTANBUL', 'en')).toBe('istanbul');
    expect(upper('çğöşü', 'tr')).toBe('ÇĞÖŞÜ');
  });

  it('maps UI languages to BCP 47 tags', () => {
    expect(localeTag('tr')).toBe('tr-TR');
    expect(localeTag('en')).toBe('en-US');
  });
});

describe('case-insensitive matching', () => {
  it('folds every I variant together, in both UI languages', () => {
    for (const lang of ['tr', 'en'] as const) {
      const folded = ['İstanbul', 'ISTANBUL', 'istanbul', 'ıstanbul'].map((s) => fold(s, lang));
      expect(new Set(folded), lang).toEqual(new Set(['istanbul']));
      expect(fold('ILIK', lang)).toBe(fold('ılık', lang));
    }
  });

  it('finds Turkish words regardless of case where the regex i flag fails', () => {
    expect(/ılık/i.test('ILIK')).toBe(false); // why the helpers exist
    expect(includesFolded('Hava ILIK', 'ılık', 'tr')).toBe(true);
    expect(includesFolded('İzmir Şubesi', 'izmir şube', 'tr')).toBe(true);
    expect(includesFolded('Rapor', 'x', 'tr')).toBe(false);
    expect(includesFolded('Info', 'INFO', 'en')).toBe(true);
  });

  it('keeps other Turkish letters distinct', () => {
    expect(fold('Şeker', 'tr')).toBe('şeker');
    expect(fold('şeker', 'tr')).not.toBe(fold('seker', 'tr'));
    expect(fold('Göl', 'tr')).not.toBe(fold('gol', 'tr'));
  });
});

describe('collation', () => {
  it('sorts with the Turkish alphabet (c < ç < d, g < ğ, ı < i, o < ö, s < ş, u < ü)', () => {
    const words = ['üzüm', 'şeker', 'ılık', 'çay', 'uzun', 'ince', 'gül', 'dağ', 'su', 'ördek', 'cam', 'oda', 'göl', 'ğ'];
    expect(sortLocale(words, 'tr')).toEqual(['cam', 'çay', 'dağ', 'göl', 'gül', 'ğ', 'ılık', 'ince', 'oda', 'ördek', 'su', 'şeker', 'uzun', 'üzüm']);
  });

  it('sorts numbers naturally and reuses collators', () => {
    expect(sortLocale(['Belge10', 'Belge2', 'Belge1'], 'tr')).toEqual(['Belge1', 'Belge2', 'Belge10']);
    expect(collator('tr')).toBe(collator('tr'));
    expect(collator('tr', 'base').compare('a', 'A')).toBe(0);
  });

  it('merges font lists case-insensitively in UI order', () => {
    expect(mergeFontLists('tr', ['Arial', 'Çağdaş Sans'], ['arial', 'Calibri'], ['Zeta'])).toEqual(['Arial', 'Calibri', 'Çağdaş Sans', 'Zeta']);
  });
});

describe('KeyTip characters', () => {
  it('accepts ASCII letters and digits; Turkish I variants become I', () => {
    expect(['a', 'Z', '5', 'i', 'ı', 'İ', 'ğ', 'ş', '', 'ab'].map(normalizeKeyTipChar)).toEqual(['A', 'Z', '5', 'I', 'I', 'I', '', '', '', '']);
  });
});

describe('locale formatting', () => {
  it('parses and formats font sizes with comma or point', () => {
    expect(parseFontSize('10,5')).toBe(10.5);
    expect(parseFontSize('10.5')).toBe(10.5);
    expect(parseFontSize(' 12 pt ')).toBe(12);
    expect(parseFontSize('12 nk')).toBe(12);
    expect(parseFontSize('0')).toBeNull();
    expect(parseFontSize('abc')).toBeNull();
    expect(parseFontSize('1000')).toBeNull();
    expect(formatFontSize(10.5, 'tr')).toBe('10,5');
    expect(formatFontSize(10.5, 'en')).toBe('10.5');
  });

  it('formats byte sizes and dates for the UI language', () => {
    expect(formatBytes(512, 'tr')).toBe('512 B');
    expect(formatBytes(1536, 'tr')).toBe('1,5 KB');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024, 'en')).toBe('5 MB');
    expect(formatDateTime('not a date', 'tr')).toBe('');
    const tr = formatDateTime('2026-09-29T08:05:00Z', 'tr');
    expect(tr).toMatch(/2026/);
    expect(tr).toMatch(/Eyl/);
    expect(formatDateTime('2026-09-29T08:05:00Z', 'en')).toMatch(/Sep/);
  });
});
