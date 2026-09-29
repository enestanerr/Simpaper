/**
 * OOXML package inspection (DOCX/DOCM/DOTX/DOTM, XLSX/XLSM/XLTX/XLTM, PPTX/PPTM/PPSX/PPSM/POTX/POTM):
 * detects parts, content types and XML markers of features the engine does not fully preserve.
 * Only structure and markers are read; no document text leaves this module.
 */
import type { CompatFinding } from '@shared/api/documents';
import type { FormatId } from '@shared/formats';
import type { OfficeKind } from '@shared/modules';
import { makeFinding } from './findings';
import type { FontCatalog } from './fonts';
import { captureAll, countMatches, decodeXmlEntities, type PackageIndex } from './xml';

const MAIN_CONTENT_TYPES: ReadonlyArray<[string, FormatId]> = [
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', 'docx'],
  ['application/vnd.ms-word.document.macroenabled.main+xml', 'docm'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml', 'dotx'],
  ['application/vnd.ms-word.template.macroenabledtemplate.main+xml', 'dotm'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', 'xlsx'],
  ['application/vnd.ms-excel.sheet.macroenabled.main+xml', 'xlsm'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml', 'xltx'],
  ['application/vnd.ms-excel.template.macroenabled.main+xml', 'xltm'],
  ['application/vnd.ms-excel.sheet.binary.macroenabled.main', 'xlsb'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml', 'pptx'],
  ['application/vnd.ms-powerpoint.presentation.macroenabled.main+xml', 'pptm'],
  ['application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml', 'ppsx'],
  ['application/vnd.ms-powerpoint.slideshow.macroenabled.main+xml', 'ppsm'],
  ['application/vnd.openxmlformats-officedocument.presentationml.template.main+xml', 'potx'],
  ['application/vnd.ms-powerpoint.template.macroenabled.main+xml', 'potm'],
];

/** Format of an OOXML package from the content type of its main part. */
export function detectOoxmlFormat(contentTypesXml: string): FormatId | undefined {
  const lower = contentTypesXml.toLowerCase();
  for (const [ct, id] of MAIN_CONTENT_TYPES) if (lower.includes(`"${ct}"`)) return id;
  return undefined;
}

const MEDIA_EXT = /\.(mp4|m4v|mov|wmv|avi|mpe?g|mkv|webm|mp3|m4a|wav|wma|aac|ogg|oga|flac|midi?|aiff?)$/i;
/** Windows charsets of CJK fonts in fontTable.xml (SHIFTJIS, HANGUL, JOHAB, GB2312, BIG5): not used for Latin text. */
const CJK_CHARSETS = new Set(['80', '81', '82', '86', '88']);

interface FontUse {
  used: Set<string>;
  embedded: Set<string>;
}

function addFont(set: Set<string>, name: string | undefined): void {
  const n = name?.trim();
  if (!n || n.startsWith('+') || n.length > 64) return;
  set.add(n);
}

/** Latin major/minor fonts of a DrawingML theme part. */
function themeLatinFonts(themeXml: string): string[] {
  const out: string[] = [];
  for (const block of themeXml.matchAll(/<a:(majorFont|minorFont)>([\s\S]*?)<\/a:\1>/g)) {
    const latin = /<a:latin\s[^>]*typeface="([^"]*)"/.exec(block[2] ?? '');
    if (latin?.[1]) out.push(latin[1]);
  }
  return out;
}

async function wordFonts(pkg: PackageIndex, fonts: FontUse): Promise<number> {
  const table = await pkg.text('word/fontTable.xml');
  let embeddedCount = 0;
  for (const m of table.matchAll(/<w:font\s[^>]*w:name="([^"]*)"[^>]*?(?:\/>|>([\s\S]*?)<\/w:font>)/g)) {
    const body = m[2] ?? '';
    const charset = /<w:charset\s[^>]*w:val="([0-9A-Fa-f]{2})"/.exec(body)?.[1]?.toUpperCase();
    const name = decodeXmlEntities(m[1] ?? '');
    if (/<w:embed(Regular|Bold|Italic|BoldItalic)\b/.test(body)) {
      embeddedCount++;
      addFont(fonts.embedded, name);
    }
    if (charset && CJK_CHARSETS.has(charset)) continue;
    addFont(fonts.used, name);
  }
  for (const t of pkg.matching(/^word\/theme\/theme\d*\.xml$/i)) for (const f of themeLatinFonts(await pkg.text(t))) addFont(fonts.used, f);
  return embeddedCount;
}

async function excelFonts(pkg: PackageIndex, fonts: FontUse): Promise<void> {
  const styles = await pkg.text('xl/styles.xml');
  const fontsBlock = /<fonts\b[\s\S]*?<\/fonts>/.exec(styles)?.[0] ?? '';
  for (const n of captureAll(fontsBlock, /<name\s+val="([^"]*)"/)) addFont(fonts.used, n);
  for (const t of pkg.matching(/^xl\/theme\/theme\d*\.xml$/i)) for (const f of themeLatinFonts(await pkg.text(t))) addFont(fonts.used, f);
}

async function powerPointFonts(pkg: PackageIndex, slideXml: string[], fonts: FontUse): Promise<number> {
  for (const t of pkg.matching(/^ppt\/theme\/theme\d*\.xml$/i)) for (const f of themeLatinFonts(await pkg.text(t))) addFont(fonts.used, f);
  const layouts = [...pkg.matching(/^ppt\/slideMasters\/slideMaster\d*\.xml$/i), ...pkg.matching(/^ppt\/slideLayouts\/slideLayout\d*\.xml$/i)];
  for (const xml of [...slideXml, ...(await Promise.all(layouts.map((l) => pkg.text(l))))]) {
    for (const f of captureAll(xml, /<a:latin\s[^>]*typeface="([^"]*)"/)) addFont(fonts.used, f);
  }
  const pres = await pkg.text('ppt/presentation.xml');
  const embedded = captureAll(/<p:embeddedFontLst>[\s\S]*?<\/p:embeddedFontLst>/.exec(pres)?.[0] ?? '', /<p:font\s[^>]*typeface="([^"]*)"/);
  for (const e of embedded) addFont(fonts.embedded, e);
  return embedded.length;
}

