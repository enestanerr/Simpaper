import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompatFinding } from '@shared/api/documents';
import { getFormat } from '@shared/formats';
import { chooseFormat, classifyContainer, createCompatAnalyzer } from '../../../src/main/compat/analyzer';
import { familiesFromRegistryName, fontKey, keysFromFontFile, createFontCatalog } from '../../../src/main/compat/fonts';
import { FINDING_RULES } from '../../../src/main/compat/findings';
import { readCfbFileSummary } from '../../../src/main/files/cfb';
import { buildCfb, buildOdf, buildOoxml, tinyPdf, wordDocumentStream } from './helpers/packages';
import { makeTempDir, removeDir } from './helpers/tmp';

let dir: string;
beforeAll(async () => {
  dir = await makeTempDir('compat');
});
afterAll(async () => {
  await removeDir(dir);
});

const fonts = createFontCatalog({ installed: ['Calibri', 'Arial', 'Times New Roman', 'Carlito', 'Liberation Sans', 'Segoe UI'] });
const analyzer = createCompatAnalyzer({ fonts });

async function inspect(name: string, bytes: Buffer) {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return analyzer.inspect(path);
}

function ids(findings: CompatFinding[] | undefined): string[] {
  return (findings ?? []).map((f) => f.id).sort();
}

function finding(findings: CompatFinding[] | undefined, id: CompatFinding['id']): CompatFinding | undefined {
  return findings?.find((f) => f.id === id);
}

