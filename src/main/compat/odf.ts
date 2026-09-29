/** ODF package inspection (ODT/ODS/ODP): macros, signatures, encryption, embedded objects, fonts. */
import type { CompatFinding } from '@shared/api/documents';
import type { FormatId } from '@shared/formats';
import type { OfficeKind } from '@shared/modules';
import { makeFinding } from './findings';
import type { FontCatalog } from './fonts';
import { captureAll, countMatches, type PackageIndex } from './xml';

const MIME_TO_FORMAT: Readonly<Record<string, FormatId>> = {
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
};

export function detectOdfFormat(mimetype: string): FormatId | undefined {
  return MIME_TO_FORMAT[mimetype.trim()];
}

export interface OdfInspection {
  findings: CompatFinding[];
  encrypted: boolean;
}

export async function inspectOdf(pkg: PackageIndex, kind: OfficeKind, fontCatalog: FontCatalog): Promise<OdfInspection> {
  const findings: CompatFinding[] = [];
  const add = (id: CompatFinding['id'], count: number) => {
    if (count > 0) findings.push(makeFinding(id, kind, { count }));
  };
  const manifest = await pkg.text('META-INF/manifest.xml');
  const encrypted = /<manifest:encryption-data[\s/>]/.test(manifest);

  add('macros', pkg.count(/^(Basic\/[^/]+\/(?!script-lb|dialog-lb|script-lc|dialog-lc)[^/]+\.xml|Scripts\/.+)$/i));
  add('digitalSignature', pkg.count(/^META-INF\/(document|macro)signatures\.xml$/i));
  if (encrypted) findings.push(makeFinding('encryption', kind));

  const objects = new Set(pkg.matching(/^Object \d+\/content\.xml$/i).map((n) => n.split('/')[0] ?? n));
  let charts = 0;
  let formulas = 0;
  if (!encrypted) {
    for (const obj of objects) {
      const xml = (await pkg.text(`${obj}/content.xml`)).slice(0, 4096);
      if (/<chart:chart[\s/>]/.test(xml) || /<office:chart[\s/>]/.test(xml)) charts++;
      else if (/<math[\s/>:]/.test(xml) || /<office:formula[\s/>]/.test(xml)) formulas++;
    }
  }
  add('charts', charts);
  add('equations', formulas);
  add('embeddedObjects', objects.size - charts - formulas);
  add('media', pkg.count(/^Media\/[^/]+$/i));

  if (!encrypted) {
    const content = await pkg.text('content.xml');
    const styles = await pkg.text('styles.xml');
    add('trackedChanges', countMatches(content, /<text:changed-region[\s/>]/));
    const used = new Set<string>();
    for (const xml of [content, styles]) {
      for (const fam of captureAll(xml, /<style:font-face\s[^>]*svg:font-family="([^"]*)"/)) {
        const name = fam.replace(/^['"]|['"]$/g, '').trim();
        if (name && name.length <= 64) used.add(name);
      }
    }
    const embedded = pkg.count(/^Fonts\/[^/]+$/i);
    add('fontEmbedding', embedded);
    const missing = embedded ? [] : [...used].filter((f) => fontCatalog.status(f) === 'missing').sort((a, b) => a.localeCompare(b));
    if (missing.length) findings.push(makeFinding('missingFonts', kind, { count: missing.length, detail: missing.slice(0, 20) }));
  }
  return { findings, encrypted };
}
