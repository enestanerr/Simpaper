/**
 * Shell keys (bare Alt / F10) reported by the platform keyboard hook (settings.ui.documentKeyTips).
 *
 * The hook is installed while Varak — its window or one of its native document windows — is in the foreground,
 * but a gesture is forwarded to the renderer only while a document window has the focus: when the Varak window
 * itself is focused, the renderer handles Alt/F10 on its own, and a second report would re-open KeyTips the user
 * just closed (or open them for Right Alt, which the renderer ignores on purpose).
 */
import type { ModuleKind } from '@shared/modules';
import type { ShellKey } from '../platform/types';

export interface ShellKeyTarget {
  /** The BrowserWindow itself has the keyboard focus (BrowserWindow.isFocused). */
  hostFocused(): boolean;
  activeDocId: string | null;
  kindOf(docId: string): ModuleKind | undefined;
  emit(docId: string, key: ShellKey): void;
}

/** Forwards `key` for the active office document; returns whether it was forwarded. */
export function forwardShellKey(key: ShellKey, target: ShellKeyTarget): boolean {
  if (target.hostFocused()) return false;
  const docId = target.activeDocId;
  const kind = docId ? target.kindOf(docId) : undefined;
  if (!docId || !kind || kind === 'pdf') return false;
  target.emit(docId, key);
  return true;
}
