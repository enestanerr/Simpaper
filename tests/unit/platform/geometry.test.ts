import { describe, expect, it } from 'vitest';
import {
  clientScreenRect,
  cssToClientRect,
  cssToPhysicalFactor,
  cssToScreenRect,
  intersectRects,
  isValidCssRect,
  physicalToVirtualized,
  roundHalfAway,
  scaleRectEdges,
  surfaceSize,
  virtualizedToPhysical,
  type HostMetrics,
} from '../../../src/main/platform/geometry';

const metrics = (scaleFactor: number, zoomFactor = 1, origin = { x: 0, y: 0 }, size = { width: 4000, height: 3000 }): HostMetrics => ({
  clientOrigin: origin,
  clientSize: size,
  scaleFactor,
  zoomFactor,
});

describe('rounding', () => {
  it('rounds half away from zero like std::round / MulDiv', () => {
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(2.4999)).toBe(2);
    expect(roundHalfAway(-0.4)).toBe(-0);
  });
});

describe('CSS rect → physical client rect', () => {
  const doc = { x: 10, y: 120, width: 1000, height: 600 };

  it.each([
    [1, { x: 10, y: 120, width: 1000, height: 600 }],
    [1.25, { x: 13, y: 150, width: 1250, height: 750 }],
    [1.5, { x: 15, y: 180, width: 1500, height: 900 }],
    [1.75, { x: 18, y: 210, width: 1750, height: 1050 }],
    [2, { x: 20, y: 240, width: 2000, height: 1200 }],
  ])('scale factor %s', (scale, expected) => {
    expect(cssToClientRect(doc, metrics(scale))).toEqual(expected);
  });

  it('applies the webContents zoom factor before the display scale factor', () => {
    expect(cssToPhysicalFactor({ zoomFactor: 1.1, scaleFactor: 1.5 })).toBeCloseTo(1.65);
    expect(cssToClientRect({ x: 10, y: 10, width: 100, height: 100 }, metrics(1.5, 1.1))).toEqual({ x: 17, y: 17, width: 165, height: 165 });
    expect(cssToClientRect({ x: 0, y: 0, width: 800, height: 600 }, metrics(2, 0.5))).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('rounds each edge independently so neighbouring areas neither gap nor overlap', () => {
    const scale = 1.25;
    const ribbon = scaleRectEdges({ x: 0, y: 0, width: 1024.3, height: 118.6 }, scale);
    const document = scaleRectEdges({ x: 0, y: 118.6, width: 1024.3, height: 500.2 }, scale);
    expect(ribbon.y + ribbon.height).toBe(document.y);
    const left = scaleRectEdges({ x: 0, y: 0, width: 100.3, height: 10 }, 1.5);
    const right = scaleRectEdges({ x: 100.3, y: 0, width: 50, height: 10 }, 1.5);
    expect(left.x + left.width).toBe(right.x);
  });

  it('handles fractional CSS positions at 125 % and 150 %', () => {
    expect(cssToClientRect({ x: 0, y: 100.5, width: 800.25, height: 500 }, metrics(1))).toEqual({ x: 0, y: 101, width: 800, height: 500 });
    expect(cssToClientRect({ x: 0, y: 97, width: 1280, height: 683 }, metrics(1.5))).toEqual({ x: 0, y: 146, width: 1920, height: 1024 });
  });

  it('clips to the client area and never returns negative sizes', () => {
    const m = metrics(1.25, 1, { x: 0, y: 0 }, { width: 1000, height: 700 });
    expect(cssToClientRect({ x: 700, y: 500, width: 400, height: 400 }, m)).toEqual({ x: 875, y: 625, width: 125, height: 75 });
    expect(cssToClientRect({ x: -20, y: -20, width: 40, height: 40 }, m)).toEqual({ x: 0, y: 0, width: 25, height: 25 });
    expect(cssToClientRect({ x: 2000, y: 0, width: 10, height: 10 }, m).width).toBe(0);
    expect(cssToClientRect({ x: 0, y: 0, width: 0, height: 0 }, m)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('treats a zero or invalid scale/zoom as 1', () => {
    expect(cssToPhysicalFactor({ zoomFactor: 0, scaleFactor: Number.NaN })).toBe(1);
  });
});

describe('owned mode: screen rect = client origin (physical) + scaled CSS rect', () => {
  const doc = { x: 0, y: 150, width: 1200, height: 650 };

  it('primary monitor at 100 %', () => {
    expect(cssToScreenRect(doc, metrics(1, 1, { x: 208, y: 131 }))).toEqual({ x: 208, y: 281, width: 1200, height: 650 });
  });

  it('secondary 150 % monitor right of a 100 % primary (mixed DPI)', () => {
    // The origin comes from ClientToScreen and is already physical: no DIP arithmetic on the position.
    expect(cssToScreenRect(doc, metrics(1.5, 1, { x: 2570, y: 40 }))).toEqual({ x: 2570, y: 265, width: 1800, height: 975 });
  });

  it('monitor left of the primary (negative coordinates) at 125 %', () => {
    // top = round(150 × 1.25) = 188, bottom = round(800 × 1.25) = 1000
    expect(cssToScreenRect(doc, metrics(1.25, 1, { x: -1900, y: -200 }))).toEqual({ x: -1900, y: -12, width: 1500, height: 812 });
  });

  it('maximized window at 200 %', () => {
    expect(cssToScreenRect({ x: 0, y: 64, width: 1280, height: 656 }, metrics(2, 1, { x: 0, y: 0 }, { width: 2560, height: 1440 }))).toEqual({
      x: 0,
      y: 128,
      width: 2560,
      height: 1312,
    });
  });

  it('whole client area as a hint when no rect is known', () => {
    expect(clientScreenRect(metrics(1, 1, { x: 5, y: 6 }, { width: 100, height: 50 }))).toEqual({ x: 5, y: 6, width: 100, height: 50 });
  });
});

describe('DPI virtualisation (System-aware LibreOffice vs per-monitor host)', () => {
  it('matches the documented observation (Mozilla bug 890156): system DPI 192, secondary monitor at 96 DPI', () => {
    // Monitor 1 physical (2560,0)-(3584,768) appears to a System-aware (192 DPI) app as (5120,0)-(7168,1536).
    expect(physicalToVirtualized({ x: 2560, y: 0, width: 1024, height: 768 }, 96, 192)).toEqual({ x: 5120, y: 0, width: 2048, height: 1536 });
    // Monitor 0 is at the system DPI: unchanged.
    expect(physicalToVirtualized({ x: 0, y: 0, width: 2560, height: 1440 }, 192, 192)).toEqual({ x: 0, y: 0, width: 2560, height: 1440 });
    // A DPI-unaware (96) app sees the 192 DPI primary halved.
    expect(physicalToVirtualized({ x: 0, y: 0, width: 2560, height: 1440 }, 192, 96)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it.each([
    [96, { x: 2660, y: 100, width: 1500, height: 900 }],
    [120, { x: 2128, y: 80, width: 1200, height: 720 }],
    [144, { x: 1773, y: 67, width: 1000, height: 600 }],
    [192, { x: 1330, y: 50, width: 750, height: 450 }],
  ])('LibreOffice (system DPI 96) coordinates of a view on a %s DPI monitor', (monitorDpi, expected) => {
    expect(physicalToVirtualized({ x: 2660, y: 100, width: 1500, height: 900 }, monitorDpi, 96)).toEqual(expected);
  });

  it('round-trips within one physical pixel', () => {
    for (const dpi of [96, 120, 144, 168, 192]) {
      const physical = { x: 2663, y: 101, width: 1501, height: 899 };
      const back = virtualizedToPhysical(physicalToVirtualized(physical, dpi, 96), dpi, 96);
      expect(Math.abs(back.x - physical.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.y - physical.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.x + back.width - (physical.x + physical.width))).toBeLessThanOrEqual(1);
      expect(Math.abs(back.y + back.height - (physical.y + physical.height))).toBeLessThanOrEqual(1);
    }
  });

  it('computes the PrintWindow surface size of a DPI-virtualised window', () => {
    expect(surfaceSize({ width: 1500, height: 900 }, 96, 96)).toEqual({ width: 1500, height: 900 });
    expect(surfaceSize({ width: 1250, height: 750 }, 96, 120)).toEqual({ width: 1000, height: 600 });
    expect(surfaceSize({ width: 1500, height: 900 }, 96, 144)).toEqual({ width: 1000, height: 600 });
    expect(surfaceSize({ width: 2000, height: 1200 }, 96, 192)).toEqual({ width: 1000, height: 600 });
    // Session started at 150 % (system DPI 144), window on a 100 % monitor: LibreOffice renders larger.
    expect(surfaceSize({ width: 1000, height: 600 }, 144, 96)).toEqual({ width: 1500, height: 900 });
    expect(surfaceSize({ width: 0, height: 10 }, 96, 144)).toEqual({ width: 0, height: 7 });
  });
});

describe('rect helpers', () => {
  it('validates renderer input', () => {
    expect(isValidCssRect({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isValidCssRect({ x: 0, y: 0, width: -1, height: 1 })).toBe(false);
    expect(isValidCssRect({ x: Number.NaN, y: 0, width: 1, height: 1 })).toBe(false);
    expect(isValidCssRect({ x: 0, y: 0, width: Infinity, height: 1 })).toBe(false);
    expect(isValidCssRect({ x: '0', y: 0, width: 1, height: 1 })).toBe(false);
    expect(isValidCssRect(null)).toBe(false);
  });

  it('intersects rectangles', () => {
    expect(intersectRects({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    expect(intersectRects({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 5, height: 5 })).toMatchObject({ width: 0, height: 0 });
  });
});
