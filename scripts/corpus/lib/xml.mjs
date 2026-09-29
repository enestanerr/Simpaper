/** Tiny helpers for hand-authored XML parts. */

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Escapes text content and attribute values. */
export function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Renders attributes; undefined/null/false values are skipped, `true` renders as "1". */
export function attrs(map) {
  let out = '';
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined || value === null || value === false) continue;
    out += ` ${key}="${esc(value === true ? '1' : value)}"`;
  }
  return out;
}

/** `<tag attrs>children</tag>` or `<tag attrs/>` when there are no children. */
export function el(tag, attributes = {}, ...children) {
  const inner = children.flat(Infinity).filter((c) => c !== undefined && c !== null && c !== false).join('');
  return inner === '' ? `<${tag}${attrs(attributes)}/>` : `<${tag}${attrs(attributes)}>${inner}</${tag}>`;
}

/** Namespaces used by the OOXML generators. */
export const NS = {
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  pr: 'http://schemas.openxmlformats.org/package/2006/relationships',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  cp: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  dcmitype: 'http://purl.org/dc/dcmitype/',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  ep: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
  vt: 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
};

/** Relationship type URIs. */
export const REL = {
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  coreProps: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  fontTable: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable',
  header: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
  footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
  comments: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  slideMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  notesSlide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
  notesMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster',
  presProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps',
  viewProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps',
  tableStyles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles',
};

/** A `.rels` part from `[id, type, target, external?]` tuples. */
export function relsXml(rels) {
  return (
    XML_DECL +
    el(
      'Relationships',
      { xmlns: NS.pr },
      rels.map(([id, type, target, external]) => el('Relationship', { Id: id, Type: type, Target: target, TargetMode: external ? 'External' : undefined })),
    )
  );
}

/** `[Content_Types].xml` from default extension mappings and part overrides. */
export function contentTypesXml(defaults, overrides) {
  return (
    XML_DECL +
    el(
      'Types',
      { xmlns: NS.ct },
      Object.entries(defaults).map(([ext, type]) => el('Default', { Extension: ext, ContentType: type })),
      Object.entries(overrides).map(([part, type]) => el('Override', { PartName: part, ContentType: type })),
    )
  );
}

/** docProps/core.xml with fixed dates. */
export function corePropsXml({ title, subject, creator, keywords, description, language, created }) {
  return (
    XML_DECL +
    el(
      'cp:coreProperties',
      { 'xmlns:cp': NS.cp, 'xmlns:dc': NS.dc, 'xmlns:dcterms': NS.dcterms, 'xmlns:dcmitype': NS.dcmitype, 'xmlns:xsi': NS.xsi },
      el('dc:title', {}, esc(title)),
      subject ? el('dc:subject', {}, esc(subject)) : '',
      el('dc:creator', {}, esc(creator)),
      keywords ? el('cp:keywords', {}, esc(keywords)) : '',
      description ? el('dc:description', {}, esc(description)) : '',
      el('cp:lastModifiedBy', {}, esc(creator)),
      el('cp:revision', {}, '1'),
      el('dcterms:created', { 'xsi:type': 'dcterms:W3CDTF' }, created),
      el('dcterms:modified', { 'xsi:type': 'dcterms:W3CDTF' }, created),
      language ? el('dc:language', {}, language) : '',
    )
  );
}

/** docProps/app.xml. `application` deliberately does not claim to be Microsoft Office. */
export function appPropsXml({ application, extra = '' }) {
  return XML_DECL + el('Properties', { xmlns: NS.ep, 'xmlns:vt': NS.vt }, el('Application', {}, esc(application)), extra);
}
