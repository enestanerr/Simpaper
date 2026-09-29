import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureGeneratedCorpus, type Corpus, type DocxFacts, type PptxFacts, type XlsxFacts } from '../../tools/corpus';
import { docxDocument, docxRuns, docxText, expandRange, formattingOf, normalizeNumFmt, pptxSlides, sameNumber, xlsxWorkbook } from '../../tools/ooxml';
import { parseXml, textContent } from '../../tools/xml';

let corpus: Corpus;

beforeAll(async () => {
  corpus = await ensureGeneratedCorpus();
}, 180_000);

describe('xml helper', () => {
  it('decodes entities once and resolves namespaces independent of prefixes', () => {
    const root = parseXml('<?xml version="1.0"?><x:a xmlns:x="urn:x" xmlns:y="urn:y" y:k="&#x131;"><x:b>&amp;#305; &#305;&lt;</x:b></x:a>');
    expect(root.ns).toBe('urn:x');
    expect(root.nsAttrs.get('urn:y|k')).toBe('ı');
    expect(textContent(root)).toBe('&#305; ı<');
  });
});

describe('docx reader on the generated document', () => {
  it('reads paragraphs, headings and Turkish text', async () => {
    const facts = corpus.facts<DocxFacts>('docx-basic');
    const doc = await docxDocument(corpus.path('docx-basic'));
    for (const t of facts.texts) expect(doc.paragraphs.map((p) => p.text)).toContain(t);
    const headings = doc.paragraphs.filter((p) => p.outlineLevel !== undefined).map((p) => ({ level: p.outlineLevel! + 1, text: p.text, style: p.styleName }));
    expect(headings.map(({ level, text }) => ({ level, text }))).toEqual(facts.headings);
    expect(headings.every((h) => h.style === `heading ${h.level}`)).toBe(true);
    expect(doc.defaultLanguage).toBe('tr-TR');
  });

  it('reports effective bold/italic/underline per run', async () => {
    const facts = corpus.facts<DocxFacts>('docx-basic');
    const runs = await docxRuns(corpus.path('docx-basic'));
    for (const w of facts.bold) expect(formattingOf(runs, w)?.every((r) => r.bold)).toBe(true);
    for (const w of facts.italic) expect(formattingOf(runs, w)?.every((r) => r.italic)).toBe(true);
    for (const w of facts.underline) expect(formattingOf(runs, w)?.every((r) => r.underline)).toBe(true);
    for (const w of facts.plain) expect(formattingOf(runs, w)?.some((r) => r.bold || r.italic)).toBe(false);
    // Heading bold comes from the style chain, not from direct formatting.
    expect(formattingOf(runs, 'Varak Test Belgesi')?.every((r) => r.bold)).toBe(true);
    // Table header cells are bold, body cells are not.
    expect(formattingOf(runs, 'Şehir')?.every((r) => r.bold)).toBe(true);
    expect(formattingOf(runs, 'Güneydoğu Anadolu')?.every((r) => r.bold)).toBe(false);
  });

  it('reads table, header/footer with page fields, comment, insertion, hyperlink, picture and page setup', async () => {
    const facts = corpus.facts<DocxFacts>('docx-basic');
    const doc = await docxDocument(corpus.path('docx-basic'));
    expect(doc.tables).toEqual([facts.table]);
    expect(doc.headers).toEqual([facts.header]);
    expect(doc.footers[0]).toMatch(/^Sayfa 1 \/ 2$/);
    expect(doc.headerFooterFields).toEqual(expect.arrayContaining(facts.footerFields));
    expect(doc.comments.map(({ author, text }) => ({ author, text }))).toEqual(facts.comments);
    expect(doc.insertions).toEqual(facts.insertions);
    expect(doc.deletions).toEqual([]);
    expect(doc.hyperlinks).toEqual([{ text: facts.hyperlinks[0]!.text, target: facts.hyperlinks[0]!.target, anchor: undefined }]);
    expect(doc.pictures).toHaveLength(1);
    expect(doc.pictures[0]).toMatchObject({ contentType: 'image/png', descr: facts.images[0]!.alt });
    const section = doc.sections.at(-1)!;
    expect(section).toMatchObject({ pageWidth: facts.page.width, pageHeight: facts.page.height, headerRefs: 1, footerRefs: 1 });
    expect(section.margins).toMatchObject({ top: facts.page.margin, right: facts.page.margin, bottom: facts.page.margin, left: facts.page.margin });
    const bullets = doc.paragraphs.filter((p) => p.numbered).map((p) => p.text);
    expect(bullets).toEqual(facts.bullets);
  });

  it('docxText combines body, headers, footers and comments', async () => {
    const t = await docxText(corpus.path('docx-basic'));
    expect(t.body).toContain('Pijamalı hasta yağız şoföre çabucak güvendi.');
    expect(t.body).toContain('eklenen metin');
    expect(t.headers[0]).toContain('Üstbilgi');
    expect(t.comments[0]).toContain('ÇĞİÖŞÜ');
  });

  it('excludes deleted text, keeps text boxes separate and follows mc:AlternateContent once', async () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const doc = `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>
      <w:p><w:r><w:t xml:space="preserve">kalan </w:t></w:r><w:del w:id="1" w:author="A"><w:r><w:delText>silinen</w:delText></w:r></w:del><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>son</w:t></w:r></w:p>
      <w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent><w:p><w:r><w:t>kutu</w:t></w:r></w:p></w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>kutu</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r><w:r><w:t>dış</w:t></w:r></w:p>
    </w:body></w:document>`;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', doc);
    const d = await docxDocument(await zip.generateAsync({ type: 'uint8array' }));
    expect(d.paragraphs.map((p) => p.text)).toEqual(['kalan son', 'dış', 'kutu']);
    expect(d.deletions).toEqual([{ author: 'A', text: 'silinen' }]);
    expect(formattingOf(d.runs, 'son')?.[0]?.bold).toBe(false);
  });
});

