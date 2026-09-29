import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getFormat } from '@shared/formats';
import { createCompatAnalyzer } from '../../../src/main/compat/analyzer';
import { createFontCatalog } from '../../../src/main/compat/fonts';
import { verifyPdfFile, verifySavedFile } from '../../../src/main/documents/verify';
import { buildCfb, buildOdf, buildOoxml, tinyPdf, wordDocumentStream } from './helpers/packages';
import { makeTempDir, removeDir } from './helpers/tmp';

let dir: string;
beforeAll(async () => {
  dir = await makeTempDir('verify');
});
afterAll(async () => {
  await removeDir(dir);
});

async function file(name: string, bytes: Buffer | string): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, bytes);
  return p;
}

/** LibreOffice 26.8 password-protected ODF: one `encrypted-package` entry instead of content.xml. */
async function wholesomeEncryptedOds(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet', { compression: 'STORE' });
  zip.file('encrypted-package', new Uint8Array([9, 8, 7, 6]));
  zip.file(
    'META-INF/manifest.xml',
    '<manifest:manifest manifest:version="1.4"><manifest:file-entry manifest:full-path="encrypted-package"><manifest:encryption-data><manifest:algorithm manifest:algorithm-name="http://www.w3.org/2009/xmlenc11#aes256-gcm"/></manifest:encryption-data></manifest:file-entry></manifest:manifest>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('verifySavedFile', () => {
  it('accepts well-formed packages of every family', async () => {
    await verifySavedFile(await file('a.docx', await buildOoxml('docx')), { format: getFormat('docx'), encrypted: false });
    await verifySavedFile(await file('a.odt', await buildOdf('application/vnd.oasis.opendocument.text')), { format: getFormat('odt'), encrypted: false });
    await verifySavedFile(await file('a.doc', buildCfb([{ name: 'WordDocument', type: 'stream', data: wordDocumentStream(false) }])), { format: getFormat('doc'), encrypted: false });
    await verifySavedFile(await file('a.csv', ''), { format: getFormat('csv'), encrypted: false });
    await verifyPdfFile(await file('a.pdf', tinyPdf()));
  });

  it('rejects truncated, empty or wrong containers', async () => {
    const docx = await buildOoxml('docx');
    await expect(verifySavedFile(await file('t.docx', docx.subarray(0, docx.length - 30)), { format: getFormat('docx'), encrypted: false })).rejects.toThrow();
    await expect(verifySavedFile(await file('e.xlsx', ''), { format: getFormat('xlsx'), encrypted: false })).rejects.toThrow('empty file');
    await expect(verifySavedFile(await file('w.doc', docx), { format: getFormat('doc'), encrypted: false })).rejects.toThrow('not a compound file');
    await expect(verifySavedFile(await file('x.xls', buildCfb([{ name: 'WordDocument', type: 'stream', data: wordDocumentStream(false) }])), { format: getFormat('xls'), encrypted: false })).rejects.toThrow('main stream missing');
    await expect(verifyPdfFile(await file('b.pdf', '%PDF-1.7 but no trailer'.padEnd(200, ' ')))).rejects.toThrow('PDF trailer missing');
  });

  it('checks zip CRCs (a flipped byte in compressed data fails)', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>'.repeat(200));
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const at = bytes.indexOf('<Types/>') + 3;
    bytes[at] = 0x21;
    await expect(verifySavedFile(await file('crc.docx', bytes), { format: getFormat('docx'), encrypted: false })).rejects.toThrow();
  });

  it('accepts password-protected outputs: OOXML as compound file, ODF with an encrypted package entry', async () => {
    const cfb = buildCfb([{ name: 'EncryptionInfo', type: 'stream', data: Buffer.alloc(8) }, { name: 'EncryptedPackage', type: 'stream', data: Buffer.alloc(8) }]);
    await verifySavedFile(await file('enc.xlsx', cfb), { format: getFormat('xlsx'), encrypted: true });
    const ods = await file('enc.ods', await wholesomeEncryptedOds());
    await verifySavedFile(ods, { format: getFormat('ods'), encrypted: true });
    await expect(verifySavedFile(ods, { format: getFormat('ods'), encrypted: false })).rejects.toThrow('ODF parts missing');
  });

  it('runs the optional re-open check last', async () => {
    const calls: string[] = [];
    const p = await file('r.docx', await buildOoxml('docx'));
    await verifySavedFile(p, { format: getFormat('docx'), encrypted: false, reopen: async (path) => void calls.push(path) });
    expect(calls).toEqual([p]);
  });

  it('the analyzer recognises the encrypted ODF package', async () => {
    const analyzer = createCompatAnalyzer({ fonts: createFontCatalog({ installed: [] }) });
    const r = await analyzer.inspect(await file('gizli.ods', await wholesomeEncryptedOds()));
    expect(r).toMatchObject({ encrypted: true, format: { id: 'ods' } });
    expect(r.report?.findings.map((f) => f.id)).toEqual(['encryption']);
  });
});
