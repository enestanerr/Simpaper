/**
 * Keyboard focus between Simpaper's own controls and LibreOffice's child windows (child hosting).
 *
 * Windows leaves the keyboard focus in a LibreOffice child window when the user clicks the web content of the
 * host window: Chromium does not take it back (checked on screen 2026-09-29, scripts/gui/checks/focuscheck.mjs), so
 * a letter typed into the ribbon's font box went into the document. The shell asks for the focus
 * (`view:focusShell`) when the user clicks into its own controls or opens modal UI.
 */
import { canonicalHwnd, sameHwnd, type Hwnd } from '../hwnd';
import { SMTO_ABORTIFHUNG, SMTO_BLOCK, WM_NULL } from './constants';
import { callAsync, type Win32Api } from './ffi';

/** How long the LibreOffice window may take to answer before the focus is left where it is. */
const PROBE_TIMEOUT_MS = 250;

export type FocusApi = Pick<Win32Api['user32'], 'GetFocus' | 'SetFocus' | 'GetWindowThreadProcessId' | 'IsChild' | 'IsHungAppWindow' | 'SendMessageTimeoutW'>;

/**
 * Moves the keyboard focus to `host` (on the host's UI thread, whose input queue LibreOffice's children share).
 * Resolves true when the keyboard was the document's: taken from a LibreOffice window inside `host`, or from one
 * of `containers` (our own view containers, which Windows hands the focus when the LibreOffice child that had it is
 * hidden or destroyed; keys sent there are lost, so they never keep it). The focus stays where it is when it is in a
 * window of this process already, in a window outside `host` (a LibreOffice dialog), or in a window that does not
 * answer: giving up the focus sends that window WM_KILLFOCUS and would block this thread.
 */
export async function takeFocusFromViews(user32: FocusApi, host: Hwnd, ownPid: number, containers: readonly Hwnd[] = []): Promise<boolean> {
  const focus = canonicalHwnd(user32.GetFocus());
  if (focus === null) {
    // Nobody has it: keys would be lost.
    user32.SetFocus(host);
    return false;
  }
  if (containers.some((c) => sameHwnd(c, focus))) {
    // Keys would reach the host as system keys; the keyboard was the document's, so it goes back there later.
    user32.SetFocus(host);
    return true;
  }
  if (sameHwnd(focus, host)) return false;
  const pid = [0];
  user32.GetWindowThreadProcessId(focus, pid);
  if (pid[0] === ownPid) return false;
  if (!user32.IsChild(host, focus) || user32.IsHungAppWindow(focus)) return false;
  const result = [0];
  const answered = await callAsync(user32.SendMessageTimeoutW, focus, WM_NULL, 0, 0, SMTO_ABORTIFHUNG | SMTO_BLOCK, PROBE_TIMEOUT_MS, result);
  // The user may have moved the focus meanwhile (clicked into the document again).
  if (!Number(answered) || !sameHwnd(canonicalHwnd(user32.GetFocus()), focus)) return false;
  user32.SetFocus(host);
  return true;
}
