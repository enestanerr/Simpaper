#!/usr/bin/env node
/**
 * Pinned list of the vendored third-party samples (tests/corpus/third_party/<source>/) — the single
 * source of truth for their URLs, hashes, licences and what they exercise.
 *
 *   node scripts/corpus/third-party.mjs            verify (offline): pinned SHA-256 of every sample and licence
 *                                                  file, no unpinned file in the folders, generated docs in sync
 *   node scripts/corpus/third-party.mjs --fetch    download missing/mismatching files from the pinned URLs
 *   node scripts/corpus/third-party.mjs --docs     rewrite manifest.json and each ATTRIBUTION.md from this list
 *
 * All samples are unmodified copies. Selection and licence review: docs/research/corpus.md.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const THIRD_PARTY_DIR = join(ROOT, 'tests', 'corpus', 'third_party');

export const SOURCES = {
  'apache-poi': {
    name: 'Apache POI test-data',
    repository: 'https://github.com/apache/poi',
    commit: '581a4cba5973743e35482163c8848ced8b7ae4f0',
    base: 'https://raw.githubusercontent.com/apache/poi/581a4cba5973743e35482163c8848ced8b7ae4f0/',
    license: 'Apache-2.0',
    copyright: 'The Apache Software Foundation and contributors (see NOTICE)',
    legal: [
      { file: 'LICENSE', path: 'legal/LICENSE', sha256: '6e7c918e5a49f677c1b85a9eb2d035cd85c217fc42af6b4a336964a434001a9c' },
      { file: 'NOTICE', path: 'legal/NOTICE', sha256: 'a89ff8b670bcacd3e98ebee64979e0569181c7942e9ad795f4222b25e5637a61' },
    ],
    passwordSource: 'test-data/poi-integration-exceptions.csv',
  },
  'apache-pdfbox': {
    name: 'Apache PDFBox test resources',
    repository: 'https://github.com/apache/pdfbox',
    commit: 'b29f6d6f995f0aa0602e9c3b55031f295920d354',
    base: 'https://raw.githubusercontent.com/apache/pdfbox/b29f6d6f995f0aa0602e9c3b55031f295920d354/',
    license: 'Apache-2.0',
    copyright: 'The Apache Software Foundation and contributors (see NOTICE.txt)',
    legal: [
      { file: 'LICENSE.txt', path: 'LICENSE.txt', sha256: '1301d8415a4868d82aeeec594849cf7679f1ead4636a9603dc46875f5713157e' },
      { file: 'NOTICE.txt', path: 'NOTICE.txt', sha256: '40741b4ab76d77ba4fbc5e8759277169fb0ce281859d273075de6fd3a3588458' },
    ],
  },
};

/**
 * `producer`: application recorded in the file (docProps/app.xml, the OLE summary stream or the PDF XMP).
 * `expect`: facts the engine tests rely on.
 */
