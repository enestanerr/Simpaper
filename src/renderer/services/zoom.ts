/** Zoom helpers for office documents (`.uno:Zoom` with `Zoom.Value`, verified on LibreOffice 26.8). */
import { dispatchUno } from './engine';

export const ZOOM_MIN = 20;
export const ZOOM_MAX = 400;
const STEPS = [20, 25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];

export function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)));
}

/** Next zoom step in the given direction (Office-like stops). */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return STEPS.find((s) => s > current) ?? ZOOM_MAX;
  for (let i = STEPS.length - 1; i >= 0; i--) {
    const s = STEPS[i];
    if (s !== undefined && s < current) return s;
  }
  return ZOOM_MIN;
}

/** Slider position (0..1000) ↔ zoom: logarithmic so 100 % sits in the middle of the track. */
export function zoomToSlider(zoom: number): number {
  const z = clampZoom(zoom);
  return Math.round((Math.log(z / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)) * 1000);
}

export function sliderToZoom(position: number): number {
  const z = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, Math.min(1000, Math.max(0, position)) / 1000);
  // Snap to 100 % near the middle, like Office.
  return Math.abs(z - 100) < 4 ? 100 : clampZoom(z);
}

export function setOfficeZoom(docId: string, value: number): Promise<boolean> {
  return dispatchUno(docId, '.uno:Zoom', { 'Zoom.Value': clampZoom(value) }, { focus: false });
}
