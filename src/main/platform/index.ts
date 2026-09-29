/**
 * Platform layer entry point: native document views, process guard, hang detection and shell keys.
 * Windows gets the koffi-based implementation; other platforms (or a missing koffi binary) get the
 * fallback, where `viewHost.supported === false`.
 *
 * Call once, early in main-process startup (before engine processes are spawned).
 * VARAK_PROCESS_GUARD=self makes the app process itself join the kill-on-close job instead of only
 * adopted processes; see win32/process-guard.ts for the trade-off.
 */
import { createLogger } from '../log';
import { createFallbackPlatform } from './fallback';
import type { Platform } from './types';
import { win32, win32LoadError } from './win32/ffi';
import { Win32HangDetector } from './win32/hang-detector';
import { Win32ProcessGuard } from './win32/process-guard';
import { Win32ShellKeys } from './win32/shell-keys';
import { createWin32ViewHost } from './win32/view-host';

export function createPlatform(): Platform {
  const log = createLogger('platform');
  const api = win32();
  if (!api) {
    if (process.platform === 'win32') log.error('Win32 bindings unavailable; native document views are disabled', { error: win32LoadError() });
    return createFallbackPlatform(log);
  }
  const viewHost = createWin32ViewHost(api, log.child('view'));
  return {
    viewHost,
    processGuard: new Win32ProcessGuard(api, {
      mode: process.env['VARAK_PROCESS_GUARD'] === 'self' ? 'self' : 'adopt',
      log: log.child('process'),
    }),
    hangDetector: new Win32HangDetector(api),
    allowForeground: (pid) => {
      if (!api.user32.AllowSetForegroundWindow(pid)) log.debug('AllowSetForegroundWindow refused', { pid });
    },
    shellKeys: new Win32ShellKeys(api, (win, hwnd) => viewHost.ownsForeground(win, hwnd), log.child('keys')),
  };
}