export const SAMPLES = [
  {
    id: 'poi-macro-docm', source: 'apache-poi', file: 'SimpleMacro.docm', path: 'test-data/document/SimpleMacro.docm', bytes: 15_517,
    sha256: 'fd591958fcf5322f72c0a740e9606309c949254bda4c3d9bd966481ddf220563', producer: 'Microsoft Office Word 12.0',
    features: ['macros', 'vba'], exercises: 'VBA project (word/vbaProject.bin) must survive a round trip; macros must never run.',
    expect: { vbaPart: 'word/vbaProject.bin', saveFilter: 'MS Word 2007 XML VBA' },
  },
  {
    id: 'poi-macro-xlsm', source: 'apache-poi', file: 'SimpleMacro.xlsm', path: 'test-data/spreadsheet/SimpleMacro.xlsm', bytes: 13_796,
    sha256: 'f76c986f4ebc25c2cc57c088b2511a1269f4bd61d6223a2ab58db351da348ba6', producer: 'Microsoft Excel 14.0',
    features: ['macros', 'vba'], exercises: 'VBA project (xl/vbaProject.bin) preservation in a macro-enabled workbook.',
    expect: { vbaPart: 'xl/vbaProject.bin', saveFilter: 'Calc MS Excel 2007 VBA XML' },
  },
  {
    id: 'poi-macro-pptm', source: 'apache-poi', file: 'SimpleMacro.pptm', path: 'test-data/slideshow/SimpleMacro.pptm', bytes: 41_578,
    sha256: '8a3573c82fd07a301d7f175b8bee646c0b58eb8a945bd0ff408225b6e2b89b15', producer: 'Microsoft Office PowerPoint 12.0',
    features: ['macros', 'vba'], exercises: 'VBA project (ppt/vbaProject.bin) preservation in a macro-enabled presentation.',
    expect: { vbaPart: 'ppt/vbaProject.bin', saveFilter: 'Impress MS PowerPoint 2007 XML VBA' },
  },
  {
    id: 'poi-smartart-pptx', source: 'apache-poi', file: 'SmartArt.pptx', path: 'test-data/slideshow/SmartArt.pptx', bytes: 41_382,
    sha256: 'b97e4c6d2ee1dd4094f50f9043820610268dd452d7717c537f5456636adcc353', producer: 'Microsoft Office PowerPoint 16.0',
    features: ['smartart', 'diagrams'], exercises: 'SmartArt diagram parts (ppt/diagrams/*: data, layout, quickStyle, colors, drawing).',
    expect: { partPattern: '^ppt/diagrams/', partCount: 5 },
  },
  {
    id: 'poi-charts-xlsx', source: 'apache-poi', file: 'WithTwoCharts.xlsx', path: 'test-data/spreadsheet/WithTwoCharts.xlsx', bytes: 12_810,
    sha256: '7d29c92e9f7968a5bc9ec076458785295c24d13916b02b8a467c0a8fd013cddd', producer: 'Microsoft Excel 12.0',
    features: ['charts'], exercises: 'Two DrawingML charts on worksheets.',
    expect: { partPattern: '^xl/charts/chart\\d+\\.xml$', partCount: 2 },
  },
  {
    id: 'poi-charts-docx', source: 'apache-poi', file: 'chartex.docx', path: 'test-data/document/chartex.docx', bytes: 133_304,
    sha256: '5d7f0ca9aa26d0244eedbc8ff862f08910689ec3848a036c622b17d56a290b57', producer: 'Microsoft Office Word 16.0',
    features: ['charts', 'chartex'],
    exercises: 'Six charts in a Word document: bar, line, radar, stock (DrawingML) and two Office 2016 chartEx charts (cx:chartSpace in word/charts/chart4.xml and chart6.xml, each with a picture fallback in mc:AlternateContent).',
    expect: { classicCharts: 4, chartExParts: ['word/charts/chart4.xml', 'word/charts/chart6.xml'] },
  },
  {
    id: 'poi-pivot-xlsx', source: 'apache-poi', file: 'ExcelPivotTableSample.xlsx', path: 'test-data/spreadsheet/ExcelPivotTableSample.xlsx', bytes: 19_460,
    sha256: 'f0ef1d61c9f3d8b27b18a876b8e24676314c6450ed64a725a7bfaa603fdd67e3', producer: 'Microsoft Excel 16.0',
    features: ['pivot-table', 'table'], exercises: 'Two pivot tables with pivot caches (xl/pivotTables, xl/pivotCache).',
    expect: { partPattern: '^xl/pivot(Tables|Cache)/[^/]+\\.xml$', partCount: 6 },
  },
  {
    id: 'poi-encrypted-docx', source: 'apache-poi', file: 'bug53475-password-is-pass.docx', path: 'test-data/document/bug53475-password-is-pass.docx', bytes: 29_696,
    sha256: 'c182f7825ae588fe1c28497588d1bded635a5bef7eb7370fd1c589233a6471d5', producer: 'Microsoft Office (ECMA-376 Agile encryption container)',
    features: ['password', 'encrypted', 'agile-encryption'], password: 'pass',
    exercises: 'Password-protected DOCX (Agile encryption, AES-256/SHA-1); must prompt for the password, never load as something else.',
    expect: { encrypted: true },
  },
  {
    id: 'poi-encrypted-xlsx', source: 'apache-poi', file: 'protected_passtika.xlsx', path: 'test-data/spreadsheet/protected_passtika.xlsx', bytes: 12_800,
    sha256: 'e58713895915de62efead6d99018245cc5490cddd2493c84508b4a67fb001581', producer: 'Microsoft Office (ECMA-376 Standard encryption container)',
    features: ['password', 'encrypted', 'standard-encryption'], password: 'tika',
    exercises: 'Password-protected XLSX (Standard encryption); must prompt for the password.',
    expect: { encrypted: true },
  },
  {
    id: 'poi-tracked-changes-docx', source: 'apache-poi', file: 'delins.docx', path: 'test-data/document/delins.docx', bytes: 17_720,
    sha256: '7ecad102602586be7f1371f117fc567ea47f3ed0ca703b353e003002f1ff8d3f', producer: 'Microsoft Office Word 12.0',
    features: ['tracked-changes'], exercises: 'Tracked changes written by Word (32 w:ins and 4 w:del elements).',
    expect: { insElements: 32, delElements: 4 },
  },
  {
    id: 'poi-legacy-doc', source: 'apache-poi', file: 'SampleDoc.doc', path: 'test-data/document/SampleDoc.doc', bytes: 27_136,
    sha256: '717585c0a88f20862c86220163dd03da87cd743970354c6b29add32725f2e833', producer: 'Microsoft Office Word 97 (binary .doc)',
    features: ['legacy-binary'], exercises: 'Word 97–2003 binary document import (two pages, second in Arial Black).',
    expect: { texts: ['I am a test document', 'This is page 1', 'This is page two'] },
  },
  {
    id: 'poi-legacy-xls', source: 'apache-poi', file: 'SampleSS.xls', path: 'test-data/spreadsheet/SampleSS.xls', bytes: 17_408,
    sha256: '53c9bd7337aa79fedf29cef8d81ec47fff39f80e25da9d74bc354cfdf1c43b73', producer: 'Microsoft Office Excel 2003 (binary .xls)',
    features: ['legacy-binary'], exercises: 'Excel 97–2003 binary workbook import (three sheets, coloured and bold text).',
    expect: { sheets: ['First Sheet', 'Sheet Number 2', 'Sheet3'], texts: ['Test spreadsheet', '2nd row 2nd column', 'This one is red', "I'm in bold blue, on a yellow background"] },
  },
  {
    id: 'poi-legacy-ppt', source: 'apache-poi', file: 'SampleShow.ppt', path: 'test-data/slideshow/SampleShow.ppt', bytes: 125_440,
    sha256: '64275a6685b8f267827178037dcc59de927475e56385725916f4c6039c7ce7f6', producer: 'Microsoft Office PowerPoint (binary .ppt)',
    features: ['legacy-binary'], exercises: 'PowerPoint 97–2003 binary presentation import (two slides).',
    expect: { slides: 2, texts: ['Title of the first slide', 'Subtitle of the first slide', 'This is the second slide', 'It has bullet points on it'] },
  },
  {
    id: 'poi-notes-pptx', source: 'apache-poi', file: 'SampleShow.pptx', path: 'test-data/slideshow/SampleShow.pptx', bytes: 39_083,
    sha256: 'bfb4b2f07c9233afd2f32aa5781d849d0c7d225bf03721a10becf487b481d828', producer: 'Microsoft Office PowerPoint 16.0',
    features: ['speaker-notes'], exercises: 'Office-written two-slide deck (title slide; bullet slide using a second font) with notes slides.',
    expect: { slides: 2, notesSlides: 2, texts: ['Title of the first slide', 'Subtitle of the first slide', 'This is the second slide', 'It has bullet points on it'] },
  },
  {
    id: 'pdfbox-acroform', source: 'apache-pdfbox', file: 'AcroFormsBasicFields.pdf', path: 'pdfbox/src/test/resources/org/apache/pdfbox/pdmodel/interactive/form/AcroFormsBasicFields.pdf', bytes: 170_599,
    sha256: '73d05cfd3a3c30ee919f0cc112f331ff874f4a4dec8ba9792877c81c312b226d', producer: 'Adobe Acrobat 10',
    features: ['acroform', 'real-world-form'],
    exercises: 'Real Acrobat-made AcroForm on one page: 6 text fields, 10 check boxes, 4 radio buttons, 2 list boxes, 2 combo boxes, a push button and a signature field (26 widgets).',
    expect: { widgets: { Tx: 6, 'Btn:checkbox': 10, 'Btn:radio': 4, 'Ch:list': 2, 'Ch:combo': 2, 'Btn:push': 1, Sig: 1 } },
  },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function allEntries() {
  const entries = [];
  for (const [key, src] of Object.entries(SOURCES)) for (const l of src.legal) entries.push({ source: key, file: l.file, url: src.base + l.path, sha256: l.sha256 });
  for (const s of SAMPLES) entries.push({ source: s.source, file: s.file, url: SOURCES[s.source].base + s.path, sha256: s.sha256 });
  return entries;
}

/** Files the tooling writes next to the samples (not downloaded, not pinned by hash). */
const GENERATED_DOCS = new Set(['ATTRIBUTION.md']);

/**
 * Verifies the vendored corpus offline; returns the problems found (empty = OK):
 * every pinned file exists with its SHA-256, every file in a source folder is pinned (so none can be
 * committed without URL, licence and hash), and manifest.json / ATTRIBUTION.md match this list.
 * @param {string} [dir] folder to verify (default tests/corpus/third_party)
 */
export function verify(dir = THIRD_PARTY_DIR) {
  const problems = [];
  const entries = allEntries();
  for (const e of entries) {
    const p = join(dir, e.source, e.file);
    if (!existsSync(p)) problems.push(`missing ${e.source}/${e.file}`);
    else if (sha256(readFileSync(p)) !== e.sha256) problems.push(`hash mismatch ${e.source}/${e.file}`);
  }
  if (!existsSync(dir)) return problems;
  const pinned = new Set(entries.map((e) => `${e.source}/${e.file}`));
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (!item.isDirectory()) {
      if (!['manifest.json', '.gitattributes'].includes(item.name)) problems.push(`unexpected file ${item.name} (samples go into a source folder)`);
      continue;
    }
    if (!Object.hasOwn(SOURCES, item.name)) {
      problems.push(`unknown source folder ${item.name} (add it to SOURCES with repository, commit, licence and legal files)`);
      continue;
    }
    for (const file of readdirSync(join(dir, item.name))) {
      if (!GENERATED_DOCS.has(file) && !pinned.has(`${item.name}/${file}`)) {
        problems.push(`unpinned file ${item.name}/${file} (add it to SAMPLES with its URL, SHA-256 and what it exercises)`);
      }
    }
  }
  const docs = renderDocs();
  const current = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
  if (current(join(dir, 'manifest.json')) !== docs.manifest) problems.push('manifest.json is out of date (run node scripts/corpus/third-party.mjs --docs)');
  for (const [key, md] of Object.entries(docs.attributions)) {
    if (current(join(dir, key, 'ATTRIBUTION.md')) !== md) problems.push(`${key}/ATTRIBUTION.md is out of date (run node scripts/corpus/third-party.mjs --docs)`);
  }
  return problems;
}