describe('pptx reader on the generated presentation', () => {
  it('reads slides, titles, bullet levels, notes, pictures and tables', async () => {
    const facts = corpus.facts<PptxFacts>('pptx-basic');
    const slides = await pptxSlides(corpus.path('pptx-basic'));
    expect(slides).toHaveLength(facts.slideCount);
    slides.forEach((slide, i) => {
      const f = facts.slides[i]!;
      expect(slide.title).toBe(f.title);
      expect(slide.notes).toBe(f.notes);
      expect(slide.imageCount).toBe(f.images);
      for (const t of f.texts) expect(slide.texts).toContain(t);
      if (f.table) expect(slide.tables).toEqual([f.table]);
    });
    const bullets = slides[1]!.paragraphs.filter((p) => p.placeholder === 'body');
    expect(bullets.map((b) => b.level)).toEqual(facts.slides[1]!.bulletLevels);
    expect(slides[2]!.images[0]!.bytes).toBeGreaterThan(100);
    expect(slides.map((s) => s.layoutName)).toEqual(['Title Slide', 'Title and Content', 'Title Only']);
  });
});

describe('xlsx reader on the generated workbook', () => {
  it('reads sheets, constants, number formats and structure', async () => {
    const facts = corpus.facts<XlsxFacts>('xlsx-basic');
    const wb = await xlsxWorkbook(corpus.path('xlsx-basic'));
    expect(wb.sheets.map((s) => s.name)).toEqual(facts.sheets);
    expect(wb.application).toBe(facts.application);
    const data = wb.sheet('Veriler');
    expect(facts.headers.map((_, i) => data.cells.get(`${String.fromCharCode(65 + i)}1`)?.value)).toEqual(facts.headers);
    facts.rows.forEach((r, i) => {
      const row = i + 2;
      expect(data.cells.get(`A${row}`)?.value).toBe(r.city);
      expect(data.cells.get(`C${row}`)?.value).toBe(r.population);
      expect(data.cells.get(`D${row}`)?.value).toBe(r.area);
      expect(data.cells.get(`E${row}`)).toMatchObject({ value: r.founded, isDate: true });
      expect(normalizeNumFmt(data.cells.get(`F${row}`)?.numFmt)).toBe(normalizeNumFmt(facts.dataFormats.growth));
    });
    expect(data.frozen).toEqual(facts.frozen['Veriler']);
    const dv = facts.dataValidations['Veriler']!;
    for (const address of expandRange(dv.range)) expect(data.dataValidations.get(address)).toEqual({ type: dv.type, formulae: [dv.formula] });
    expect(data.conditionalFormats.map((c) => c.ref)).toEqual(facts.conditionalFormats['Veriler']);
    expect(wb.sheet('Biçimler').merges).toEqual(facts.merges['Biçimler']);
    expect(wb.definedNames['Nufus']).toEqual([facts.definedNames['Nufus']]);
    for (const f of facts.formats) {
      const cell = wb.sheet(f.sheet).cells.get(f.address);
      expect(normalizeNumFmt(cell?.numFmt), f.address).toBe(normalizeNumFmt(f.numFmt));
      if (typeof f.value === 'number') expect(sameNumber(Number(cell?.value), f.value), f.address).toBe(true);
      else expect(cell?.value).toBe(f.value);
    }
  });

  it('sees formulas without cached results, except the deliberately stale one', async () => {
    const facts = corpus.facts<XlsxFacts>('xlsx-basic');
    const calc = (await xlsxWorkbook(corpus.path('xlsx-basic'))).sheet('Hesaplar');
    for (const f of facts.formulas) {
      const cell = calc.cells.get(f.address)!;
      expect(cell.formula, f.address).toBe(f.formula);
      if (f.staleCache === undefined) expect(cell.hasCachedResult, f.address).toBe(false);
      else expect(cell.value).toBe(f.staleCache);
    }
  });

  it('expandRange and normalizeNumFmt helpers', () => {
    expect(expandRange('B2:C3')).toEqual(['B2', 'C2', 'B3', 'C3']);
    expect(expandRange('range:$A$1')).toEqual(['A1']);
    expect(normalizeNumFmt('#,##0.00\\ [$₺-41F]')).toBe(normalizeNumFmt('#,##0.00 [$₺-41F]'));
    expect(normalizeNumFmt('"TL"0')).toBe('tl0');
  });
});
