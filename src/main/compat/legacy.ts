/**
 * Compound-file inspection: legacy Word/Excel/PowerPoint binaries and encrypted OOXML packages.
 * Legacy encryption markers: Word FIB fEncrypted, Excel FILEPASS record, PowerPoint EncryptedSummary stream.
 */
import type { CompatFinding } from '@shared/api/documents';
import type { FormatId } from '@shared/formats';
import type { OfficeKind } from '@shared/modules';
import type { CfbSummary } from '../files/cfb';
import { makeFinding } from './findings';

/** Streams whose first bytes the inspection needs. */
export const CFB_HEAD_STREAMS = ['WordDocument', 'Workbook', 'Book'] as const;

export interface CfbInspection {
  /** Format implied by the streams (doc/xls/ppt); undefined for encrypted OOXML or unknown containers. */
  detectedFormat?: FormatId;
  /** EncryptionInfo + EncryptedPackage: a password-protected OOXML package. */
  encryptedPackage: boolean;
  /** Legacy (DOC/XLS/PPT) password protection. */
  legacyEncrypted: boolean;
  /** Rights-managed (IRM/DRM) content, which the engine cannot open. */
  irm: boolean;
  findings: CompatFinding[];
}

function wordEncrypted(head: Buffer | undefined): boolean {
  if (!head || head.length < 12) return false;
  // FibBase: wIdent 0xA5EC at 0; flags at 0x0A, bit 8 = fEncrypted.
  return head.readUInt16LE(0) === 0xa5ec && (head.readUInt16LE(0x0a) & 0x0100) !== 0;
}

function excelEncrypted(head: Buffer | undefined): boolean {
  if (!head) return false;
  // BIFF records: [type u16][len u16][data]; FILEPASS (0x002F) follows BOF in the globals substream.
  for (let off = 0, n = 0; off + 4 <= head.length && n < 64; n++) {
    const type = head.readUInt16LE(off);
    const len = head.readUInt16LE(off + 2);
    if (type === 0x002f) return true;
    if (n > 0 && type === 0x0809) break;
    off += 4 + len;
  }
  return false;
}

export function inspectCfb(summary: CfbSummary, kindHint: OfficeKind | undefined): CfbInspection {
  const names = new Set(summary.entries.map((e) => e.name));
  const has = (n: string) => names.has(n);
  const irm = summary.entries.some((e) => /DRMEncrypted/i.test(e.name));
  const result: CfbInspection = { encryptedPackage: false, legacyEncrypted: false, irm, findings: [] };

  if (has('EncryptedPackage') && has('EncryptionInfo')) {
    result.encryptedPackage = true;
    return result;
  }
  if (has('WordDocument')) result.detectedFormat = 'doc';
  else if (has('Workbook') || has('Book')) result.detectedFormat = 'xls';
  else if (has('PowerPoint Document')) result.detectedFormat = 'ppt';

  const kind: OfficeKind | undefined =
    result.detectedFormat === 'doc' ? 'writer' : result.detectedFormat === 'xls' ? 'calc' : result.detectedFormat === 'ppt' ? 'impress' : kindHint;
  if (!kind) return result;

  if (result.detectedFormat === 'doc') result.legacyEncrypted = wordEncrypted(summary.heads.get('WordDocument'));
  else if (result.detectedFormat === 'xls') result.legacyEncrypted = excelEncrypted(summary.heads.get('Workbook') ?? summary.heads.get('Book'));
  else if (result.detectedFormat === 'ppt') result.legacyEncrypted = has('EncryptedSummary');

  const add = (id: CompatFinding['id'], count: number) => {
    if (count > 0) result.findings.push(makeFinding(id, kind, { count }));
  };
  add('macros', has('Macros') || has('_VBA_PROJECT_CUR') || has('VBA') ? 1 : 0);
  add('embeddedObjects', summary.entries.filter((e) => e.type === 'storage' && (/^_\d+$/.test(e.name) || /^MBD[0-9A-F]{8}$/i.test(e.name))).length);
  add('digitalSignature', has('_signatures') || has('_xmlsignatures') || has('\u0005DigitalSignature') ? 1 : 0);
  return result;
}
