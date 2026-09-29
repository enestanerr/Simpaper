import { describe, expect, it } from 'vitest';
import { bitmapInfo, makeOpaque, MAX_CAPTURE_PIXELS } from '../../../src/main/platform/win32/capture';

describe('freeze-frame pixel helpers', () => {
  it('describes a top-down 32-bit BI_RGB DIB', () => {
    const info = bitmapInfo(1920, 1080);
    expect(info.readUInt32LE(0)).toBe(40);
    expect(info.readInt32LE(4)).toBe(1920);
    expect(info.readInt32LE(8)).toBe(-1080);
    expect(info.readUInt16LE(12)).toBe(1);
    expect(info.readUInt16LE(14)).toBe(32);
    expect(info.readUInt32LE(16)).toBe(0);
    expect(info.length).toBeGreaterThanOrEqual(44);
  });

  it('forces alpha to 255 and keeps the BGR bytes', () => {
    const bytes = [0x10, 0x20, 0x30, 0x00, 0xff, 0x00, 0x7f, 0x00, 0x01, 0x02, 0x03, 0x80];
    const expected = [0x10, 0x20, 0x30, 0xff, 0xff, 0x00, 0x7f, 0xff, 0x01, 0x02, 0x03, 0xff];
    const aligned = Buffer.alloc(bytes.length);
    aligned.set(bytes);
    expect([...makeOpaque(aligned)]).toEqual(expected);
    // A Buffer view that does not start on a 4-byte boundary takes the byte-wise path.
    const unaligned = Buffer.alloc(bytes.length + 1).subarray(1);
    unaligned.set(bytes);
    expect(unaligned.byteOffset % 4).not.toBe(0);
    expect([...makeOpaque(unaligned)]).toEqual(expected);
  });

  it('caps captures at 8K', () => {
    expect(MAX_CAPTURE_PIXELS).toBe(7680 * 4320);
  });
});
