/** Electron binding of the view host: BrowserWindow adapter + Win32 native operations. */
import { nativeImage, screen, type BrowserWindow } from 'electron';
import type { Logger } from '../../log';
import { USER_DEFAULT_SCREEN_DPI } from '../geometry';
import { hwndFromBuffer } from '../hwnd';
import { ViewHostCore, type HostEvent, type HostWindow } from '../view-host-core';
import { WM_DPICHANGED, WM_WINDOWPOSCHANGED } from './constants';
import type { Win32Api } from './ffi';
import { createWin32ViewOps } from './view-ops';

export type Win32ViewHost = ViewHostCore<BrowserWindow>;

export function createWin32ViewHost(api: Win32Api, log: Logger): Win32ViewHost {
  const ops = createWin32ViewOps(api, log, (bgra, width, height) => nativeImage.createFromBitmap(bgra, { width, height }).toDataURL());
  return new ViewHostCore<BrowserWindow>({
    ops,
    adapt: (win) => electronHostWindow(win, api),
    log,
    syncMessages: [WM_DPICHANGED, WM_WINDOWPOSCHANGED],
  });
}

function electronHostWindow(win: BrowserWindow, api: Win32Api): HostWindow {
  // BrowserWindow's typed overloads do not accept an event-name union.
  const emitter = win as unknown as NodeJS.EventEmitter;
  const handle = () => hwndFromBuffer(win.getNativeWindowHandle());
  return {
    isDestroyed: () => win.isDestroyed(),
    isMinimized: () => win.isMinimized(),
    isVisible: () => win.isVisible(),
    nativeHandle: handle,
    zoomFactor: () => (win.webContents.isDestroyed() ? 1 : win.webContents.getZoomFactor()),
    scaleFactor: () => {
      try {
        // Chromium's device scale factor for the window (also honours --force-device-scale-factor).
        return screen.getDisplayMatching(win.getBounds()).scaleFactor;
      } catch {
        const hwnd = handle();
        const dpi = hwnd === null ? 0 : api.user32.GetDpiForWindow(hwnd);
        return dpi > 0 ? dpi / USER_DEFAULT_SCREEN_DPI : 1;
      }
    },
    on: (event: HostEvent, listener: () => void) => void emitter.on(event, listener),
    off: (event: HostEvent, listener: () => void) => void emitter.removeListener(event, listener),
    hookMessage: (message, listener) => win.hookWindowMessage(message, () => listener()),
    unhookMessage: (message) => win.unhookWindowMessage(message),
  };
}
