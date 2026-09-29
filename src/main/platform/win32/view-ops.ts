/**
 * Win32 implementation of NativeViewOps.
 *
 * Threading rule: LibreOffice's windows belong to another process whose UI thread is input-attached
 * to ours (owner/owned or parent/child across threads). Every call that makes Windows send a message
 * to such a window runs on a koffi worker thread (`callAsync`), guarded by IsHungAppWindow, so a hung
 * engine can only block a worker, never Electron's UI thread. Reads that need no message
 * (IsWindow, GetWindowLongPtr, GetWindowRect, GetForegroundWindow, …) and all calls on our own
 * container window stay synchronous. Child-mode caveat: hiding the container while the LibreOffice
 * child inside it has the keyboard focus makes Windows send WM_KILLFOCUS to that child, which can
 * still block the UI thread on a hung engine (inherent to cross-process children; see ADR 0003).
 */
import type { Logger } from '../../log';
import type { Rect } from '../geometry';
import { canonicalHwnd, formatHwnd, sameHwnd, type Hwnd } from '../hwnd';
import { WindowBusyError, type NativeViewOps } from '../view-host-core';
import { captureWindow, type PngEncoder } from './capture';
import {
  GA_PARENT,
  GA_ROOTOWNER,
  GW_CHILD,
  GW_HWNDPREV,
  GW_OWNER,
  GWL_EXSTYLE,
  GWL_STYLE,
  GWLP_HWNDPARENT,
  HWND_TOP,
  LWA_ALPHA,
  SW_HIDE,
  SW_SHOWNOACTIVATE,
  SWP_FRAMECHANGED,
  SWP_HIDEWINDOW,
  SWP_NOACTIVATE,
  SWP_NOMOVE,
  SWP_NOOWNERZORDER,
  SWP_NOSIZE,
  SWP_NOZORDER,
  SWP_SHOWWINDOW,
  WS_EX_TOPMOST,
} from './constants';
import { callAsync, type Rect32, type Win32Api } from './ffi';
import { CONTAINER_EX_STYLE, CONTAINER_STYLE, isChildStyle, ownedPopupExStyle, ownedPopupStyle, toStyleBits } from './styles';

