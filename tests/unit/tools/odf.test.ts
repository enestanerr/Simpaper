import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { odfText, odpPages, odsSheets } from '../../tools/odf';

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xlink="http://www.w3.org/1999/xlink"';

async function odf(mimetype: string, content: string, styles?: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', mimetype, { compression: 'STORE' });
  zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:body>${content}</office:body></office:document-content>`);
  if (styles) zip.file('styles.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS}>${styles}</office:document-styles>`);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('odfText', () => {
  it('extracts paragraphs with spaces/tabs/breaks, headings, headers, annotations, frames and tables', async () => {
    const doc = await odf(
      'application/vnd.oasis.opendocument.text',
      `<office:text>
        <text:h text:outline-level="1">Başlık İ</text:h>
        <text:p>a<text:s text:c="3"/>b<text:tab/>c<text:line-break/>d<office:annotation><dc:creator>Varak Test</dc:creator><text:p>yorum ğ</text:p></office:annotation></text:p>
        <text:p>önce<draw:frame><draw:text-box><text:p>kutu ş</text:p></draw:text-box></draw:frame>sonra</text:p>
        <draw:frame><draw:image xlink:href="Pictures/a.png"/></draw:frame>
        <table:table table:name="T"><table:table-row><table:table-cell><text:p>x</text:p></table:table-cell><table:table-cell><text:p>ı</text:p></table:table-cell></table:table-row></table:table>
      </office:text>`,
      `<office:master-styles><style:master-page style:name="Standard"><style:header><text:p>Üst</text:p></style:header><style:footer><text:p>Alt</text:p></style:footer></style:master-page></office:master-styles>`,
    );
    const t = await odfText(doc);
    expect(t.mimetype).toBe('application/vnd.oasis.opendocument.text');
    expect(t.paragraphs).toEqual(['Başlık İ', 'a   b\tc\nd', 'öncesonra', 'kutu ş', 'x', 'ı']);
    expect(t.headings).toEqual([{ level: 1, text: 'Başlık İ' }]);
    expect(t.annotations).toEqual([{ author: 'Varak Test', text: 'yorum ğ' }]);
    expect(t.headers).toEqual(['Üst']);
    expect(t.footers).toEqual(['Alt']);
    expect(t.images).toBe(1);
    expect(t.tables).toEqual([[['x', 'ı']]]);
  });
});

describe('odsSheets', () => {
  it('reads typed values and formulas and expands repeats without walking empty blocks', async () => {
    const doc = await odf(
      'application/vnd.oasis.opendocument.spreadsheet',
      `<office:spreadsheet><table:table table:name="Veriler">
        <table:table-row><table:table-cell office:value-type="string"><text:p>Şehir</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2" office:value-type="float" office:value="1.5"><text:p>1,5</text:p></table:table-cell></table:table-row>
        <table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>
        <table:table-row><table:table-cell table:number-columns-repeated="3"/><table:table-cell table:formula="of:=SUM([.B1:.C1])" office:value-type="float" office:value="3"><text:p>3</text:p></table:table-cell>
          <table:table-cell office:value-type="percentage" office:value="0.125"><text:p>12,50%</text:p></table:table-cell>
          <table:table-cell office:value-type="date" office:date-value="2026-09-29"><text:p>29.09.2026</text:p></table:table-cell>
          <table:table-cell office:value-type="boolean" office:boolean-value="true"><text:p>DOĞRU</text:p></table:table-cell></table:table-row>
      </table:table></office:spreadsheet>`,
    );
    const [sheet] = await odsSheets(doc);
    expect(sheet!.name).toBe('Veriler');
    expect(sheet!.cells.get('A1')).toMatchObject({ valueType: 'string', value: 'Şehir' });
    expect(sheet!.cells.get('B1')).toMatchObject({ value: 1.5 });
    expect(sheet!.cells.get('C1')).toMatchObject({ value: 1.5 });
    const row = 2 + 1048000;
    expect(sheet!.cells.get(`D${row}`)).toMatchObject({ formula: 'of:=SUM([.B1:.C1])', value: 3 });
    expect(sheet!.cells.get(`E${row}`)).toMatchObject({ valueType: 'percentage', value: 0.125 });
    expect(sheet!.cells.get(`F${row}`)).toMatchObject({ valueType: 'date', value: '2026-09-29' });
    expect(sheet!.cells.get(`G${row}`)).toMatchObject({ valueType: 'boolean', value: true });
    expect(sheet!.cells.size).toBe(7);
  });
});

describe('odpPages', () => {
  it('reads page texts, notes, pictures and tables', async () => {
    const doc = await odf(
      'application/vnd.oasis.opendocument.presentation',
      `<office:presentation>
        <draw:page draw:name="page1"><draw:frame presentation:class="title"><draw:text-box><text:p>Başlık</text:p></draw:text-box></draw:frame>
          <draw:frame><draw:image xlink:href="Pictures/p.png"/></draw:frame>
          <draw:frame><table:table><table:table-row><table:table-cell><text:p>Çay</text:p></table:table-cell></table:table-row></table:table></draw:frame>
          <presentation:notes><draw:page-thumbnail/><draw:frame presentation:class="notes"><draw:text-box><text:p>Not ğüş</text:p></draw:text-box></draw:frame></presentation:notes>
        </draw:page>
        <draw:page draw:name="page2"><draw:frame><draw:text-box><text:list><text:list-item><text:p>madde ı</text:p></text:list-item></text:list></draw:text-box></draw:frame></draw:page>
      </office:presentation>`,
    );
    const pages = await odpPages(doc);
    expect(pages).toEqual([
      { name: 'page1', texts: ['Başlık'], notes: 'Not ğüş', images: 1, tables: [[['Çay']]] },
      { name: 'page2', texts: ['madde ı'], notes: '', images: 0, tables: [] },
    ]);
  });
});