export async function inspectOoxml(pkg: PackageIndex, kind: OfficeKind, fontCatalog: FontCatalog): Promise<CompatFinding[]> {
  const findings: CompatFinding[] = [];
  const add = (id: CompatFinding['id'], count: number, extra: Parameters<typeof makeFinding>[2] = {}) => {
    if (count > 0) findings.push(makeFinding(id, kind, { count, ...extra }));
  };
  const contentTypes = (await pkg.text('[Content_Types].xml')).toLowerCase();

  add('macros', pkg.count(/(^|\/)vbaProject\.bin$/i));
  add('activeX', pkg.count(/^(word|xl|ppt)\/activeX\/activeX\d*\.xml$/i) || Math.min(1, pkg.count(/^(word|xl|ppt)\/activeX\/[^/]+\.bin$/i)));

  const embeddings = pkg.matching(/^(word|xl|ppt)\/embeddings\/[^/]+$/i);
  if (embeddings.length) {
    const exts = [...new Set(embeddings.map((e) => (/\.([a-z0-9]+)$/i.exec(e)?.[1] ?? '').toLowerCase()).filter(Boolean))].sort();
    // Visio and PDF objects are converted to drawings on load, the rest round-trips.
    const lossy = exts.some((e) => e === 'vsd' || e === 'vsdx' || e === 'pdf');
    add('embeddedObjects', embeddings.length, { detail: exts, ...(lossy ? { severity: 'warning' as const } : {}) });
  }

  add('smartArt', pkg.count(/^(word|xl|ppt)\/diagrams\/data\d*\.xml$/i));
  add('chartEx', Math.max(pkg.count(/^(word|xl|ppt)\/charts\/chartEx\d*\.xml$/i), contentTypes.includes('application/vnd.ms-office.chartex+xml') ? 1 : 0));
  add('charts', pkg.count(/^(word|xl|ppt)\/charts\/chart\d+\.xml$/i));
  add('pivotTables', pkg.count(/^xl\/pivotTables\/pivotTable\d*\.xml$/i));
  add('slicers', pkg.count(/^xl\/(slicers\/slicer|slicerCaches\/slicerCache)\d*\.xml$/i));
  add('timelines', pkg.count(/^xl\/(timelines\/timeline|timelineCaches\/timelineCache)\d*\.xml$/i));
  add('externalLinks', pkg.count(/^xl\/externalLinks\/externalLink\d*\.xml$/i));
  add('dataModel', pkg.count(/^xl\/model\/item\.data$/i));

  // Power Query: Mashup OLE DB connections and the DataMashup custom XML item.
  const customItems = pkg.matching(/^customXml\/item\d+\.xml$/i);
  let mashupItems = 0;
  for (const item of customItems) if (/<DataMashup[\s/>]/.test((await pkg.text(item)).slice(0, 2048))) mashupItems++;
  const connections = await pkg.text('xl/connections.xml');
  add('powerQuery', mashupItems + countMatches(connections, /Microsoft\.Mashup/));
  add('customXml', customItems.length - mashupItems);

  add('threadedComments', pkg.count(/^xl\/threadedComments\/threadedComment\d*\.xml$/i) + pkg.count(/^ppt\/comments\/modernComment[^/]*\.xml$/i));
  add('ink', Math.max(pkg.count(/^(word|xl|ppt)\/ink\/[^/]+$/i), contentTypes.includes('application/inkml+xml') ? 1 : 0));
  add('model3d', Math.max(pkg.count(/\.glb$/i), contentTypes.includes('model/gltf-binary') ? 1 : 0));
  add('media', pkg.matching(/^(word|xl|ppt)\/media\/[^/]+$/i).filter((n) => MEDIA_EXT.test(n)).length);
  add('digitalSignature', pkg.count(/^_xmlsignatures\/sig\d*\.xml$/i));

  const rootRels = await pkg.text('_rels/.rels');
  if (rootRels.includes('purl.oclc.org/ooxml') || contentTypes.includes('purl.oclc.org/ooxml')) findings.push(makeFinding('strictOoxml', kind));

  const fonts: FontUse = { used: new Set(), embedded: new Set() };
  if (kind === 'writer') {
    const doc = await pkg.text('word/document.xml');
    add('trackedChanges', countMatches(doc, /<w:(ins|del|moveFrom|moveTo)[\s/>]/));
    add('contentControls', countMatches(doc, /<w:sdt[\s/>]/));
    add('equations', countMatches(doc, /<m:oMath[\s/>]/));
    add('fontEmbedding', (await wordFonts(pkg, fonts)) || pkg.count(/^word\/fonts\/[^/]+\.odttf$/i));
  } else if (kind === 'calc') {
    add('trackedChanges', pkg.count(/^xl\/revisions\/revisionLog\d*\.xml$/i), { severity: 'warning' });
    await excelFonts(pkg, fonts);
  } else {
    const slides = pkg.matching(/^ppt\/slides\/slide\d+\.xml$/i);
    const slideXml = await Promise.all(slides.map((s) => pkg.text(s)));
    add('morphTransition', slideXml.filter((x) => /<p159:morph[\s/>]/.test(x)).length);
    add('equations', slideXml.reduce((n, x) => n + countMatches(x, /<a14:m[\s/>]/), 0));
    add('fontEmbedding', (await powerPointFonts(pkg, slideXml, fonts)) || pkg.count(/^ppt\/fonts\/[^/]+\.fntdata$/i));
  }

  const missing = [...fonts.used].filter((f) => !fonts.embedded.has(f) && fontCatalog.status(f) === 'missing').sort((a, b) => a.localeCompare(b));
  if (missing.length) findings.push(makeFinding('missingFonts', kind, { count: missing.length, detail: missing.slice(0, 20) }));
  return findings;
}
