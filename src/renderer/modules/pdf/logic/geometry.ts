/**
 * Viewport ↔ PDF coordinate conversion (same math as pdf.js' PageViewport) and placement helpers for
 * "Add text" / "Add image". Kept free of DOM and pdf.js types so it can be unit-tested in Node.
 */

export type Matrix = [number, number, number, number, number, number];
/** PDF page box [x1, y1, x2, y2] (pdf.js `page.view`). */
export type ViewBox = [number, number, number, number];

/** pdf.js CSS pixels per PDF point (96 / 72). */
export const PDF_TO_CSS_UNITS = 96 / 72;

export function normalizeQuarterTurn(deg: number): 0 | 90 | 180 | 270 {
  const q = ((Math.round(deg / 90) % 4) + 4) % 4;
  return (q * 90) as 0 | 90 | 180 | 270;
}

/** Transform from PDF user space to viewport pixels (PageViewport.transform with offsets 0, no flip). */
export function viewportTransform(viewBox: ViewBox, scale: number, rotation: number, userUnit = 1): Matrix {
  const s = scale * userUnit;
  const [x1, y1, x2, y2] = viewBox;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  let a: number;
  let b: number;
  let c: number;
  let d: number;
  switch (normalizeQuarterTurn(rotation)) {
    case 90:
      [a, b, c, d] = [0, 1, 1, 0];
      break;
    case 180:
      [a, b, c, d] = [-1, 0, 0, 1];
      break;
    case 270:
      [a, b, c, d] = [0, -1, -1, 0];
      break;
    default:
      [a, b, c, d] = [1, 0, 0, -1];
  }
  const offX = a === 0 ? Math.abs(cy - y1) * s : Math.abs(cx - x1) * s;
  const offY = a === 0 ? Math.abs(cx - x1) * s : Math.abs(cy - y1) * s;
  return [a * s, b * s, c * s, d * s, offX - a * s * cx - c * s * cy, offY - b * s * cx - d * s * cy];
}

export function applyTransform(m: Matrix, x: number, y: number): [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

export function applyInverseTransform(m: Matrix, x: number, y: number): [number, number] {
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    (x * m[3] - y * m[2] + m[2] * m[5] - m[4] * m[3]) / det,
    (-x * m[1] + y * m[0] + m[4] * m[1] - m[5] * m[0]) / det,
  ];
}

/** Displayed page size in viewport pixels. */
export function viewportSize(viewBox: ViewBox, scale: number, rotation: number): { width: number; height: number } {
  const w = (viewBox[2] - viewBox[0]) * scale;
  const h = (viewBox[3] - viewBox[1]) * scale;
  return normalizeQuarterTurn(rotation) % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

export interface PageBoxOnScreen {
  /** Client rect of the page element's content box (inside its border). */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Client (mouse) position → PDF user space for a page shown with `transform`.
 * Returns null when the point lies outside the page.
 */
export function clientToPdf(box: PageBoxOnScreen, transform: Matrix, clientX: number, clientY: number): [number, number] | null {
  const x = clientX - box.left;
  const y = clientY - box.top;
  if (x < 0 || y < 0 || x > box.width || y > box.height) return null;
  return applyInverseTransform(transform, x, y);
}

/**
 * Default displayed size (points) of an inserted image: its pixel size at 96 dpi, scaled down to fit
 * half of the displayed page, never below 8 pt.
 */
export function defaultImageSize(pixelWidth: number, pixelHeight: number, pageWidthPt: number, pageHeightPt: number): { width: number; height: number } {
  const w = Math.max(1, pixelWidth) * 0.75;
  const h = Math.max(1, pixelHeight) * 0.75;
  const fit = Math.min(1, (pageWidthPt * 0.5) / w, (pageHeightPt * 0.5) / h);
  return { width: Math.max(8, w * fit), height: Math.max(8, h * fit) };
}

/** Displayed page size in points (rotation applied). */
export function displayedPageSize(viewBox: ViewBox, rotation: number): { width: number; height: number } {
  return viewportSize(viewBox, 1, rotation);
}