export function createWin32ViewOps(api: Win32Api, log: Logger, encodePng: PngEncoder): NativeViewOps {
  const { user32, kernel32 } = api;

  const assertResponsive = (hwnd: Hwnd): void => {
    if (!user32.IsWindow(hwnd)) throw new Error(`window ${formatHwnd(hwnd)} does not exist`);
    if (user32.IsHungAppWindow(hwnd)) throw new WindowBusyError();
  };
  const styleOf = (hwnd: Hwnd, index: number): number => toStyleBits(user32.GetWindowLongPtrW(hwnd, index));

  /**
   * hWndInsertAfter that puts `view` directly above `owner`: SetWindowPos places a window *below*
   * hWndInsertAfter, so use the window currently above the owner; HWND_TOP when there is none or it is
   * a topmost window (HWND_TOP never makes a window topmost). Undefined: already in place.
   */
  const insertAfterFor = (view: Hwnd, owner: Hwnd): Hwnd | undefined => {
    const prev = canonicalHwnd(user32.GetWindow(owner, GW_HWNDPREV));
    if (prev === null || (styleOf(prev, GWL_EXSTYLE) & WS_EX_TOPMOST) !== 0) return HWND_TOP;
    return sameHwnd(prev, view) ? undefined : prev;
  };

  return {
    clientArea(host) {
      const rect: Partial<Rect32> = {};
      const origin = { x: 0, y: 0 };
      if (!user32.GetClientRect(host, rect) || !user32.ClientToScreen(host, origin)) return null;
      return { origin, size: { width: (rect.right ?? 0) - (rect.left ?? 0), height: (rect.bottom ?? 0) - (rect.top ?? 0) } };
    },

    isWindow: (hwnd) => user32.IsWindow(hwnd),

    parentOf(hwnd) {
      if (!isChildStyle(styleOf(hwnd, GWL_STYLE))) return null;
      return canonicalHwnd(user32.GetAncestor(hwnd, GA_PARENT));
    },

    async makeOwned(view, host) {
      assertResponsive(view);
      const style = styleOf(view, GWL_STYLE);
      const exStyle = styleOf(view, GWL_EXSTYLE);
      if (
        sameHwnd(canonicalHwnd(user32.GetWindow(view, GW_OWNER)), host) &&
        style === ownedPopupStyle(style) &&
        exStyle === ownedPopupExStyle(exStyle) &&
        !user32.IsZoomed(view) &&
        !user32.IsIconic(view)
      ) {
        // The engine owned the frame before loading into it (engine/bridge/varak_bridge/owned.py). The loaded
        // frame may already be shown and active: hiding or restyling it from this worker thread is what hung
        // the UI thread (GUI spike 2026-09-29), so there is nothing to do.
        log.debug('Owned view ready (owned by the engine)', { hwnd: formatHwnd(view), windowDpi: user32.GetDpiForWindow(view), hostDpi: user32.GetDpiForWindow(host) });
        return;
      }
      // Fallback for a frame the engine did not own (no parentHwnd, older bridge).
      // Synchronous calls on the worker keep their order (ShowWindowAsync would be overtaken by
      // the sent style-change messages below).
      await callAsync(user32.ShowWindow, view, SW_HIDE);
      if (isChildStyle(styleOf(view, GWL_STYLE))) {
        // A createSystemChild frame: make it top-level first (SetParent does not touch the style bits).
        await callAsync(user32.SetParent, view, null);
      }
      if (user32.IsZoomed(view) || user32.IsIconic(view)) {
        // A maximized popup would be re-maximized by Windows on display changes: restore it (brief flash).
        await callAsync(user32.ShowWindow, view, SW_SHOWNOACTIVATE);
        await callAsync(user32.ShowWindow, view, SW_HIDE);
      }
      await callAsync(user32.SetWindowLongPtrW, view, GWL_STYLE, ownedPopupStyle(styleOf(view, GWL_STYLE)));
      await callAsync(user32.SetWindowLongPtrW, view, GWL_EXSTYLE, ownedPopupExStyle(styleOf(view, GWL_EXSTYLE)));
      await callAsync(user32.SetWindowLongPtrW, view, GWLP_HWNDPARENT, host);
      await callAsync(user32.SetWindowPos, view, null, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
      // Diagnostics for the GUI spike (DPI mismatch): the engine window's DPI as Windows sees it.
      log.debug('Owned view ready', { hwnd: formatHwnd(view), windowDpi: user32.GetDpiForWindow(view), hostDpi: user32.GetDpiForWindow(host) });
    },

    async place(view, rect, visible, above) {
      if (!user32.IsWindow(view)) return false;
      if (user32.IsHungAppWindow(view)) throw new WindowBusyError();
      let flags = SWP_NOACTIVATE | SWP_NOOWNERZORDER | (visible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW);
      if (!rect) flags |= SWP_NOMOVE | SWP_NOSIZE;
      const insertAfter = visible && above !== undefined ? insertAfterFor(view, above) : undefined;
      if (insertAfter === undefined) flags |= SWP_NOZORDER;
      const r: Rect = rect ?? { x: 0, y: 0, width: 0, height: 0 };
      const ok = await callAsync(user32.SetWindowPos, view, insertAfter ?? null, r.x, r.y, r.width, r.height, flags);
      if (ok) return true;
      if (!user32.IsWindow(view)) return false;
      throw new Error(`SetWindowPos failed for ${formatHwnd(view)}`);
    },

    createContainer(host) {
      const instance = kernel32.GetModuleHandleW(null);
      const hwnd = canonicalHwnd(user32.CreateWindowExW(CONTAINER_EX_STYLE, 'STATIC', '', CONTAINER_STYLE, 0, 0, 0, 0, host, null, instance, null));
      if (hwnd === null) throw new Error(`CreateWindowExW(STATIC) failed (${kernel32.GetLastError()})`);
      // A layered window is invisible until its attributes are set; alpha 255 = fully opaque.
      if (!user32.SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA)) {
        log.warn('SetLayeredWindowAttributes failed on the view container', { win32Error: kernel32.GetLastError() });
      }
      log.debug('View container created', { hwnd: formatHwnd(hwnd), host: formatHwnd(host) });
      return hwnd;
    },

    placeContainer(container, rect, visible, raise) {
      let flags = SWP_NOACTIVATE | (visible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW);
      if (!rect) flags |= SWP_NOMOVE | SWP_NOSIZE;
      if (!raise) flags |= SWP_NOZORDER;
      const r: Rect = rect ?? { x: 0, y: 0, width: 0, height: 0 };
      if (!user32.SetWindowPos(container, HWND_TOP, r.x, r.y, r.width, r.height, flags)) {
        throw new Error(`SetWindowPos failed for container ${formatHwnd(container)} (${kernel32.GetLastError()})`);
      }
    },

    destroyContainer(container) {
      if (!user32.IsWindow(container)) return;
      if (user32.GetWindow(container, GW_CHILD)) {
        // Destroying it would synchronously destroy a LibreOffice child on its thread; the host
        // window takes it down when it closes.
        log.warn('View container still has native children; left to the host window', { hwnd: formatHwnd(container) });
        return;
      }
      user32.DestroyWindow(container);
    },

    async activate(view) {
      const pid = [0];
      if (user32.GetWindowThreadProcessId(view, pid) && pid[0]) user32.AllowSetForegroundWindow(pid[0]);
      await callAsync(user32.SetForegroundWindow, view);
    },

    foreground: () => canonicalHwnd(user32.GetForegroundWindow()),

    rootOwner: (hwnd) => canonicalHwnd(user32.GetAncestor(hwnd, GA_ROOTOWNER)),

    capture: (view, timeoutMs) => captureWindow(api, view, timeoutMs, encodePng, log),
  };
}
