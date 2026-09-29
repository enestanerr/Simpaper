/**
 * Adaptive ribbon layout (pure). Each group has four size levels:
 *   0 full · 1 large buttons become small (rows: combos narrower) · 2 icon-only (rows: combos narrowest)
 *   3 collapsed into a single group button that opens the group in a popup.
 * Groups are reduced one level at a time from the right, first all to level 1, then 2, then 3,
 * until the ribbon fits (the Office scaling order).
 */
import type { RibbonControl, RibbonGroup } from './types';

export type GroupLevel = 0 | 1 | 2 | 3;
export const MAX_LEVEL: GroupLevel = 3;

export type MeasureText = (text: string) => number;

/** Rough width of UI text at 12px Segoe UI when no canvas is available (tests). */
export const approximateMeasure: MeasureText = (text) => Math.ceil(text.length * 6.4);

const GROUP_PADDING = 12;
const GROUP_SEPARATOR = 1;
const COLLAPSED_GROUP_WIDTH = 56;
const ROW_GAP = 2;
const COLUMN_GAP = 2;

/** Splits a label into at most two lines at the space closest to the middle (large buttons). */
export function splitLabel(label: string): [string, string?] {
  const words = label.trim().split(/\s+/);
  if (words.length < 2) return [label];
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    const diff = Math.abs(a - b);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

function hasDropdown(control: RibbonControl): boolean {
  return control.type === 'split' || control.type === 'menu' || control.type === 'color';
}

export function isLarge(control: RibbonControl, level: GroupLevel): boolean {
  if (level >= 1) return false;
  return 'size' in control && control.size === 'large';
}

export function comboWidthPx(chars: number, level: GroupLevel): number {
  const factor = level === 0 ? 1 : level === 1 ? 0.75 : 0.55;
  return Math.max(44, Math.round(chars * 7 * factor) + 22);
}

export function showsLabel(control: RibbonControl, level: GroupLevel, layout: 'columns' | 'rows'): boolean {
  if (control.type === 'combo' || control.type === 'custom' || control.type === 'gallery') return false;
  if (control.type === 'color') return false;
  if (layout === 'rows') return isLarge(control, level);
  return level < 2;
}

export function galleryInline(control: RibbonControl, level: GroupLevel): number {
  if (control.type !== 'gallery') return 0;
  const n = control.inlineCount ?? 4;
  if (level === 0) return n;
  if (level === 1) return Math.min(n, 3);
  return 0;
}

export function controlWidth(control: RibbonControl, level: GroupLevel, layout: 'columns' | 'rows', label: string, measure: MeasureText): number {
  switch (control.type) {
    case 'combo':
      return comboWidthPx(control.width ?? 12, level);
    case 'custom':
      return control.estimatedWidth ?? 64;
    case 'gallery': {
      const inline = galleryInline(control, level);
      return inline > 0 ? inline * 74 + 20 : Math.max(52, Math.min(90, measure(label) + 16));
    }
    case 'color':
      return 38;
    default:
      break;
  }
  const arrow = hasDropdown(control) ? 12 : 0;
  if (isLarge(control, level)) {
    const [a, b] = splitLabel(label);
    const text = Math.max(measure(a), b ? measure(b) + (arrow ? 10 : 0) : 0);
    return Math.max(44, text + 14, 32 + 12);
  }
  if (showsLabel(control, level, layout)) return 22 + 6 + measure(label) + 10 + arrow;
  return 26 + arrow;
}

/** Width of a group at a level. `labelOf` resolves a control's (translated) label. */
export function groupWidth(
  group: RibbonGroup,
  level: GroupLevel,
  labelOf: (control: RibbonControl) => string,
  measure: MeasureText,
  groupLabel: string,
): number {
  if (level >= 3) return COLLAPSED_GROUP_WIDTH + GROUP_SEPARATOR;
  const layout = group.layout ?? 'columns';
  let content = 0;
  if (layout === 'rows') {
    const leading = group.controls.filter((c) => isLarge(c, level));
    for (const c of leading) content += controlWidth(c, level, layout, labelOf(c), measure) + COLUMN_GAP;
    const rows = splitRows(group.controls.filter((c) => !isLarge(c, level)));
    let widest = 0;
    for (const row of rows) {
      const w = row.reduce((sum, c) => sum + controlWidth(c, level, layout, labelOf(c), measure) + ROW_GAP, 0);
      widest = Math.max(widest, w);
    }
    content += widest;
  } else {
    for (const column of columnsOf(group.controls, level)) {
      content += Math.max(...column.map((c) => controlWidth(c, level, layout, labelOf(c), measure))) + COLUMN_GAP;
    }
  }
  const title = measure(groupLabel) + 16;
  return Math.max(content, title) + GROUP_PADDING + GROUP_SEPARATOR;
}

/** `rows` layout: splits controls at `newRow` markers. */
export function splitRows(controls: RibbonControl[]): RibbonControl[][] {
  const rows: RibbonControl[][] = [];
  for (const c of controls) {
    if (rows.length === 0 || c.newRow) rows.push([]);
    rows[rows.length - 1]!.push(c);
  }
  return rows;
}

/** `columns` layout: a large control or gallery fills a column, small controls stack in threes. */
export function columnsOf(controls: RibbonControl[], level: GroupLevel): RibbonControl[][] {
  const columns: RibbonControl[][] = [];
  let stack: RibbonControl[] = [];
  const flush = () => {
    if (stack.length) columns.push(stack);
    stack = [];
  };
  for (const c of controls) {
    // A gallery is always full height: inline items, or a large drop-down button when none fit (GalleryView).
    const fullHeight = isLarge(c, level) || c.type === 'gallery';
    if (fullHeight) {
      flush();
      columns.push([c]);
    } else {
      stack.push(c);
      if (stack.length === 3) flush();
    }
  }
  flush();
  return columns;
}

/**
 * Correction applied after measuring the rendered panel. The width estimates can be optimistic
 * (fonts, zoom): when the content overflows its box by more than a pixel, the overflow plus a small
 * margin is taken off the available width. Monotonic and bounded by `width`, so repeated measuring
 * always settles.
 */
export function nextCorrection(scrollWidth: number, clientWidth: number, width: number, correction: number): number {
  const overflow = scrollWidth - clientWidth;
  if (overflow <= 1 || correction >= width) return correction;
  return Math.min(width, correction + overflow + 8);
}

/**
 * Chooses a level for every group so that the total width fits `available`.
 * `widths[g][level]` is the width of group g at that level (length 4).
 */
export function computeGroupLevels(widths: readonly (readonly number[])[], available: number): GroupLevel[] {
  const levels: GroupLevel[] = widths.map(() => 0);
  const total = () => levels.reduce<number>((sum, lvl, g) => sum + (widths[g]?.[lvl] ?? 0), 0);
  if (total() <= available) return levels;
  for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
    for (let g = widths.length - 1; g >= 0; g--) {
      const current = levels[g] ?? 0;
      if (current >= lvl) continue;
      // Only steps that make the group narrower: a large button turning into a labelled small one can
      // widen a group (Clipboard: Paste large + three labelled buttons), and a tiny group may be narrower
      // than its collapsed button. Such steps are skipped; the next level is tried in the next pass.
      const w = widths[g];
      if (!w || (w[lvl] ?? Number.POSITIVE_INFINITY) >= (w[current] ?? 0)) continue;
      levels[g] = lvl as GroupLevel;
      if (total() <= available) return levels;
    }
  }
  return levels;
}
