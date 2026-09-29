/**
 * CompatAnalyzer: sniffs the real container/format of a file (extension + magic bytes) and lists the
 * content the engine may not preserve (docs/COMPATIBILITY.md). Runs before a document is opened;
 * the report drives the loss-risk prompt of the save pipeline.
 */
import { open, readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { CompatFinding, CompatReport } from '@shared/api/documents';
import { formatFromPath, getFormat, type FormatInfo } from '@shared/formats';
import { isOfficeKind, type OfficeKind } from '@shared/modules';
import { isCfb, readCfbFileSummary } from '../files/cfb';
import type { Logger } from '../log';
import { makeFinding, normalizeFindings } from './findings';
import type { FontCatalog } from './fonts';
import { CFB_HEAD_STREAMS, inspectCfb } from './legacy';
import { detectOdfFormat, inspectOdf } from './odf';
import { detectOoxmlFormat, inspectOoxml } from './ooxml';
import { PackageIndex } from './xml';

export type Container = 'zip' | 'cfb' | 'pdf' | 'rtf' | 'text' | 'unknown';

export interface InspectResult {
  /** Final format: content-based when the extension is missing or contradicts the content. */
  format: FormatInfo | undefined;
  container: Container;
  /** A password is needed to open the file. */
  encrypted: boolean;
  /** Rights-managed (IRM) file: cannot be opened by the engine. */
  irm: boolean;
  /** Password-protected PPT/PPS: the engine can neither open nor save them (tdf#33538). */
  unsupportedEncryption: boolean;
  /** Null for PDFs and plain text formats. */
  report: CompatReport | null;
}

export interface CompatAnalyzer {
  inspect(path: string): Promise<InspectResult>;
}

export interface CompatAnalyzerDeps {
  fonts: FontCatalog;
  log?: Logger;
  /** Packages above this size are not unzipped (format-level findings only). Default 256 MiB. */
  maxPackageBytes?: number;
  now?: () => Date;
}

const ZIP_MAGIC = [0x50, 0x4b];

export function classifyContainer(head: Buffer): Container {
  if (head.length >= 4 && head[0] === ZIP_MAGIC[0] && head[1] === ZIP_MAGIC[1] && (head[2] === 3 || head[2] === 5 || head[2] === 7)) return 'zip';
  if (isCfb(head)) return 'cfb';
  if (head.subarray(0, 1024).includes('%PDF-')) return 'pdf';
  if (head.subarray(0, 5).toString('latin1') === '{\\rtf') return 'rtf';
  const sample = head.subarray(0, 1024);
  const utf16 = sample.length >= 2 && ((sample[0] === 0xff && sample[1] === 0xfe) || (sample[0] === 0xfe && sample[1] === 0xff));
  return utf16 || !sample.includes(0) ? 'text' : 'unknown';
}

const EXPECTED_CONTAINER: Record<FormatInfo['family'], Container[]> = {
  ooxml: ['zip', 'cfb'],
  odf: ['zip'],
  binary: ['cfb'],
  text: ['text', 'rtf', 'unknown'],
  pdf: ['pdf'],
};

/** Decides between the extension's format and the content's format. */
export function chooseFormat(byExt: FormatInfo | undefined, container: Container, detected: FormatInfo | undefined): FormatInfo | undefined {
  if (container === 'pdf') return byExt?.id === 'pdf' ? byExt : getFormat('pdf');
  if (!byExt) return detected ?? (container === 'rtf' ? getFormat('rtf') : undefined);
  if (container === 'rtf' && byExt.family !== 'text') return getFormat('rtf');
  if (!EXPECTED_CONTAINER[byExt.family].includes(container)) return detected ?? byExt;
  if (detected && detected.kind !== byExt.kind) return detected;
  return byExt;
}

async function readHead(path: string, bytes: number): Promise<{ head: Buffer; size: number }> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const head = Buffer.alloc(Math.min(bytes, size));
    await fh.read(head, 0, head.length, 0);
    return { head, size };
  } finally {
    await fh.close();
  }
}

