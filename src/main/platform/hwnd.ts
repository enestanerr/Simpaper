/**
 * Window-handle conversions.
 *
 * HWNDs travel between processes as decimal strings (see ViewParams / DocLoadResult) and are
 * BigInt values in koffi 3. Only the low 32 bits of a USER handle are significant on 64-bit
 * Windows (handles stay 32-bit for WOW64 interop; user32 ignores the upper half, verified with
 * koffi 3.3.2 on Windows 11), so every handle is canonicalised to its low 32 bits. This makes a
 * sign-extended value reported by another process (e.g. LibreOffice's sal_Int64) compare equal to
 * the zero-extended value Electron returns.
 */
export type Hwnd = bigint;

const DECIMAL = /^-?\d{1,20}$/;

/** Canonical form of a handle value (low 32 bits, unsigned); `null` for NULL. */
export function canonicalHwnd(value: bigint | number | null | undefined): Hwnd | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value === 0)) return null;
  const n = BigInt.asUintN(32, BigInt(value));
  return n === 0n ? null : n;
}

/** Parses a decimal HWND string (signed or unsigned, up to 64 bits). Returns null when invalid or NULL. */
export function parseHwnd(text: string): Hwnd | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const value = BigInt(trimmed);
  if (value > 0xffff_ffff_ffff_ffffn || value < -0x8000_0000_0000_0000n) return null;
  return canonicalHwnd(value);
}

/** Decimal string for the engine protocol (unsigned, never negative). */
export function formatHwnd(hwnd: Hwnd): string {
  return BigInt.asUintN(32, hwnd).toString(10);
}

/** Reads the HWND from `BrowserWindow.getNativeWindowHandle()` (8 bytes on 64-bit, 4 on 32-bit Windows). */
export function hwndFromBuffer(buf: Uint8Array): Hwnd | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength >= 8) return canonicalHwnd(view.getBigUint64(0, true));
  if (buf.byteLength >= 4) return canonicalHwnd(view.getUint32(0, true));
  return null;
}

export function sameHwnd(a: Hwnd | null | undefined, b: Hwnd | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return BigInt.asUintN(32, a) === BigInt.asUintN(32, b);
}