describe('CompatAnalyzer — OOXML markers', () => {
  it('reports nothing for a plain DOCX', async () => {
    const r = await inspect('plain.docx', await buildOoxml('docx'));
    expect(r.format?.id).toBe('docx');
    expect(r.container).toBe('zip');
    expect(r.report?.findings).toEqual([]);
  });

  it('detects Word features: macros, ActiveX, SmartArt, chartEx, charts, embeddings, custom XML, signature, ink, 3D, content markers', async () => {
    const r = await inspect(
      'rich.docm',
      await buildOoxml('docm', {
        parts: {
          'word/vbaProject.bin': new Uint8Array([1, 2, 3]),
          'word/activeX/activeX1.xml': '<ax/>',
          'word/diagrams/data1.xml': '<dgm/>',
          'word/charts/chart1.xml': '<c/>',
          'word/charts/chartEx1.xml': '<cx/>',
          'word/embeddings/Microsoft_Excel_Worksheet.xlsx': new Uint8Array([0x50, 0x4b]),
          'customXml/item1.xml': '<b:Sources xmlns:b="x"/>',
          '_xmlsignatures/sig1.xml': '<Signature/>',
          'word/ink/ink1.xml': '<inkml/>',
          'word/media/model.glb': new Uint8Array([0]),
          'word/media/clip.mp4': new Uint8Array([0]),
          'word/document.xml':
            '<w:document xmlns:w="w" xmlns:m="m"><w:body><w:ins w:id="1"><w:r/></w:ins><w:del w:id="2"/><w:sdt><w:sdtPr/></w:sdt><m:oMathPara><m:oMath/></m:oMathPara></w:body></w:document>',
        },
      }),
    );
    expect(r.format?.id).toBe('docm');
    expect(ids(r.report?.findings)).toEqual(
      [
        'activeX',
        'chartEx',
        'charts',
        'contentControls',
        'customXml',
        'digitalSignature',
        'embeddedObjects',
        'equations',
        'ink',
        'macros',
        'media',
        'model3d',
        'smartArt',
        'trackedChanges',
      ].sort(),
    );
    expect(finding(r.report?.findings, 'trackedChanges')?.count).toBe(2);
    expect(finding(r.report?.findings, 'chartEx')?.severity).toBe('risk');
    expect(finding(r.report?.findings, 'smartArt')?.severity).toBe('warning');
    expect(finding(r.report?.findings, 'macros')?.messageKey).toBe('compat.finding.macros');
    // Most severe first
    const sev = (r.report?.findings ?? []).map((f) => f.severity);
    expect(sev.indexOf('risk')).toBeLessThan(sev.lastIndexOf('info'));
  });

  it('detects Excel features: pivots, slicers, timelines, external links, Power Query, data model, threaded comments', async () => {
    const r = await inspect(
      'model.xlsx',
      await buildOoxml('xlsx', {
        parts: {
          'xl/pivotTables/pivotTable1.xml': '<p/>',
          'xl/slicers/slicer1.xml': '<s/>',
          'xl/slicerCaches/slicerCache1.xml': '<s/>',
          'xl/timelines/timeline1.xml': '<t/>',
          'xl/externalLinks/externalLink1.xml': '<e/>',
          'xl/connections.xml': '<connections><connection name="Query - Tablo1"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$"/></connection></connections>',
          'xl/model/item.data': new Uint8Array([0]),
          'xl/threadedComments/threadedComment1.xml': '<tc/>',
          'xl/styles.xml': '<styleSheet><fonts count="2"><font><name val="Calibri"/></font><font><name val="Aptos Narrow"/></font></fonts></styleSheet>',
        },
      }),
    );
    expect(ids(r.report?.findings)).toEqual(['dataModel', 'externalLinks', 'missingFonts', 'pivotTables', 'powerQuery', 'slicers', 'threadedComments', 'timelines'].sort());
    expect(finding(r.report?.findings, 'slicers')?.count).toBe(2);
    expect(finding(r.report?.findings, 'missingFonts')?.detail).toEqual(['Aptos Narrow']);
  });

  it('detects Power Query from the DataMashup custom XML item (not counted as custom XML)', async () => {
    const r = await inspect(
      'mashup.xlsx',
      await buildOoxml('xlsx', { parts: { 'customXml/item1.xml': '<?xml version="1.0"?><DataMashup xmlns="http://schemas.microsoft.com/DataMashup">AAAA</DataMashup>' } }),
    );
    expect(ids(r.report?.findings)).toEqual(['powerQuery']);
  });

  it('detects PowerPoint features: Morph, inline equations, modern comments, theme fonts, embedded fonts', async () => {
    const r = await inspect(
      'deck.pptx',
      await buildOoxml('pptx', {
        parts: {
          'ppt/slides/slide1.xml': '<p:sld><p:transition><p159:morph option="byObject"/></p:transition><a:latin typeface="Aptos"/><a14:m><m:oMath/></a14:m></p:sld>',
          'ppt/slides/slide2.xml': '<p:sld><a:latin typeface="+mn-lt"/><a:latin typeface="Segoe UI"/></p:sld>',
          'ppt/comments/modernComment_1.xml': '<p188:cmLst/>',
          'ppt/theme/theme1.xml': '<a:theme><a:fontScheme><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="MS Gothic"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:theme>',
          'ppt/presentation.xml': '<p:presentation><p:embeddedFontLst><p:embeddedFont><p:font typeface="Fancy Font"/></p:embeddedFont></p:embeddedFontLst></p:presentation>',
          'ppt/slideLayouts/slideLayout1.xml': '<p:sldLayout><a:latin typeface="Fancy Font"/></p:sldLayout>',
        },
      }),
    );
    expect(ids(r.report?.findings)).toEqual(['equations', 'fontEmbedding', 'missingFonts', 'morphTransition', 'threadedComments']);
    expect(finding(r.report?.findings, 'missingFonts')?.detail).toEqual(['Aptos', 'Aptos Display']);
    expect(finding(r.report?.findings, 'equations')?.severity).toBe('warning');
  });

  it('reports Word font table and theme fonts, skipping CJK fallback fonts and embedded fonts', async () => {
    const r = await inspect(
      'fonts.docx',
      await buildOoxml('docx', {
        parts: {
          'word/fontTable.xml':
            '<w:fonts><w:font w:name="Calibri"><w:charset w:val="00"/></w:font><w:font w:name="MS Mincho"><w:charset w:val="80"/></w:font><w:font w:name="Cambria"/><w:font w:name="Gömülü Yazı"><w:embedRegular r:id="rId1"/></w:font><w:font w:name="Aptos"/></w:fonts>',
          'word/theme/theme1.xml': '<a:theme><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:theme>',
        },
      }),
    );
    // Cambria is not installed in this catalogue and Caladea is not available either.
    expect(finding(r.report?.findings, 'missingFonts')?.detail).toEqual(['Aptos', 'Aptos Display', 'Cambria']);
    expect(finding(r.report?.findings, 'fontEmbedding')?.count).toBe(1);
  });

  it('flags Strict Open XML', async () => {
    const r = await inspect('strict.docx', await buildOoxml('docx', { strict: true }));
    expect(ids(r.report?.findings)).toEqual(['strictOoxml']);
  });

  it('flags macro-enabled templates as template macros', async () => {
    const r = await inspect('sablon.dotm', await buildOoxml('dotm', { parts: { 'word/vbaProject.bin': new Uint8Array([1]) } }));
    expect(r.format?.id).toBe('dotm');
    expect(finding(r.report?.findings, 'templateMacros')?.severity).toBe('risk');
  });

  it('uses the content type when the extension lies (xlsx named .csv)', async () => {
    const r = await inspect('actually-a-workbook.csv', await buildOoxml('xlsx'));
    expect(r.format?.id).toBe('xlsx');
  });
});

