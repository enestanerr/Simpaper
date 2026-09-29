import { describe, expect, it } from 'vitest';
import { canonicalHwnd, formatHwnd, hwndFromBuffer, parseHwnd, sameHwnd } from '../../../src/main/platform/hwnd';

describe('hwnd conversions', () => {
  it('parses unsigned and signed decimal strings to the canonical low 32 bits', () => {
    expect(parseHwnd('65548')).toBe(65548n);
    expect(parseHwnd(' 65548 ')).toBe(65548n);
    // Sign-extended (as LibreOffice's sal_Int64 may report it) and zero-extended forms are the same window.
    expect(parseHwnd('-2147418060')).toBe(0x8001_0034n);
    expect(parseHwnd('2147549236')).toBe(0x8001_0034n);
    expect(parseHwnd('18446744071562133556')).toBe(0x8001_0034n);
  });

  it('rejects malformed, NULL and out-of-range values', () => {
    for (const bad of ['', '0', 'abc', '12.5', '0x1234', '1e5', '-', '123456789012345678901', '18446744073709551616']) {
      expect(parseHwnd(bad), bad).toBeNull();
    }
    expect(parseHwnd(undefined as unknown as string)).toBeNull();
  });

  it('formats as an unsigned decimal string that parses back to the same handle', () => {
    for (const h of [1n, 65548n, 0x7fff_ffffn, 0x8001_0034n, 0xffff_fffen]) {
      const text = formatHwnd(h);
      expect(text).toMatch(/^\d+$/);
      expect(parseHwnd(text)).toBe(h);
    }
    expect(formatHwnd(0xffff_ffff_8001_0034n)).toBe('2147549236');
  });

  it('reads the handle from getNativeWindowHandle() buffers', () => {
    const b64 = Buffer.alloc(8);
    b64.writeBigUInt64LE(0x0003_0b42n);
    expect(hwndFromBuffer(b64)).toBe(0x0003_0b42n);
    const b32 = Buffer.alloc(4);
    b32.writeUInt32LE(0x8001_0034);
    expect(hwndFromBuffer(b32)).toBe(0x8001_0034n);
    expect(hwndFromBuffer(Buffer.alloc(8))).toBeNull();
    expect(hwndFromBuffer(Buffer.alloc(2))).toBeNull();
    // A Buffer that is a slice of a larger pool must be read from its own offset.
    const pool = Buffer.alloc(16);
    pool.writeBigUInt64LE(0x1234n, 8);
    expect(hwndFromBuffer(pool.subarray(8))).toBe(0x1234n);
  });

  it('canonicalises koffi values and compares handles by their significant bits', () => {
    expect(canonicalHwnd(null)).toBeNull();
    expect(canonicalHwnd(0n)).toBeNull();
    expect(canonicalHwnd(0)).toBeNull();
    expect(canonicalHwnd(65548)).toBe(65548n);
    expect(canonicalHwnd(0xffff_ffff_0001_0168n)).toBe(0x0001_0168n);
    expect(sameHwnd(0x0001_0168n, 0xffff_ffff_0001_0168n)).toBe(true);
    expect(sameHwnd(1n, 2n)).toBe(false);
    expect(sameHwnd(null, 1n)).toBe(false);
  });
});
