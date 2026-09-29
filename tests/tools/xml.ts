/**
 * Namespace-aware XML tree for the independent readers (built on fast-xml-parser's ordered output).
 * Entities are decoded here (the five XML entities and numeric references) in a single pass, so
 * `&amp;#305;` correctly stays the literal text "&#305;". Element and attribute namespaces are resolved
 * from the in-scope declarations, so readers match on namespace URI + local name, never on prefixes.
 */
import { XMLParser } from 'fast-xml-parser';

export interface XElement {
  /** Qualified name as written, e.g. `w:p`. */
  name: string;
  /** Local name, e.g. `p`. */
  local: string;
  /** Namespace URI ('' when none). */
  ns: string;
  /** Attributes by qualified name as written (decoded values). */
  attrs: Record<string, string>;
  /** Attributes keyed by `${namespaceUri}|${localName}` (unprefixed attributes have no namespace). */
  nsAttrs: Map<string, string>;
  children: XNode[];
}

export interface XText {
  text: string;
}

export type XNode = XElement | XText;

export const isElement = (n: XNode): n is XElement => (n as XElement).local !== undefined;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  htmlEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  cdataPropName: '#cdata',
  commentPropName: '#comment',
});

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? `&${e};`;
  });
}

type RawNode = Record<string, unknown>;

const splitName = (q: string): [string, string] => {
  const i = q.indexOf(':');
  return i < 0 ? ['', q] : [q.slice(0, i), q.slice(i + 1)];
};

function convert(raw: RawNode[], scope: Map<string, string>): XNode[] {
  const out: XNode[] = [];
  for (const node of raw) {
    const key = Object.keys(node).find((k) => k !== ':@');
    if (key === undefined || key === '#comment') continue;
    if (key === '#text') {
      out.push({ text: decodeEntities(String(node[key])) });
      continue;
    }
    if (key === '#cdata') {
      const inner = (node[key] as RawNode[]) ?? [];
      out.push({ text: inner.map((t) => String(t['#text'] ?? '')).join('') });
      continue;
    }
    const attrsRaw = (node[':@'] ?? {}) as Record<string, string>;
    const attrs: Record<string, string> = {};
    let local = scope;
    for (const [k, v] of Object.entries(attrsRaw)) {
      const value = decodeEntities(String(v));
      attrs[k] = value;
      if (k === 'xmlns' || k.startsWith('xmlns:')) {
        if (local === scope) local = new Map(scope);
        local.set(k === 'xmlns' ? '' : k.slice(6), value);
      }
    }
    const nsAttrs = new Map<string, string>();
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'xmlns' || k.startsWith('xmlns:')) continue;
      const [prefix, name] = splitName(k);
      nsAttrs.set(`${prefix ? (local.get(prefix) ?? `unbound:${prefix}`) : ''}|${name}`, v);
    }
    const [prefix, name] = splitName(key);
    out.push({
      name: key,
      local: name,
      ns: local.get(prefix) ?? '',
      attrs,
      nsAttrs,
      children: convert((node[key] as RawNode[]) ?? [], local),
    });
  }
  return out;
}

/** Parses an XML document and returns its root element. */
export function parseXml(xml: string): XElement {
  const scope = new Map([['xml', 'http://www.w3.org/XML/1998/namespace']]);
  const root = convert(parser.parse(xml) as RawNode[], scope).find(isElement);
  if (!root) throw new Error('XML document without root element');
  return root;
}

export const elements = (el: XElement): XElement[] => el.children.filter(isElement);

/** Direct children with the given namespace and local name. */
export function kids(el: XElement, ns: string, local: string): XElement[] {
  return el.children.filter((c): c is XElement => isElement(c) && c.local === local && c.ns === ns);
}

export function kid(el: XElement, ns: string, local: string): XElement | undefined {
  return kids(el, ns, local)[0];
}

/** Depth-first descendants (document order) matching namespace and local name. */
export function descendants(el: XElement, ns: string, local: string, out: XElement[] = []): XElement[] {
  for (const c of el.children) {
    if (!isElement(c)) continue;
    if (c.local === local && c.ns === ns) out.push(c);
    descendants(c, ns, local, out);
  }
  return out;
}

/** Concatenated text content. */
export function textContent(el: XElement): string {
  let s = '';
  for (const c of el.children) s += isElement(c) ? textContent(c) : c.text;
  return s;
}

/** Attribute by namespace URI + local name ('' namespace for unprefixed attributes). */
export function attr(el: XElement, ns: string, local: string): string | undefined {
  return el.nsAttrs.get(`${ns}|${local}`);
}

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  pr: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  x: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  xml: 'http://www.w3.org/XML/1998/namespace',
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  presentation: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
} as const;
