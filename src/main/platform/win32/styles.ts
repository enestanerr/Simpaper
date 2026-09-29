/** Window-style computations for the two hosting modes (pure; unit-tested). */
import {
  WS_CAPTION,
  WS_CHILD,
  WS_CLIPCHILDREN,
  WS_CLIPSIBLINGS,
  WS_EX_APPWINDOW,
  WS_EX_CLIENTEDGE,
  WS_EX_DLGMODALFRAME,
  WS_EX_LAYERED,
  WS_EX_NOPARENTNOTIFY,
  WS_EX_STATICEDGE,
  WS_EX_TOOLWINDOW,
  WS_EX_WINDOWEDGE,
  WS_MAXIMIZEBOX,
  WS_MINIMIZEBOX,
  WS_POPUP,
  WS_SYSMENU,
  WS_THICKFRAME,
} from './constants';

const OWNED_STYLE_REMOVE = WS_CHILD | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
const OWNED_STYLE_ADD = WS_POPUP | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
const OWNED_EX_REMOVE = WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME | WS_EX_STATICEDGE;
const OWNED_EX_ADD = WS_EX_TOOLWINDOW;

/** Normalises a style value (GetWindowLongPtr may return it sign- or zero-extended) to uint32. */
export function toStyleBits(value: number | bigint): number {
  return Number(BigInt.asUintN(32, BigInt(value)));
}

/**
 * Borderless popup for `owned` mode: no caption, frame, system menu or min/max boxes; WS_CHILD is
 * dropped (a createSystemChild frame becomes top-level); visibility, WS_DISABLED and the
 * maximized/minimized state bits are left untouched.
 */
export function ownedPopupStyle(style: number): number {
  return (((style >>> 0) & ~OWNED_STYLE_REMOVE) | OWNED_STYLE_ADD) >>> 0;
}

/** No taskbar button / Alt+Tab entry (WS_EX_TOOLWINDOW, no WS_EX_APPWINDOW) and no 3-D edges. */
export function ownedPopupExStyle(exStyle: number): number {
  return (((exStyle >>> 0) & ~OWNED_EX_REMOVE) | OWNED_EX_ADD) >>> 0;
}

export function isChildStyle(style: number): boolean {
  return ((style >>> 0) & WS_CHILD) !== 0;
}

/**
 * Intermediate container for `child` mode (predefined STATIC class, so no JS window procedure).
 * Created hidden: a layered window stays invisible until SetLayeredWindowAttributes has run, and it
 * is shown only while one of its document views is visible (otherwise its background would cover the
 * web content).
 */
export const CONTAINER_STYLE = (WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS) >>> 0;

/**
 * WS_EX_LAYERED gives the container its own redirection surface: Chromium ≥ 139 creates top-level
 * windows with WS_EX_NOREDIRECTIONBITMAP, which leaves GDI-painted children invisible otherwise.
 */
export const CONTAINER_EX_STYLE = (WS_EX_LAYERED | WS_EX_NOPARENTNOTIFY) >>> 0;
