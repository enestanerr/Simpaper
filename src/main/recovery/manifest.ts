/** Recovery manifest: one JSON file next to each snapshot (`<docId>.json` + `<docId>.odt|ods|odp|pdf`). */
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { RecoveryEntry } from '@shared/api/recovery';
import { FORMATS, type FormatId } from '@shared/formats';
import { MODULE_KINDS, type ModuleKind } from '@shared/modules';
import type { DiskStamp } from '../documents/record';

export const MANIFEST_SCHEMA = 1;

export interface RecoveryManifest {
  schema: number;
  sessionId: string;
  docId: string;
  kind: ModuleKind;
  title: string;
  originalPath: string | null;
  originalFormat: FormatId | null;
  originalStamp: DiskStamp | null;
  /** File name of the snapshot inside the session folder. */
  snapshotFile: string;
  snapshotAt: string;
  reason: RecoveryEntry['reason'];
  /** Snapshot stored with the document's password (ODF encryption). */
  encrypted: boolean;
}

const ID_PART = /^[A-Za-z0-9-]{1,64}$/;
const FORMAT_IDS = new Set<string>(FORMATS.map((f) => f.id));
const KINDS = new Set<string>(MODULE_KINDS);

export function entryId(sessionId: string, docId: string): string {
  return `${sessionId}.${docId}`;
}

export function parseEntryId(id: string): { sessionId: string; docId: string } | null {
  const parts = id.split('.');
  if (parts.length !== 2) return null;
  const [sessionId, docId] = parts as [string, string];
  return ID_PART.test(sessionId) && ID_PART.test(docId) ? { sessionId, docId } : null;
}

function isStamp(v: unknown): v is DiskStamp {
  return !!v && typeof v === 'object' && typeof (v as DiskStamp).mtimeMs === 'number' && typeof (v as DiskStamp).size === 'number';
}

export function validateManifest(v: unknown): RecoveryManifest | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  const ok =
    m['schema'] === MANIFEST_SCHEMA &&
    typeof m['sessionId'] === 'string' &&
    ID_PART.test(m['sessionId']) &&
    typeof m['docId'] === 'string' &&
    ID_PART.test(m['docId']) &&
    typeof m['kind'] === 'string' &&
    KINDS.has(m['kind']) &&
    typeof m['title'] === 'string' &&
    (m['originalPath'] === null || (typeof m['originalPath'] === 'string' && isAbsolute(m['originalPath']))) &&
    (m['originalFormat'] === null || (typeof m['originalFormat'] === 'string' && FORMAT_IDS.has(m['originalFormat']))) &&
    (m['originalStamp'] === null || isStamp(m['originalStamp'])) &&
    typeof m['snapshotFile'] === 'string' &&
    /^[A-Za-z0-9-]+\.(odt|ods|odp|pdf)$/.test(m['snapshotFile']) &&
    typeof m['snapshotAt'] === 'string' &&
    !Number.isNaN(Date.parse(m['snapshotAt'])) &&
    (m['reason'] === 'unclean-shutdown' || m['reason'] === 'engine-crash') &&
    typeof m['encrypted'] === 'boolean';
  return ok ? (m as unknown as RecoveryManifest) : null;
}

export async function readManifest(path: string): Promise<RecoveryManifest | null> {
  try {
    return validateManifest(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return null;
  }
}

export function toEntry(m: RecoveryManifest, sizeBytes: number, reason: RecoveryEntry['reason'] = m.reason): RecoveryEntry {
  return {
    id: entryId(m.sessionId, m.docId),
    kind: m.kind,
    title: m.title,
    originalPath: m.originalPath,
    originalFormat: m.originalFormat,
    snapshotAt: m.snapshotAt,
    reason,
    sizeBytes,
  };
}
