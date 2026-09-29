/** Lightweight XML scanning helpers (marker search, attribute extraction) used by the package inspectors. */
import type JSZip from 'jszip';

export function countMatches(text: string, re: RegExp): number {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  let n = 0;
  for (const _m of text.matchAll(new RegExp(re.source, flags))) n++;
  return n;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const lower = e.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return ENTITIES[lower] ?? m;
  });
}

/** All values of capture group 1, entity-decoded. */
export function captureAll(text: string, re: RegExp): string[] {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(re.source, flags))) if (m[1] !== undefined) out.push(decodeXmlEntities(m[1]));
  return out;
}

/** Case-insensitive view of a zip's part names (OPC part names are case-insensitive). */
export class PackageIndex {
  readonly names: string[];
  private readonly byLower = new Map<string, string>();

  constructor(private readonly zip: JSZip) {
    this.names = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name);
    for (const n of this.names) this.byLower.set(n.toLowerCase(), n);
  }

  matching(re: RegExp): string[] {
    return this.names.filter((n) => re.test(n));
  }

  count(re: RegExp): number {
    return this.matching(re).length;
  }

  has(name: string): boolean {
    return this.byLower.has(name.toLowerCase());
  }

  /** Text of a part ('' when missing or unreadable). */
  async text(name: string): Promise<string> {
    const real = this.byLower.get(name.toLowerCase());
    const file = real ? this.zip.file(real) : null;
    if (!file) return '';
    try {
      return await file.async('string');
    } catch {
      return '';
    }
  }
}