describe('CompatAnalyzer — ODF, PDF, text and compound files', () => {
  it('inspects ODF packages', async () => {
    const r = await inspect(
      'metin.odt',
      await buildOdf('application/vnd.oasis.opendocument.text', {
        'Basic/Standard/Module1.xml': '<script:module/>',
        'Basic/Standard/script-lb.xml': '<library/>',
        'META-INF/documentsignatures.xml': '<sig/>',
        'Object 1/content.xml': '<office:document-content><office:body><office:chart><chart:chart/></office:chart></office:body></office:document-content>',
        'Object 2/content.xml': '<math xmlns="http://www.w3.org/1998/Math/MathML"/>',
        'content.xml': '<office:document-content><office:font-face-decls><style:font-face style:name="A" svg:font-family="&apos;Liberation Sans&apos;"/><style:font-face style:name="B" svg:font-family="Aptos"/></office:font-face-decls><text:tracked-changes><text:changed-region/></text:tracked-changes></office:document-content>',
      }),
    );
    expect(r.format?.id).toBe('odt');
    expect(ids(r.report?.findings)).toEqual(['charts', 'digitalSignature', 'equations', 'macros', 'missingFonts', 'trackedChanges']);
    expect(finding(r.report?.findings, 'missingFonts')?.detail).toEqual(['Aptos']);
  });

  it('marks encrypted ODF packages', async () => {
    const r = await inspect(
      'gizli.ods',
      await buildOdf('application/vnd.oasis.opendocument.spreadsheet', {
        'META-INF/manifest.xml': '<manifest:manifest><manifest:file-entry manifest:full-path="content.xml"><manifest:encryption-data/></manifest:file-entry></manifest:manifest>',
      }),
    );
    expect(r.encrypted).toBe(true);
    expect(ids(r.report?.findings)).toEqual(['encryption']);
  });

  it('recognises PDFs even with a wrong extension, and returns no office report', async () => {
    const r = await inspect('scan.docx', tinyPdf());
    expect(r.format?.id).toBe('pdf');
    expect(r.report).toBeNull();
  });

  it('treats RTF saved as .doc as RTF', async () => {
    const r = await inspect('eski.doc', Buffer.from('{\\rtf1\\ansi hello}', 'latin1'));
    expect(r.format?.id).toBe('rtf');
  });

  it('recognises password-encrypted OOXML (EncryptedPackage in a compound file)', async () => {
    const cfb = buildCfb([
      { name: 'EncryptionInfo', type: 'stream', data: Buffer.alloc(600, 1) },
      { name: 'EncryptedPackage', type: 'stream', data: Buffer.alloc(700, 2) },
      { name: '\u0006DataSpaces', type: 'storage' },
      { name: 'StrongEncryptionDataSpace', type: 'stream', data: Buffer.alloc(10) },
    ]);
    const summary = await (async () => {
      const p = join(dir, 'probe.cfb');
      await writeFile(p, cfb);
      return readCfbFileSummary(p);
    })();
    expect(summary.entries.map((e) => e.name)).toContain('EncryptedPackage');
    const r = await inspect('gizli.xlsx', cfb);
    expect(r.container).toBe('cfb');
    expect(r.format?.id).toBe('xlsx');
    expect(r.encrypted).toBe(true);
    expect(r.irm).toBe(false);
    expect(finding(r.report?.findings, 'encryption')?.severity).toBe('warning');
  });

  it('recognises rights-managed (IRM) packages', async () => {
    const cfb = buildCfb([
      { name: 'EncryptionInfo', type: 'stream', data: Buffer.alloc(8) },
      { name: 'EncryptedPackage', type: 'stream', data: Buffer.alloc(8) },
      { name: 'DRMEncryptedDataSpace', type: 'stream', data: Buffer.alloc(8) },
    ]);
    const r = await inspect('irm.docx', cfb);
    expect(r.irm).toBe(true);
  });

  it('inspects legacy Word binaries: format, encryption flag, macros', async () => {
    const plain = await inspect('eski.doc', buildCfb([{ name: 'WordDocument', type: 'stream', data: wordDocumentStream(false) }, { name: 'Macros', type: 'storage' }]));
    expect(plain.format?.id).toBe('doc');
    expect(plain.encrypted).toBe(false);
    expect(ids(plain.report?.findings)).toEqual(['legacyFormat', 'macros']);

    const locked = await inspect('kilitli.doc', buildCfb([{ name: 'WordDocument', type: 'stream', data: wordDocumentStream(true) }]));
    expect(locked.encrypted).toBe(true);
    expect(ids(locked.report?.findings)).toEqual(['encryption', 'legacyFormat']);
  });

  it('detects the Excel FILEPASS record (regular sectors)', async () => {
    const book = Buffer.alloc(8192);
    book.writeUInt16LE(0x0809, 0);
    book.writeUInt16LE(16, 2);
    book.writeUInt16LE(0x002f, 20);
    book.writeUInt16LE(4, 22);
    const r = await inspect('kilitli.xls', buildCfb([{ name: 'Workbook', type: 'stream', data: book }]));
    expect(r.format?.id).toBe('xls');
    expect(r.encrypted).toBe(true);
  });

  it('reads small streams from the mini stream (tiny encrypted workbook, unencrypted one)', async () => {
    const small = (encrypted: boolean) => {
      const b = Buffer.alloc(300);
      b.writeUInt16LE(0x0809, 0);
      b.writeUInt16LE(16, 2);
      b.writeUInt16LE(encrypted ? 0x002f : 0x0042, 20);
      b.writeUInt16LE(4, 22);
      return b;
    };
    const locked = await inspect('mini-kilitli.xls', buildCfb([{ name: 'Workbook', type: 'stream', data: small(true) }, { name: 'SummaryInformation', type: 'stream', data: Buffer.alloc(100, 7) }]));
    expect(locked.encrypted).toBe(true);
    const open = await inspect('mini-acik.xls', buildCfb([{ name: 'Workbook', type: 'stream', data: small(false) }]));
    expect(open.encrypted).toBe(false);
    const p = join(dir, 'mini-probe.xls');
    await writeFile(p, buildCfb([{ name: 'Book', type: 'stream', data: Buffer.from('0123456789abcdef'.repeat(10)) }]));
    const summary = await readCfbFileSummary(p, ['Book'], 32);
    expect(summary.heads.get('Book')?.toString('latin1')).toBe('0123456789abcdef0123456789abcdef');
  });

  it('refuses nothing for encrypted PPT but marks it as unsupported encryption', async () => {
    const r = await inspect('sunu.ppt', buildCfb([{ name: 'PowerPoint Document', type: 'stream', data: Buffer.alloc(4096) }, { name: 'EncryptedSummary', type: 'stream', data: Buffer.alloc(16) }]));
    expect(r.format?.id).toBe('ppt');
    expect(r.unsupportedEncryption).toBe(true);
    expect(finding(r.report?.findings, 'encryption')?.severity).toBe('risk');
  });

  it('classifies containers and chooses formats', () => {
    expect(classifyContainer(Buffer.from('PK\u0003\u0004rest', 'latin1'))).toBe('zip');
    expect(classifyContainer(Buffer.from('a;b;c\n1;2;3\n'))).toBe('text');
    expect(classifyContainer(Buffer.from([0, 1, 2, 0, 5]))).toBe('unknown');
    expect(chooseFormat(getFormat('docx'), 'zip', getFormat('xlsx'))?.id).toBe('xlsx');
    expect(chooseFormat(getFormat('docx'), 'zip', getFormat('docm'))?.id).toBe('docx');
    expect(chooseFormat(undefined, 'rtf', undefined)?.id).toBe('rtf');
    expect(chooseFormat(getFormat('csv'), 'text', undefined)?.id).toBe('csv');
  });
});

