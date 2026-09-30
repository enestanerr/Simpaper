import { describe, expect, it } from 'vitest';
import {
  WS_CAPTION,
  WS_CHILD,
  WS_CLIPCHILDREN,
  WS_CLIPSIBLINGS,
  WS_DISABLED,
  WS_EX_APPWINDOW,
  WS_EX_CLIENTEDGE,
  WS_EX_CONTROLPARENT,
  WS_EX_LAYERED,
  WS_EX_NOPARENTNOTIFY,
  WS_EX_TOOLWINDOW,
  WS_EX_WINDOWEDGE,
  WS_MAXIMIZEBOX,
  WS_MINIMIZEBOX,
  WS_OVERLAPPEDWINDOW,
  WS_POPUP,
  WS_SYSMENU,
  WS_THICKFRAME,
  WS_VISIBLE,
} from '../../../src/main/platform/win32/constants';
import {
  CONTAINER_EX_STYLE,
  CONTAINER_STYLE,
  isChildStyle,
  ownedPopupExStyle,
  ownedPopupStyle,
  toStyleBits,
} from '../../../src/main/platform/win32/styles';

// JS bitwise operators work on int32: normalise both sides to uint32 before comparing.
const has = (value: number, bits: number): boolean => ((value & bits) >>> 0) === bits >>> 0;
const hasAny = (value: number, bits: number): boolean => (value & bits) !== 0;

describe('owned popup styles', () => {
  it('turns a normal top-level LibreOffice frame into a borderless popup', () => {
    const frame = (WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN | WS_VISIBLE) >>> 0; // 0x12CF0000
    const style = ownedPopupStyle(frame);
    expect(has(style, WS_POPUP | WS_CLIPCHILDREN | WS_CLIPSIBLINGS)).toBe(true);
    expect(hasAny(style, WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_CHILD)).toBe(false);
    expect(has(style, WS_VISIBLE)).toBe(true); // visibility is managed with SetWindowPos, not here
    expect(style).toBe(0x9600_0000); // WS_POPUP | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN, as uint32
  });

  it('converts a createSystemChild frame (WS_CHILD) and keeps WS_DISABLED (modal LibreOffice dialog)', () => {
    const child = (WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN | WS_DISABLED) >>> 0;
    const style = ownedPopupStyle(child);
    expect(isChildStyle(child)).toBe(true);
    expect(isChildStyle(style)).toBe(false);
    expect(has(style, WS_POPUP)).toBe(true);
    expect(has(style, WS_DISABLED)).toBe(true);
  });

  it('owned styles match the engine bridge (engine/bridge/tests/test_owned.py uses the same vectors)', () => {
    // The bridge owns the frame before loading (simpaper_bridge/owned.py); makeOwned then only compares.
    const styles: [number, number][] = [
      [0x16cf_0000, 0x9600_0000],
      [0x02cf_0000, 0x8600_0000],
      [0x4400_0000, 0x8600_0000],
      [0x8600_0000, 0x8600_0000],
      [0x0acf_0000, 0x8e00_0000],
    ];
    const exStyles: [number, number][] = [
      [0x0004_0100, 0x0000_0080],
      [0x0000_0304, 0x0000_0084],
      [0x0008_0080, 0x0008_0080],
      [0x0002_0001, 0x0000_0080],
    ];
    for (const [input, expected] of styles) expect(ownedPopupStyle(input)).toBe(expected);
    for (const [input, expected] of exStyles) expect(ownedPopupExStyle(input)).toBe(expected);
    expect(ownedPopupStyle(toStyleBits(-0x7a00_0000))).toBe(0x8600_0000);
  });

  it('is idempotent', () => {
    const once = ownedPopupStyle(WS_OVERLAPPEDWINDOW);
    expect(ownedPopupStyle(once)).toBe(once);
    const exOnce = ownedPopupExStyle(WS_EX_APPWINDOW | WS_EX_WINDOWEDGE);
    expect(ownedPopupExStyle(exOnce)).toBe(exOnce);
  });

  it('removes the taskbar button and 3-D edges, keeps unrelated extended bits', () => {
    const ex = ownedPopupExStyle(WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_CONTROLPARENT);
    expect(has(ex, WS_EX_TOOLWINDOW)).toBe(true);
    expect(hasAny(ex, WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE)).toBe(false);
    expect(has(ex, WS_EX_CONTROLPARENT)).toBe(true);
  });

  it('normalises GetWindowLongPtr results (sign- or zero-extended) to uint32', () => {
    expect(toStyleBits(-1778384896)).toBe(0x9600_0000); // sign-extended 0x96000000
    expect(toStyleBits(0x9600_0000)).toBe(0x9600_0000);
    expect(toStyleBits(0xffff_ffff_9600_0000n)).toBe(0x9600_0000);
  });
});

describe('child container styles', () => {
  it('is a hidden clipping child with its own layered redirection surface', () => {
    expect(has(CONTAINER_STYLE, WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS)).toBe(true);
    expect(hasAny(CONTAINER_STYLE, WS_VISIBLE | WS_POPUP | WS_CAPTION)).toBe(false);
    expect(has(CONTAINER_EX_STYLE, WS_EX_LAYERED | WS_EX_NOPARENTNOTIFY)).toBe(true);
  });
});
