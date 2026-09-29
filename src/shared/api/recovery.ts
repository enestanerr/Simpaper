/** `recovery:*` — crash recovery of unsaved work. Owner: main/recovery. */
import type { FormatId } from '../formats';
import type { ModuleKind } from '../modules';
import type { DocumentDescriptor } from './documents';

export interface RecoveryEntry {
  id: string;
  kind: ModuleKind;
  title: string;
  /** The user's original file, if the document had one. */
  originalPath: string | null;
  originalFormat: FormatId | null;
  snapshotAt: string;
  /** Why the entry exists: the app did not shut down cleanly, or the engine crashed during the session. */
  reason: 'unclean-shutdown' | 'engine-crash';
  sizeBytes: number;
}

export interface RecoveryChannels {
  'recovery:list': { req: void; res: RecoveryEntry[] };
  'recovery:restore': { req: { id: string }; res: DocumentDescriptor };
  'recovery:discard': { req: { id: string }; res: void };
}

export const RECOVERY_CHANNELS = ['recovery:list', 'recovery:restore', 'recovery:discard'] as const;