/** Format-level findings that do not need the package content. */
function formatFindings(format: FormatInfo, kind: OfficeKind): CompatFinding[] {
  const out: CompatFinding[] = [];
  if (format.family === 'binary') out.push(makeFinding('legacyFormat', kind));
  if (format.macroEnabled && (format.template || format.support === 'import-only')) out.push(makeFinding('templateMacros', kind));
  return out;
}

export function createCompatAnalyzer(deps: CompatAnalyzerDeps): CompatAnalyzer {
  const maxBytes = deps.maxPackageBytes ?? 256 * 1024 * 1024;
  const now = deps.now ?? (() => new Date());

  const inspectZip = async (path: string, size: number, byExt: FormatInfo | undefined) => {
    if (size > maxBytes) return { format: byExt, findings: [] as CompatFinding[], encrypted: false };
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(await readFile(path));
    } catch (err) {
      // Damaged package: let the engine try (it offers its own repair); nothing to report.
      deps.log?.warn('zip inspection failed', { error: err });
      return { format: byExt, findings: [] as CompatFinding[], encrypted: false };
    }
    const pkg = new PackageIndex(zip);
    const detectedId = pkg.has('[Content_Types].xml') ? detectOoxmlFormat(await pkg.text('[Content_Types].xml')) : pkg.has('mimetype') ? detectOdfFormat(await pkg.text('mimetype')) : undefined;
    const format = chooseFormat(byExt, 'zip', detectedId ? getFormat(detectedId) : undefined);
    if (!format || !isOfficeKind(format.kind)) return { format, findings: [] as CompatFinding[], encrypted: false };
    if (format.family === 'odf') {
      const r = await inspectOdf(pkg, format.kind, deps.fonts);
      return { format, findings: r.findings, encrypted: r.encrypted };
    }
    if (format.family === 'ooxml') return { format, findings: await inspectOoxml(pkg, format.kind, deps.fonts), encrypted: false };
    return { format, findings: [] as CompatFinding[], encrypted: false };
  };

  return {
    async inspect(path) {
      const byExt = formatFromPath(path);
      const { head, size } = await readHead(path, 1024);
      const container = classifyContainer(head);
      let format = byExt;
      let findings: CompatFinding[] = [];
      let encrypted = false;
      let irm = false;
      let unsupportedEncryption = false;

      if (container === 'zip') {
        const r = await inspectZip(path, size, byExt);
        format = r.format;
        findings = r.findings;
        encrypted = r.encrypted;
      } else if (container === 'cfb') {
        try {
          const summary = await readCfbFileSummary(path, CFB_HEAD_STREAMS);
          const kindHint = byExt && isOfficeKind(byExt.kind) ? byExt.kind : undefined;
          const r = inspectCfb(summary, kindHint);
          format = chooseFormat(byExt, 'cfb', r.detectedFormat ? getFormat(r.detectedFormat) : undefined);
          irm = r.irm;
          encrypted = r.encryptedPackage || r.legacyEncrypted;
          unsupportedEncryption = r.legacyEncrypted && r.detectedFormat === 'ppt';
          findings = r.findings;
          if (r.encryptedPackage && format && format.family !== 'ooxml') format = byExt && byExt.family === 'ooxml' ? byExt : undefined;
        } catch (err) {
          deps.log?.warn('compound file inspection failed', { error: err });
        }
      } else {
        format = chooseFormat(byExt, container, undefined);
      }

      if (!format || format.kind === 'pdf' || !isOfficeKind(format.kind)) {
        return { format, container, encrypted, irm, unsupportedEncryption, report: null };
      }
      const kind = format.kind;
      if (encrypted || irm) findings.push(makeFinding('encryption', kind, irm || unsupportedEncryption ? { severity: 'risk', detail: [irm ? 'irm' : 'legacyPpt'] } : {}));
      findings.push(...formatFindings(format, kind));
      const report: CompatReport = { format: format.id, findings: normalizeFindings(findings), analyzedAt: now().toISOString() };
      return { format, container, encrypted, irm, unsupportedEncryption, report };
    },
  };
}
