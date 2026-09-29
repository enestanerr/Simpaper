import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@cantoo/fontkit';
import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { SAMPLES } from '../../../scripts/corpus/third-party.mjs';
import { ensureGeneratedCorpus, type Corpus, type PdfEncryptedFacts, type PdfFormFacts, type PdfScannedFacts, type PdfTextFacts } from '../../tools/corpus';
import { REPO_ROOT, THIRD_PARTY_DIR } from '../../tools/paths';
import { isPasswordError, pdfInfo, pdfText, renderPdfPage, renderPdfPages } from '../../tools/pdf';
import { inkRatio, readPng } from '../../tools/visual';

let corpus: Corpus;

beforeAll(async () => {
  corpus = await ensureGeneratedCorpus();
}, 180_000);

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('pdfText / pdfInfo', () => {
  it('extracts Turkish text per page from the generated text PDF', async () => {
    const facts = corpus.facts<PdfTextFacts>('pdf-text');
    const pages = await pdfText(corpus.path('pdf-text'));
    expect(pages).toHaveLength(facts.pageCount);
    facts.pages.forEach((p, i) => {
      const text = squash(pages[i]!);
      expect(text).toContain(p.title);
      expect(text).toContain(p.footer);
      for (const para of p.paragraphs) expect(text).toContain(squash(para));
    });
  });

  it('reads metadata, A4 page size and AcroForm widgets', async () => {
    const info = await pdfInfo(corpus.path('pdf-text'));
    expect(info.info['Title']).toBe('Varak PDF Test Belgesi');
    expect(info.info['Author']).toBe('Varak Test');
    expect(info.pageSizes[0]!.width).toBeCloseTo(595.28, 1);
    expect(info.pageSizes[0]!.height).toBeCloseTo(841.89, 1);
    expect(info.fields).toEqual([]);

    const facts = corpus.facts<PdfFormFacts>('pdf-form');
    const form = await pdfInfo(corpus.path('pdf-form'));
    const byName = new Map(form.fields.map((f) => [f.name, f]));
    expect([...byName.keys()].sort()).toEqual(facts.fields.map((f) => f.name).sort());
    expect(byName.get('adSoyad')).toMatchObject({ type: 'Tx', value: 'Ayşe Yılmaz' });
    expect(byName.get('sehir')).toMatchObject({ type: 'Ch', value: ['Iğdır'], options: facts.fields.find((f) => f.name === 'sehir')!.options });
    expect(byName.get('onay')).toMatchObject({ type: 'Btn', checked: true });
    expect(byName.get('not')).toMatchObject({ type: 'Tx', value: '' });
  });

  it('requires the password of the encrypted PDF', async () => {
    const facts = corpus.facts<PdfEncryptedFacts>('pdf-encrypted');
    const error = await pdfText(corpus.path('pdf-encrypted')).catch((e: unknown) => e);
    expect(isPasswordError(error)).toBe(true);
    const wrong = await pdfText(corpus.path('pdf-encrypted'), { password: 'yanlis' }).catch((e: unknown) => e);
    expect(isPasswordError(wrong)).toBe(true);
    const [page] = await pdfText(corpus.path('pdf-encrypted'), { password: facts.password });
    for (const line of facts.text) expect(squash(page!)).toContain(line);
  });

  it('finds no text layer on the scanned page, but the page is not blank', async () => {
    const facts = corpus.facts<PdfScannedFacts>('pdf-scanned');
    expect(facts.textLayer).toBe(false);
    const [text] = await pdfText(corpus.path('pdf-scanned'));
    expect(text!.trim()).toBe('');
    expect(inkRatio(await renderPdfPage(corpus.path('pdf-scanned'), 0, 0.5))).toBeGreaterThan(0.005);
  });
});

describe('pdfInfo on a real Acrobat form (third-party sample pdfbox-acroform)', () => {
  it('reads every widget with its field type and kind', async () => {
    const sample = SAMPLES.find((s) => s.id === 'pdfbox-acroform')!;
    const info = await pdfInfo(join(THIRD_PARTY_DIR, sample.source, sample.file));
    expect(info.pages).toBe(1);
    const counts: Record<string, number> = {};
    for (const f of info.fields) {
      const key = f.type === 'Tx' || f.type === 'Sig' ? f.type : `${f.type}:${f.kind}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    expect(counts).toEqual(sample.expect['widgets']);
    expect(info.fields.filter((f) => f.kind === 'checkbox').every((f) => typeof f.checked === 'boolean')).toBe(true);
  });
});

describe('renderPdfPage', () => {
  it('renders pages at the requested scale', async () => {
    const png1 = readPng(await renderPdfPage(corpus.path('pdf-text'), 0, 1));
    expect([png1.width, png1.height]).toEqual([596, 842]);
    const png2 = readPng(await renderPdfPage(corpus.path('pdf-text'), 1, 2));
    expect([png2.width, png2.height]).toEqual([1191, 1684]);
    const all = await renderPdfPages(corpus.path('pdf-text'), 0.5);
    expect(all).toHaveLength(3);
    for (const p of all) expect(inkRatio(p)).toBeGreaterThan(0.001);
    await expect(renderPdfPage(corpus.path('pdf-text'), 3, 1)).rejects.toThrow(RangeError);
  });
});

describe('pdf-lib round trip (library used by the PDF service)', () => {
  it('keeps text, fields and values after load → fill → save', async () => {
    const bytes = await readFile(corpus.path('pdf-form'));
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    doc.registerFontkit(fontkit);
    // The same Unicode font the generator embedded (path recorded relative to the repository).
    const font = await doc.embedFont(await readFile(join(REPO_ROOT, corpus.facts<PdfTextFacts>('pdf-text').font)));
    const form = doc.getForm();
    form.getTextField('not').setText('Çok önemli: ığüşöç İĞÜŞÖÇ');
    form.getCheckBox('onay').uncheck();
    form.getDropdown('sehir').select('Şırnak');
    form.updateFieldAppearances(font);
    const saved = await doc.save();

    const info = await pdfInfo(saved);
    const byName = new Map(info.fields.map((f) => [f.name, f]));
    expect(byName.get('not')!.value).toBe('Çok önemli: ığüşöç İĞÜŞÖÇ');
    expect(byName.get('onay')!.checked).toBe(false);
    expect(byName.get('sehir')!.value).toEqual(['Şırnak']);
    expect(byName.get('adSoyad')!.value).toBe('Ayşe Yılmaz');
    expect(squash((await pdfText(saved))[0]!)).toContain('Başvuru Formu');
  });
});
