/**
 * Minimal Open Packaging Conventions reader (zip parts, content types, relationships) for the
 * independent OOXML readers. Relationship types are matched by their last segment so that ISO 29500
 * Strict packages (purl.oclc.org URIs) work as well as Transitional ones.
 */
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import JSZip from 'jszip';
import { NS, attr, kids, parseXml, type XElement } from './xml';

export interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
  /** Absolute part name (no leading slash) for internal targets. */
  part?: string;
}

export interface OpcPackage {
  zip: JSZip;
  /** Part names without leading slash, in zip order. */
  parts: string[];
  has(part: string): boolean;
  text(part: string): Promise<string | undefined>;
  bytes(part: string): Promise<Uint8Array | undefined>;
  xml(part: string): Promise<XElement | undefined>;
  relationships(sourcePart: string): Promise<Relationship[]>;
  contentType(part: string): string | undefined;
}

/** `word/document.xml` → `word/_rels/document.xml.rels`; '' (package) → `_rels/.rels`. */
export function relsPartOf(sourcePart: string): string {
  if (!sourcePart) return '_rels/.rels';
  const dir = posix.dirname(sourcePart);
  return `${dir === '.' ? '' : `${dir}/`}_rels/${posix.basename(sourcePart)}.rels`;
}

export function resolveTarget(sourcePart: string, target: string): string {
  if (target.startsWith('/')) return posix.normalize(target.slice(1));
  const base = sourcePart ? posix.dirname(sourcePart) : '';
  return posix.normalize(posix.join(base === '.' ? '' : base, target));
}

/** Last segment of a relationship type URI, e.g. `officeDocument`, `header`, `image`. */
export const relKind = (type: string): string => type.slice(type.lastIndexOf('/') + 1);

export async function openPackage(source: string | Uint8Array): Promise<OpcPackage> {
  const data = typeof source === 'string' ? await readFile(source) : source;
  const zip = await JSZip.loadAsync(data);
  const parts = Object.values(zip.files)
    .filter((f) => !f.dir)
    .map((f) => f.name);
  const lower = new Map(parts.map((p) => [p.toLowerCase(), p]));
  const find = (part: string) => zip.file(lower.get(part.toLowerCase()) ?? part);
  const xmlCache = new Map<string, Promise<XElement | undefined>>();

  const text = async (part: string) => find(part)?.async('string');
  const xml = (part: string) => {
    let cached = xmlCache.get(part);
    if (!cached) {
      cached = text(part).then((t) => (t === undefined ? undefined : parseXml(t)));
      xmlCache.set(part, cached);
    }
    return cached;
  };

  const types = new Map<string, string>();
  const defaults = new Map<string, string>();
  const ct = await xml('[Content_Types].xml');
  if (ct) {
    for (const d of kids(ct, NS.ct, 'Default')) defaults.set(String(attr(d, '', 'Extension')).toLowerCase(), String(attr(d, '', 'ContentType')));
    for (const o of kids(ct, NS.ct, 'Override')) types.set(String(attr(o, '', 'PartName')).replace(/^\//, '').toLowerCase(), String(attr(o, '', 'ContentType')));
  }

  return {
    zip,
    parts,
    has: (part) => lower.has(part.toLowerCase()),
    text,
    bytes: async (part) => find(part)?.async('uint8array'),
    xml,
    async relationships(sourcePart) {
      const rels = await xml(relsPartOf(sourcePart));
      if (!rels) return [];
      return rels.children
        .filter((c): c is XElement => 'local' in c && c.local === 'Relationship')
        .map((r) => {
          const target = String(attr(r, '', 'Target') ?? '');
          const external = attr(r, '', 'TargetMode') === 'External';
          return {
            id: String(attr(r, '', 'Id')),
            type: String(attr(r, '', 'Type')),
            target,
            external,
            part: external ? undefined : resolveTarget(sourcePart, target),
          };
        });
    },
    contentType(part) {
      const key = part.replace(/^\//, '').toLowerCase();
      return types.get(key) ?? defaults.get(posix.extname(key).slice(1));
    },
  };
}

/** Target part of the package's main document (officeDocument relationship). */
export async function mainPart(pkg: OpcPackage): Promise<string> {
  const rel = (await pkg.relationships('')).find((r) => relKind(r.type) === 'officeDocument');
  if (!rel?.part) throw new Error('package has no officeDocument relationship');
  return rel.part;
}

/**
 * Copy of a package with some parts rewritten as text (part order and all other parts unchanged).
 * Used to build the expected state of a documented engine change. An edit that leaves its part
 * unchanged throws, so a patch that no longer matches the generated file cannot pass silently.
 */
export async function patchPackage(source: string | Uint8Array, edits: Record<string, (xml: string) => string>): Promise<Buffer> {
  const zip = await JSZip.loadAsync(typeof source === 'string' ? await readFile(source) : source);
  for (const [part, edit] of Object.entries(edits)) {
    const file = zip.file(part);
    if (!file) throw new Error(`patchPackage: part ${part} not found`);
    const before = await file.async('string');
    const after = edit(before);
    if (after === before) throw new Error(`patchPackage: the edit of ${part} changed nothing`);
    zip.file(part, after);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Replaces the only occurrence of `search`; throws when it occurs zero times or more than once. */
export function replaceOnce(text: string, search: string, replacement: string): string {
  const first = text.indexOf(search);
  if (first < 0) throw new Error(`replaceOnce: ${JSON.stringify(search)} not found`);
  if (text.indexOf(search, first + 1) >= 0) throw new Error(`replaceOnce: ${JSON.stringify(search)} occurs more than once`);
  return text.slice(0, first) + replacement + text.slice(first + search.length);
}
