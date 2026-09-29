/**
 * Adaptive ribbon layout: group size levels (full → small → icon-only → collapsed), the Office scaling order
 * (right to left, one level at a time), column/row arrangement and the overflow correction loop.
 */
import { describe, expect, it } from 'vitest';
import { calcModule } from '../../../src/renderer/modules/calc';
import { impressModule } from '../../../src/renderer/modules/impress';
import { writerModule } from '../../../src/renderer/modules/writer';
import {
  approximateMeasure,
  columnsOf,
  comboWidthPx,
  computeGroupLevels,
  controlWidth,
  galleryInline,
  groupWidth,
  isLarge,
  nextCorrection,
  showsLabel,
  splitLabel,
  splitRows,
  type GroupLevel,
} from '../../../src/renderer/ribbon/layout';
import type { RibbonControl, RibbonGroup } from '../../../src/renderer/ribbon/types';

const button = (id: string, size: 'large' | 'small' = 'small', extra: Partial<RibbonControl> = {}): RibbonControl =>
  ({ type: 'button', id, labelKey: id, size, action: { type: 'uno', command: '.uno:Bold' }, ...extra }) as RibbonControl;

const label = (c: RibbonControl) => `Label ${c.id}`;
const LEVELS: GroupLevel[] = [0, 1, 2, 3];

describe('labels', () => {
  it('splits large-button labels at the space closest to the middle', () => {
    expect(splitLabel('Paste')).toEqual(['Paste']);
    expect(splitLabel('Format Painter')).toEqual(['Format', 'Painter']);
    expect(splitLabel('Sayfa sonu önizleme')).toEqual(['Sayfa sonu', 'önizleme']);
    expect(splitLabel('Bu Slayda Geçiş Ekle')).toEqual(['Bu Slayda', 'Geçiş Ekle']);
  });
});

describe('control sizes', () => {
  it('shrinks large controls and labels level by level', () => {
    const big = button('paste', 'large');
    const small = button('cut');
    expect(isLarge(big, 0)).toBe(true);
    expect(isLarge(big, 1)).toBe(false);
    expect(showsLabel(small, 0, 'columns')).toBe(true);
    expect(showsLabel(small, 1, 'columns')).toBe(true);
    expect(showsLabel(small, 2, 'columns')).toBe(false);
    expect(showsLabel(small, 0, 'rows')).toBe(false);
    expect(controlWidth(small, 2, 'columns', 'Cut', approximateMeasure)).toBeLessThan(controlWidth(small, 1, 'columns', 'Cut', approximateMeasure));
  });

  it('narrows combo boxes and folds galleries into a button', () => {
    expect(comboWidthPx(17, 0)).toBeGreaterThan(comboWidthPx(17, 1));
    expect(comboWidthPx(17, 1)).toBeGreaterThan(comboWidthPx(17, 2));
    expect(comboWidthPx(1, 2)).toBe(44);
    const gallery = { type: 'gallery', id: 'g', labelKey: 'g', items: [], inlineCount: 4 } as unknown as RibbonControl;
    expect(galleryInline(gallery, 0)).toBe(4);
    expect(galleryInline(gallery, 1)).toBe(3);
    expect(galleryInline(gallery, 2)).toBe(0);
  });
});

describe('arrangement', () => {
  it('stacks small controls in threes between large ones', () => {
    const controls = [button('a', 'large'), button('b'), button('c'), button('d'), button('e'), button('f', 'large')];
    expect(columnsOf(controls, 0).map((col) => col.map((c) => c.id))).toEqual([['a'], ['b', 'c', 'd'], ['e'], ['f']]);
    // At level 1 large buttons become small and stack too.
    expect(columnsOf(controls, 1).map((col) => col.map((c) => c.id))).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']]);
  });

  it('gives a gallery without inline items (a large drop-down button) its own column', () => {
    // GUI spike: Impress Home › Slides stacked the Layout gallery button and Delete slide, and the stack ran into the
    // group label.
    const layouts = { type: 'gallery', id: 'layout', labelKey: 'layout', inlineCount: 0, items: [] } as unknown as RibbonControl;
    const controls = [button('new', 'large'), layouts, button('delete')];
    for (const level of [0, 1, 2] as GroupLevel[]) {
      expect(columnsOf(controls, level).map((col) => col.map((c) => c.id)), `level ${level}`).toEqual([['new'], ['layout'], ['delete']]);
    }
    const impressSlides = impressModule.ribbon.tabs.flatMap((t) => t.groups).find((g) => g.id === 'slides' && g.controls.some((c) => c.id === 'slideLayout'));
    const column = columnsOf(impressSlides!.controls, 0).find((col) => col.some((c) => c.id === 'slideLayout'));
    expect(column?.map((c) => c.id)).toEqual(['slideLayout']);
  });

  it('splits row layouts at newRow markers', () => {
    const rows = splitRows([button('font'), button('size'), button('bold', 'small', { newRow: true }), button('italic')]);
    expect(rows.map((r) => r.map((c) => c.id))).toEqual([['font', 'size'], ['bold', 'italic']]);
  });
});

