/**
 * Coordinate mapping between the renderer (CSS pixels), Electron (DIP) and Win32 (physical pixels).
 * Pure functions; no Electron or koffi imports.
 *
 * Document area → native window (both hosting modes):
 *
 *   s          = zoomFactor × scaleFactor        (CSS px → DIP → physical px)
 *   left       = round(css.x × s)                top    = round(css.y × s)
 *   right      = round((css.x + css.width) × s)  bottom = round((css.y + css.height) × s)
 *   client     = [left, right) × [top, bottom), clipped to the host's client area
 *   screen     = client + clientOrigin           (owned mode only)
 *
 * `clientOrigin` is the physical screen position of the host's client area (Win32 ClientToScreen
 * from a per-monitor-aware thread), so no DIP → physical conversion of the window position is
 * needed; that conversion is not a plain multiplication on mixed-DPI desktops because Chromium lays
 * out each display's DIP rectangle separately. Edges are rounded independently (half away from
 * zero, like Chromium's gfx::ToRoundedInt) so neighbouring rectangles never gap or overlap.
 *
 * DPI virtualisation (Electron = per-monitor v1, LibreOffice = System-aware):
 * a System-aware process on a monitor whose DPI differs from its system DPI sees scaled
 * ("virtualised") coordinates, and Windows bitmap-stretches its windows:
 *
 *   virtual = round(physical × processDpi / monitorDpi)      physical = round(virtual × monitorDpi / processDpi)
 *
 * Coordinates are scaled from the virtual-screen origin (0,0), not from the monitor's corner
 * (observed on Windows 8.1, Mozilla bug 890156 comment 5; to be re-verified on Windows 11 in the GUI
 * spike). Positions set from our per-monitor-aware threads are physical and Windows converts them for
 * the target window, so the view host never needs this for SetWindowPos. It matters for what the
 * LibreOffice process itself sees: the size of its window surface (and thus of a PrintWindow capture)
 * is the physical size × processDpi / monitorDpi.
 */
import type { CssRect } from '@shared/api/engine';
import type { Bounds } from '@shared/engine-protocol';

export type Rect = Bounds;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface HostMetrics {
  /** Physical screen position of the host's client (web content) origin. */
  clientOrigin: Point;
  /** Physical size of the client area. */
  clientSize: Size;
  /** Device scale factor of the host's display (monitor DPI / 96 unless forced). */
  scaleFactor: number;
  /** webContents zoom factor (CSS px → DIP). */
  zoomFactor: number;
}

export const USER_DEFAULT_SCREEN_DPI = 96;

/** Rounds half away from zero (std::round, Win32 MulDiv semantics). */
export function roundHalfAway(value: number): number {
  const r = Math.round(Math.abs(value));
  return value < 0 ? -r : r;
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function isValidCssRect(rect: unknown): rect is CssRect {
  if (typeof rect !== 'object' || rect === null) return false;
  const r = rect as Record<string, unknown>;
  return (
    [r['x'], r['y'], r['width'], r['height']].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    (r['width'] as number) >= 0 &&
    (r['height'] as number) >= 0
  );
}

/** Scales a rectangle by rounding each edge independently. */
export function scaleRectEdges(rect: CssRect, factor: number): Rect {
  const left = roundHalfAway(rect.x * factor);
  const top = roundHalfAway(rect.y * factor);
  const right = roundHalfAway((rect.x + rect.width) * factor);
  const bottom = roundHalfAway((rect.y + rect.height) * factor);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function intersectRects(a: Rect, b: Rect): Rect {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return { x: left, y: top, width: 0, height: 0 };
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function rectsEqual(a: Rect | null | undefined, b: Rect | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function isEmptyRect(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

/** Physical px per CSS px of the host's web content. */
export function cssToPhysicalFactor(m: Pick<HostMetrics, 'scaleFactor' | 'zoomFactor'>): number {
  return positiveOr(m.zoomFactor, 1) * positiveOr(m.scaleFactor, 1);
}

/** Document-area rectangle relative to the host's client area (physical px), clipped to it. */
export function cssToClientRect(css: CssRect, m: HostMetrics): Rect {
  const scaled = scaleRectEdges(css, cssToPhysicalFactor(m));
  return intersectRects(scaled, { x: 0, y: 0, width: Math.max(0, m.clientSize.width), height: Math.max(0, m.clientSize.height) });
}

/** Document-area rectangle in physical screen coordinates (owned mode), clipped to the client area. */
export function cssToScreenRect(css: CssRect, m: HostMetrics): Rect {
  const client = cssToClientRect(css, m);
  return { x: client.x + m.clientOrigin.x, y: client.y + m.clientOrigin.y, width: client.width, height: client.height };
}

/** The whole client area in physical screen coordinates. */
export function clientScreenRect(m: HostMetrics): Rect {
  return { x: m.clientOrigin.x, y: m.clientOrigin.y, width: Math.max(0, m.clientSize.width), height: Math.max(0, m.clientSize.height) };
}

function scaleEdgesDpi(rect: Rect, numerator: number, denominator: number): Rect {
  const f = (v: number): number => roundHalfAway((v * numerator) / denominator);
  const left = f(rect.x);
  const top = f(rect.y);
  return { x: left, y: top, width: Math.max(0, f(rect.x + rect.width) - left), height: Math.max(0, f(rect.y + rect.height) - top) };
}

/** Physical rectangle → the coordinates a process with `processDpi` (System-aware/unaware) sees on that monitor. */
export function physicalToVirtualized(rect: Rect, monitorDpi: number, processDpi: number): Rect {
  return scaleEdgesDpi(rect, positiveOr(processDpi, USER_DEFAULT_SCREEN_DPI), positiveOr(monitorDpi, USER_DEFAULT_SCREEN_DPI));
}

/** Inverse of physicalToVirtualized. */
export function virtualizedToPhysical(rect: Rect, monitorDpi: number, processDpi: number): Rect {
  return scaleEdgesDpi(rect, positiveOr(monitorDpi, USER_DEFAULT_SCREEN_DPI), positiveOr(processDpi, USER_DEFAULT_SCREEN_DPI));
}

/**
 * Size of a window's own drawing surface: what a DPI-virtualised window paints into (and what
 * PrintWindow returns) when its physical size is `physical`. Equal to `physical` whenever the window's
 * DPI matches the monitor's (always true for per-monitor-aware windows).
 */
export function surfaceSize(physical: Size, windowDpi: number, monitorDpi: number): Size {
  const w = positiveOr(windowDpi, USER_DEFAULT_SCREEN_DPI);
  const m = positiveOr(monitorDpi, USER_DEFAULT_SCREEN_DPI);
  if (w === m) return { width: Math.max(0, physical.width), height: Math.max(0, physical.height) };
  return {
    width: Math.max(0, roundHalfAway((physical.width * w) / m)),
    height: Math.max(0, roundHalfAway((physical.height * w) / m)),
  };
}