describe('font catalogue', () => {
  it('parses registry value names and font file names', () => {
    expect(familiesFromRegistryName('Cambria & Cambria Math (TrueType)')).toEqual(['Cambria', 'Cambria Math']);
    expect(familiesFromRegistryName('Arial Bold Italic (TrueType)')).toEqual(['Arial Bold Italic', 'Arial']);
    expect(keysFromFontFile('LiberationSans-Bold.ttf')).toEqual(['liberationsansbold', 'liberationsans']);
    expect(fontKey('Liberation Sans')).toBe('liberationsans');
  });

  it('knows metric-compatible substitutes only when the substitute is available', () => {
    const catalog = createFontCatalog({ installed: ['Carlito', 'Liberation Serif'] });
    expect(catalog.status('Calibri')).toBe('substituted');
    expect(catalog.substituteFor('Times New Roman')).toBe('Liberation Serif');
    expect(catalog.status('Cambria')).toBe('missing');
    expect(catalog.status('Aptos')).toBe('missing');
    expect(catalog.status('carlito')).toBe('installed');
  });

  it('uses engine font folders and the file-name fallback', () => {
    const catalog = createFontCatalog({ readRegistry: () => null, systemFontDirs: () => [], engineFontDirs: () => [] });
    expect(catalog.status('Segoe UI')).toBe('missing');
  });

  it.runIf(process.platform === 'win32')('reads installed fonts from the Windows registry', () => {
    const catalog = createFontCatalog();
    expect(catalog.status('Arial')).toBe('installed');
    expect(catalog.status('Definitely Not A Font 123')).toBe('missing');
  });
});

describe('finding rules', () => {
  it('has a rule for every finding id', () => {
    const all: CompatFinding['id'][] = [
      'macros', 'activeX', 'embeddedObjects', 'smartArt', 'chartEx', 'charts', 'pivotTables', 'slicers', 'timelines', 'externalLinks',
      'powerQuery', 'dataModel', 'threadedComments', 'trackedChanges', 'contentControls', 'equations', 'ink', 'model3d', 'media',
      'morphTransition', 'customXml', 'digitalSignature', 'encryption', 'strictOoxml', 'legacyFormat', 'templateMacros', 'missingFonts', 'fontEmbedding',
    ];
    for (const id of all) expect(FINDING_RULES[id], id).toBeDefined();
  });
});