describe('group widths', () => {
  const tabs = [writerModule, calcModule, impressModule].flatMap((m) => m.ribbon.tabs.map((tab) => ({ name: `${m.kind}/${tab.id}`, tab })));
  const widthsOf = (groups: readonly RibbonGroup[]) => groups.map((g) => LEVELS.map((lvl) => groupWidth(g, lvl, label, approximateMeasure, g.labelKey)));

  it('collapse to a fixed-size button, the narrowest form of a group with content', () => {
    for (const { name, tab } of tabs) {
      for (const [i, w] of widthsOf(tab.groups).entries()) {
        expect(w[3], `${name}/${tab.groups[i]!.id}`).toBe(57);
        expect(w[2]!, `${name}/${tab.groups[i]!.id}`).toBeLessThanOrEqual(w[0]!);
      }
    }
  });

  it('shrink every real ribbon tab monotonically, never choosing a wider form of a group', () => {
    for (const { name, tab } of tabs) {
      const widths = widthsOf(tab.groups);
      let previousTotal = Number.POSITIVE_INFINITY;
      for (let available = 2400; available >= 0; available -= 25) {
        const levels = computeGroupLevels(widths, available);
        const chosen = levels.map((lvl, g) => widths[g]![lvl]!);
        chosen.forEach((w, g) => expect(w, `${name} group ${g} at ${available}px`).toBeLessThanOrEqual(widths[g]![0]!));
        const total = chosen.reduce((a, b) => a + b, 0);
        expect(total, `${name} at ${available}px`).toBeLessThanOrEqual(previousTotal);
        previousTotal = total;
      }
    }
  });

  it('are at least as wide as the group title', () => {
    const group: RibbonGroup = { id: 'x', labelKey: 'x', controls: [button('a')] };
    const long = 'A very long group title that is wider than its content';
    expect(groupWidth(group, 0, label, approximateMeasure, long)).toBeGreaterThan(approximateMeasure(long));
  });
});

describe('computeGroupLevels', () => {
  const widths = [
    [100, 80, 60, 57],
    [200, 150, 90, 57],
    [120, 90, 70, 57],
  ];

  it('keeps everything full when it fits', () => {
    expect(computeGroupLevels(widths, 1000)).toEqual([0, 0, 0]);
    expect(computeGroupLevels(widths, 420)).toEqual([0, 0, 0]);
  });

  it('reduces groups from the right, one level at a time', () => {
    expect(computeGroupLevels(widths, 419)).toEqual([0, 0, 1]);
    expect(computeGroupLevels(widths, 370)).toEqual([0, 1, 1]);
    expect(computeGroupLevels(widths, 320)).toEqual([1, 1, 1]);
    expect(computeGroupLevels(widths, 300)).toEqual([1, 1, 2]);
    expect(computeGroupLevels(widths, 200)).toEqual([2, 3, 3]);
  });

  it('collapses everything when nothing fits', () => {
    expect(computeGroupLevels(widths, 10)).toEqual([3, 3, 3]);
  });

  it('skips steps that would widen a group (large button → labelled small button)', () => {
    // Clipboard-like group: level 1 is wider than level 0; a tiny group is narrower than its collapsed button.
    const skewed = [
      [233, 298, 81, 57],
      [41, 41, 30, 57],
    ];
    expect(computeGroupLevels(skewed, 275)).toEqual([0, 0]);
    expect(computeGroupLevels(skewed, 270)).toEqual([0, 2]);
    expect(computeGroupLevels(skewed, 260)).toEqual([2, 2]);
    expect(computeGroupLevels(skewed, 50)).toEqual([3, 2]);
  });

  it('is monotonic: less space never enlarges a group', () => {
    let previous = computeGroupLevels(widths, 1000);
    for (let w = 1000; w >= 0; w -= 7) {
      const levels = computeGroupLevels(widths, w);
      levels.forEach((lvl, i) => expect(lvl).toBeGreaterThanOrEqual(previous[i]!));
      previous = levels;
    }
  });
});

describe('overflow correction', () => {
  it('grows by the measured overflow and settles', () => {
    expect(nextCorrection(800, 800, 800, 0)).toBe(0);
    expect(nextCorrection(801, 800, 800, 0)).toBe(0);
    expect(nextCorrection(830, 800, 800, 0)).toBe(38);
    expect(nextCorrection(830, 800, 800, 38)).toBe(76);
  });

  it('is bounded by the available width (no endless re-render loop)', () => {
    let correction = 0;
    let steps = 0;
    // Content that always overflows (a window narrower than the collapsed groups).
    while (steps < 1000) {
      const next = nextCorrection(2000, 300, 300, correction);
      if (next === correction) break;
      correction = next;
      steps++;
    }
    expect(correction).toBe(300);
    expect(steps).toBeLessThan(10);
  });
});
