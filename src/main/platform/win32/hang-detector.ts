/**
 * Hung-window detection. IsHungAppWindow is answered from the window manager's own bookkeeping
 * (no message is sent); SendMessageTimeoutW(WM_NULL) runs on a koffi worker thread so a hung
 * LibreOffice can never block Electron's UI thread, whose input queue may be attached to it.
 */
import { parseHwnd } from '../hwnd';
import type { HangDetector } from '../types';
import { SMTO_ABORTIFHUNG, SMTO_BLOCK, WM_NULL } from './constants';
import { callAsync, type Win32Api } from './ffi';

const MAX_TIMEOUT_MS = 60_000;

export class Win32HangDetector implements HangDetector {
  constructor(private readonly api: Win32Api) {}

  /**
   * Resolves false when the window does not exist, is flagged as hung by Windows, or does not
   * process a WM_NULL within `timeoutMs`.
   */
  async isResponding(nativeHwnd: string, timeoutMs: number): Promise<boolean> {
    const hwnd = parseHwnd(nativeHwnd);
    if (hwnd === null) throw new TypeError(`isResponding: invalid window handle "${nativeHwnd}"`);
    const { user32 } = this.api;
    if (!user32.IsWindow(hwnd) || user32.IsHungAppWindow(hwnd)) return false;
    const timeout = Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.round(Number.isFinite(timeoutMs) ? timeoutMs : 0)));
    const result = [0];
    const ok = await callAsync(user32.SendMessageTimeoutW, hwnd, WM_NULL, 0, 0, SMTO_ABORTIFHUNG | SMTO_BLOCK, timeout, result);
    return Number(ok) !== 0;
  }
}
