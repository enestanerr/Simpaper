/** Keyboard navigation between form fields in reading order (pages render lazily, so it works on data). */

export interface FieldStop {
  /** Annotation id; pdf.js renders the control with `data-element-id="<id>"`. */
  id: string;
  /** 0-based page index. */
  page: number;
  rect: [number, number, number, number];
}

interface RawField {
  id?: unknown;
  page?: unknown;
  rect?: unknown;
  type?: unknown;
  hidden?: unknown;
  editable?: unknown;
}

const NAVIGABLE = new Set(['text', 'checkbox', 'radiobutton', 'combobox', 'listbox']);

/** Builds the tab order from `PDFDocumentProxy.getFieldObjects()` (a Map or a plain object of arrays). */
export function fieldStops(fieldObjects: unknown): FieldStop[] {
  const groups: unknown[] =
    fieldObjects instanceof Map ? [...fieldObjects.values()] : fieldObjects && typeof fieldObjects === 'object' ? Object.values(fieldObjects) : [];
  const stops: FieldStop[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const raw of group as RawField[]) {
      if (typeof raw.id !== 'string' || typeof raw.page !== 'number' || raw.page < 0) continue;
      if (raw.hidden === true || raw.editable === false || !NAVIGABLE.has(String(raw.type))) continue;
      if (!Array.isArray(raw.rect) || raw.rect.length !== 4 || seen.has(raw.id)) continue;
      seen.add(raw.id);
      stops.push({ id: raw.id, page: raw.page, rect: raw.rect.map(Number) as FieldStop['rect'] });
    }
  }
  // Reading order: page, then top to bottom (PDF y grows upwards), then left to right.
  return stops.sort((a, b) => a.page - b.page || Math.max(b.rect[1], b.rect[3]) - Math.max(a.rect[1], a.rect[3]) || Math.min(a.rect[0], a.rect[2]) - Math.min(b.rect[0], b.rect[2]));
}

/** Index of the next/previous stop, wrapping around; `current` -1 means "none focused". */
export function nextStop(count: number, current: number, direction: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return direction > 0 ? 0 : count - 1;
  return (current + direction + count) % count;
}