async function fetchMissing() {
  for (const e of allEntries()) {
    const p = join(THIRD_PARTY_DIR, e.source, e.file);
    if (existsSync(p) && sha256(readFileSync(p)) === e.sha256) continue;
    const res = await fetch(e.url);
    if (!res.ok) throw new Error(`${e.url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== e.sha256) throw new Error(`${e.url}: SHA-256 mismatch (pinned ${e.sha256})`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, buf);
    console.log(`fetched ${e.source}/${e.file} (${buf.length} bytes)`);
  }
}

/**
 * Content of manifest.json and of each source folder's ATTRIBUTION.md, generated from SOURCES/SAMPLES.
 * @returns {{ manifest: string, attributions: Record<string, string> }}
 */
export function renderDocs() {
  const manifest = {
    schema: 1,
    note: 'Generated by scripts/corpus/third-party.mjs --docs. Unmodified copies; see ATTRIBUTION.md in each folder.',
    sources: SOURCES,
    files: SAMPLES.map((s) => ({ ...s, path: `${s.source}/${s.file}`, url: SOURCES[s.source].base + s.path, license: SOURCES[s.source].license })),
  };
  /** @type {Record<string, string>} */
  const attributions = {};
  for (const [key, src] of Object.entries(SOURCES)) {
    const rows = SAMPLES.filter((s) => s.source === key).map(
      (s) => `| \`${s.file}\` | ${s.bytes.toLocaleString('en-US')} | [${s.path}](${src.base}${s.path}) | ${src.license} | ${s.producer} | ${s.exercises}${s.password ? ` Password: \`${s.password}\`.` : ''} |`,
    );
    const md = [
      `# ${src.name} — attribution`,
      '',
      `Unmodified copies of files from [${src.repository}](${src.repository}) at commit \`${src.commit}\`,`,
      `distributed there under the **${src.license}** licence. Copyright: ${src.copyright}.`,
      `The licence and notice files of that commit are included next to this file (${src.legal.map((l) => `\`${l.file}\``).join(', ')}).`,
      src.passwordSource ? `Passwords are documented upstream in \`${src.passwordSource}\` at the same commit.` : '',
      '',
      '| File | Bytes | Source (pinned URL) | Licence | Produced by | What it exercises |',
      '|---|---:|---|---|---|---|',
      ...rows,
      '',
      'SHA-256 hashes are pinned in `scripts/corpus/third-party.mjs`; run `node scripts/corpus/third-party.mjs` to verify.',
      '',
    ]
      .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
      .join('\n');
    attributions[key] = md;
  }
  return { manifest: `${JSON.stringify(manifest, null, 2)}\n`, attributions };
}

function writeDocs() {
  const docs = renderDocs();
  writeFileSync(join(THIRD_PARTY_DIR, 'manifest.json'), docs.manifest);
  for (const [key, md] of Object.entries(docs.attributions)) writeFileSync(join(THIRD_PARTY_DIR, key, 'ATTRIBUTION.md'), md);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { values } = parseArgs({ options: { fetch: { type: 'boolean', default: false }, docs: { type: 'boolean', default: false } } });
  try {
    if (values.fetch) await fetchMissing();
    if (values.docs) writeDocs();
    const problems = verify();
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exitCode = 1;
    } else {
      console.log(`third-party corpus OK: ${SAMPLES.length} samples + ${Object.values(SOURCES).reduce((n, s) => n + s.legal.length, 0)} licence files verified`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
