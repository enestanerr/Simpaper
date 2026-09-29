import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { openPackage, patchPackage, relKind, relsPartOf, replaceOnce, resolveTarget } from '../../tools/opc';

async function sampleZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('word/document.xml', '<w:document><w:t>Iğdır</w:t></w:document>');
  zip.file('word/media/image1.png', Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('patchPackage', () => {
  it('rewrites the edited parts and keeps every other part and the part order', async () => {
    const source = await sampleZip();
    const out = await patchPackage(source, { 'word/document.xml': (xml) => replaceOnce(xml, 'Iğdır', 'İzmir') });
    const before = await openPackage(source);
    const after = await openPackage(out);
    expect(after.parts).toEqual(before.parts);
    expect(await after.text('word/document.xml')).toBe('<w:document><w:t>İzmir</w:t></w:document>');
    expect(await after.bytes('word/media/image1.png')).toEqual(await before.bytes('word/media/image1.png'));
    expect(await after.text('[Content_Types].xml')).toBe(await before.text('[Content_Types].xml'));
  });

  it('refuses edits that change nothing or name a missing part', async () => {
    const source = await sampleZip();
    await expect(patchPackage(source, { 'word/document.xml': (xml) => xml })).rejects.toThrow(/changed nothing/);
    await expect(patchPackage(source, { 'word/styles.xml': (xml) => `${xml} ` })).rejects.toThrow(/not found/);
  });
});

describe('replaceOnce', () => {
  it('replaces exactly one occurrence', () => {
    expect(replaceOnce('a<b/>c', '<b/>', '<b x="1"/>')).toBe('a<b x="1"/>c');
    expect(() => replaceOnce('abc', 'x', 'y')).toThrow(/not found/);
    expect(() => replaceOnce('a-a', 'a', 'b')).toThrow(/more than once/);
  });
});

describe('OPC names', () => {
  it('resolves relationship parts and targets', () => {
    expect(relsPartOf('')).toBe('_rels/.rels');
    expect(relsPartOf('word/document.xml')).toBe('word/_rels/document.xml.rels');
    expect(resolveTarget('word/document.xml', 'media/image1.png')).toBe('word/media/image1.png');
    expect(resolveTarget('ppt/slides/slide1.xml', '../slideLayouts/slideLayout2.xml')).toBe('ppt/slideLayouts/slideLayout2.xml');
    expect(resolveTarget('ppt/slides/slide1.xml', '/ppt/media/image1.png')).toBe('ppt/media/image1.png');
    expect(relKind('http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument')).toBe('officeDocument');
  });
});
