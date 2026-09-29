/**
 * Geometry for placing new content on a page so that it appears upright and anchored at its top-left
 * corner as the page is displayed (i.e. with the page's /Rotate applied).
 */

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface Point {
  x: number;
  y: number;
}

/** Normalises any multiple of 90° to 0/90/180/270 (other angles snap to the nearest quarter turn). */
export function normalizeRotation(deg: number): QuarterTurn {
  const q = ((Math.round(deg / 90) % 4) + 4) % 4;
  return (q * 90) as QuarterTurn;
}

/**
 * Unit vectors, in PDF user space, of the displayed page's "right" and "down" directions.
 * /Rotate turns the page clockwise for display, so PDF +x appears pointing down at 90°.
 */
export function displayAxes(rotation: QuarterTurn): { right: Point; down: Point } {
  switch (rotation) {
    case 90:
      return { right: { x: 0, y: 1 }, down: { x: 1, y: 0 } };
    case 180:
      return { right: { x: -1, y: 0 }, down: { x: 0, y: 1 } };
    case 270:
      return { right: { x: 0, y: -1 }, down: { x: -1, y: 0 } };
    default:
      return { right: { x: 1, y: 0 }, down: { x: 0, y: -1 } };
  }
}

/**
 * Baseline origin of the first line of a text block whose top-left corner is `anchor`.
 * Draw with `rotate: degrees(rotation)` so the glyphs follow the displayed orientation.
 */
export function firstBaseline(anchor: Point, rotation: QuarterTurn, ascent: number): Point {
  const { down } = displayAxes(rotation);
  return { x: anchor.x + down.x * ascent, y: anchor.y + down.y * ascent };
}

/**
 * Origin (the image's own bottom-left corner) for drawing an image whose displayed top-left corner is
 * `anchor` and whose displayed height is `height`, rotated by `rotation`.
 */
export function imageOrigin(anchor: Point, rotation: QuarterTurn, height: number): Point {
  const { down } = displayAxes(rotation);
  return { x: anchor.x + down.x * height, y: anchor.y + down.y * height };
}
