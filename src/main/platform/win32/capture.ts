/**
 * Freeze-frame capture: PrintWindow(PW_RENDERFULLCONTENT) of a LibreOffice window into our own
 * memory DC. PrintWindow waits for the target's UI thread, so it runs on a koffi worker thread with
 * a time budget; the GDI objects are released only when that call has returned.
 */
import type { Logger } from '../../log';
import { surfaceSize, type Size } from '../geometry';
import { formatHwnd, type Hwnd } from '../hwnd';
import { BI_RGB, DIB_RGB_COLORS, MDT_EFFECTIVE_DPI, MONITOR_DEFAULTTONEAREST, PW_RENDERFULLCONTENT } from './constants';
import { callAsync, type Rect32, type Win32Api } from './ffi';

/** 8K UHD; larger captures are refused (a 32-bit bitmap of this size is ~130 MB). */
export const MAX_CAPTURE_PIXELS = 7680 * 4320;

export type PngEncoder = (bgra: Buffer, width: number, height: number) => string;

/** BITMAPINFOHEADER for a top-down 32-bit BI_RGB DIB (+ room for one RGBQUAD). */
export function bitmapInfo(width: number, height: number): Buffer {
  const info = Buffer.alloc(44);
  info.writeUInt32LE(40, 0); // biSize
  info.writeInt32LE(width, 4);
  info.writeInt32LE(-height, 8); // negative: top-down rows
  info.writeUInt16LE(1, 12); // biPlanes
  info.writeUInt16LE(32, 14); // biBitCount
  info.writeUInt32LE(BI_RGB, 16);
  return info;
}

/** GDI leaves the alpha byte at 0; make every pixel opaque (in place). */
export function makeOpaque(bgra: Buffer): Buffer {
  if (bgra.byteOffset % 4 === 0) {
    // Little-endian: the alpha byte is the top byte of each 32-bit pixel.
    const pixels = new Uint32Array(bgra.buffer, bgra.byteOffset, Math.floor(bgra.byteLength / 4));
    for (let i = 0; i < pixels.length; i++) pixels[i] = (pixels[i]! | 0xff000000) >>> 0;
  } else {
    for (let i = 3; i < bgra.length; i += 4) bgra[i] = 0xff;
  }
  return bgra;
}

function monitorDpi(api: Win32Api, hwnd: Hwnd): number | null {
  const monitor = api.user32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  if (!monitor || !api.shcore) return null;
  const x = [0];
  const y = [0];
  return api.shcore.GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, x, y) === 0 && x[0]! > 0 ? x[0]! : null;
}

/** Size PrintWindow renders for `hwnd`: its own surface size, which is smaller/larger than the physical size when DPI-virtualised. */
function captureSize(api: Win32Api, hwnd: Hwnd): Size | null {
  const rect: Partial<Rect32> = {};
  if (!api.user32.GetWindowRect(hwnd, rect)) return null;
  const physical = { width: (rect.right ?? 0) - (rect.left ?? 0), height: (rect.bottom ?? 0) - (rect.top ?? 0) };
  const windowDpi = api.user32.GetDpiForWindow(hwnd);
  return surfaceSize(physical, windowDpi, monitorDpi(api, hwnd) ?? windowDpi);
}

export async function captureWindow(api: Win32Api, hwnd: Hwnd, timeoutMs: number, encode: PngEncoder, log: Logger): Promise<string | null> {
  const { user32, gdi32 } = api;
  if (!user32.IsWindow(hwnd) || !user32.IsWindowVisible(hwnd) || user32.IsHungAppWindow(hwnd)) return null;
  const size = captureSize(api, hwnd);
  if (!size || size.width <= 0 || size.height <= 0 || size.width * size.height > MAX_CAPTURE_PIXELS) return null;

  const screenDc = user32.GetDC(null);
  if (!screenDc) return null;
  const memDc = gdi32.CreateCompatibleDC(screenDc);
  const bitmap = memDc ? gdi32.CreateCompatibleBitmap(screenDc, size.width, size.height) : null;
  user32.ReleaseDC(null, screenDc);
  if (!memDc || !bitmap) {
    if (memDc) gdi32.DeleteDC(memDc);
    return null;
  }
  const previous = gdi32.SelectObject(memDc, bitmap);
  const release = (): void => {
    gdi32.SelectObject(memDc, previous);
    gdi32.DeleteObject(bitmap);
    gdi32.DeleteDC(memDc);
  };

  const printing = callAsync(user32.PrintWindow, hwnd, memDc, PW_RENDERFULLCONTENT);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    printing.then(
      (ok) => (ok ? 'ok' : 'failed'),
      () => 'failed',
    ),
    new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), timeoutMs))),
  ]);
  if (timer) clearTimeout(timer);
  if (outcome === 'timeout') {
    // The worker thread may still draw into the DC: free it only after PrintWindow returns.
    printing.then(release, release);
    log.warn('PrintWindow timed out', { hwnd: formatHwnd(hwnd), timeoutMs });
    return null;
  }
  try {
    if (outcome !== 'ok') return null;
    gdi32.SelectObject(memDc, previous); // GetDIBits needs the bitmap deselected
    const bits = Buffer.alloc(size.width * size.height * 4);
    const lines = gdi32.GetDIBits(memDc, bitmap, 0, size.height, bits, bitmapInfo(size.width, size.height), DIB_RGB_COLORS);
    if (lines !== size.height) return null;
    return encode(makeOpaque(bits), size.width, size.height);
  } finally {
    release();
  }
}
