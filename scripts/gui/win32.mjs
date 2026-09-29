// Win32 helpers for the GUI spike (scripts/gui/gui-spike.mjs): windows, real input, screen capture.
// Opens nothing by itself; only used by the opt-in GUI spike, which needs the machine owner's permission.
import koffi from 'koffi';
import { PNG } from 'pngjs';

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');
const kernel32 = koffi.load('kernel32.dll');
const dwmapi = koffi.load('dwmapi.dll');

koffi.struct('GUI_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
koffi.struct('GUI_POINT', { x: 'long', y: 'long' });
const MOUSEINPUT = koffi.struct('GUI_MOUSEINPUT', { dx: 'long', dy: 'long', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
const KEYBDINPUT = koffi.struct('GUI_KEYBDINPUT', { wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
const HARDWAREINPUT = koffi.struct('GUI_HARDWAREINPUT', { uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16' });
const INPUT = koffi.struct('GUI_INPUT', { type: 'uint32', u: koffi.union('GUI_INPUT_U', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT }) });
const BITMAPINFOHEADER = koffi.struct('GUI_BITMAPINFOHEADER', {
  biSize: 'uint32', biWidth: 'int32', biHeight: 'int32', biPlanes: 'uint16', biBitCount: 'uint16', biCompression: 'uint32',
  biSizeImage: 'uint32', biXPelsPerMeter: 'int32', biYPelsPerMeter: 'int32', biClrUsed: 'uint32', biClrImportant: 'uint32',
});
koffi.struct('GUI_BITMAPINFO', { bmiHeader: BITMAPINFOHEADER, bmiColors: koffi.array('uint32', 1) });
koffi.struct('GUI_LASTINPUTINFO', { cbSize: 'uint32', dwTime: 'uint32' });
const GUITHREADINFO = koffi.struct('GUI_GUITHREADINFO', {
  cbSize: 'uint32', flags: 'uint32', hwndActive: 'intptr', hwndFocus: 'intptr', hwndCapture: 'intptr', hwndMenuOwner: 'intptr',
  hwndMoveSize: 'intptr', hwndCaret: 'intptr', rcCaret: 'GUI_RECT',
});
const EnumProc = koffi.proto('bool __stdcall GUI_EnumProc(intptr hwnd, intptr lparam)');

const f = {
  EnumWindows: user32.func('bool __stdcall EnumWindows(GUI_EnumProc *cb, intptr l)'),
  GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr hwnd, _Out_ uint8_t *buf, int max)'),
  GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr hwnd, _Out_ uint8_t *buf, int max)'),
  GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32 *pid)'),
  IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr hwnd)'),
  GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr hwnd, _Out_ GUI_RECT *r)'),
  GetClientRect: user32.func('bool __stdcall GetClientRect(intptr hwnd, _Out_ GUI_RECT *r)'),
  ClientToScreen: user32.func('bool __stdcall ClientToScreen(intptr hwnd, _Inout_ GUI_POINT *p)'),
  GetWindow: user32.func('intptr __stdcall GetWindow(intptr hwnd, uint32 cmd)'),
  GetForegroundWindow: user32.func('intptr __stdcall GetForegroundWindow()'),
  SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(intptr hwnd)'),
  ShowWindow: user32.func('bool __stdcall ShowWindow(intptr hwnd, int cmd)'),
  SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint32 flags)'),
  WindowFromPoint: user32.func('intptr __stdcall WindowFromPoint(GUI_POINT p)'),
  GetAncestor: user32.func('intptr __stdcall GetAncestor(intptr hwnd, uint32 flags)'),
  SetCursorPos: user32.func('bool __stdcall SetCursorPos(int x, int y)'),
  SendInput: user32.func('uint32 __stdcall SendInput(uint32 n, GUI_INPUT *inputs, int size)'),
  GetDC: user32.func('intptr __stdcall GetDC(intptr hwnd)'),
  ReleaseDC: user32.func('int __stdcall ReleaseDC(intptr hwnd, intptr hdc)'),
  CreateCompatibleDC: gdi32.func('intptr __stdcall CreateCompatibleDC(intptr hdc)'),
  CreateCompatibleBitmap: gdi32.func('intptr __stdcall CreateCompatibleBitmap(intptr hdc, int w, int h)'),
  SelectObject: gdi32.func('intptr __stdcall SelectObject(intptr hdc, intptr obj)'),
  DeleteObject: gdi32.func('bool __stdcall DeleteObject(intptr obj)'),
  DeleteDC: gdi32.func('bool __stdcall DeleteDC(intptr hdc)'),
  BitBlt: gdi32.func('bool __stdcall BitBlt(intptr dst, int x, int y, int cx, int cy, intptr src, int x1, int y1, uint32 rop)'),
  GetDIBits: gdi32.func('int __stdcall GetDIBits(intptr hdc, intptr hbm, uint32 start, uint32 lines, _Out_ uint8_t *bits, _Inout_ GUI_BITMAPINFO *bmi, uint32 usage)'),
  OpenProcess: kernel32.func('intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
  CloseHandle: kernel32.func('bool __stdcall CloseHandle(intptr h)'),
  QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(intptr h, uint32 flags, _Out_ uint8_t *buf, _Inout_ uint32 *size)'),
  IsHungAppWindow: user32.func('bool __stdcall IsHungAppWindow(intptr hwnd)'),
  IsWindow: user32.func('bool __stdcall IsWindow(intptr hwnd)'),
  VkKeyScanExW: user32.func('int16 __stdcall VkKeyScanExW(uint16 ch, intptr hkl)'),
  GetKeyboardLayout: user32.func('intptr __stdcall GetKeyboardLayout(uint32 thread)'),
  MapVirtualKeyExW: user32.func('uint32 __stdcall MapVirtualKeyExW(uint32 code, uint32 type, intptr hkl)'),
  GetKeyState: user32.func('int16 __stdcall GetKeyState(int vk)'),
  GetLastInputInfo: user32.func('bool __stdcall GetLastInputInfo(_Inout_ GUI_LASTINPUTINFO *info)'),
  GetTickCount: kernel32.func('uint32 __stdcall GetTickCount()'),
  DwmGetWindowAttribute: dwmapi.func('int32 __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ GUI_RECT *r, uint32 size)'),
  GetGUIThreadInfo: user32.func('bool __stdcall GetGUIThreadInfo(uint32 tid, _Inout_ GUI_GUITHREADINFO *info)'),
};

/** The window with the keyboard focus in the foreground thread's input state (0 if none). */
export function keyboardFocus() {
  const info = { cbSize: koffi.sizeof(GUITHREADINFO) };
  return f.GetGUIThreadInfo(0, info) ? info.hwndFocus : 0;
}

/**
 * The window's visible frame in screen pixels (DWMWA_EXTENDED_FRAME_BOUNDS): GetWindowRect also covers the
 * invisible resize borders, so captures of it would show a few pixels of whatever lies behind the window.
 */
export function frameRect(hwnd) {
  const r = {};
  if (f.DwmGetWindowAttribute(hwnd, 9 /* DWMWA_EXTENDED_FRAME_BOUNDS */, r, 16) !== 0) return windowInfo(hwnd).rect;
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

/** Milliseconds since the last keyboard/mouse input on this desktop (the user's or synthetic). */
export function idleMs() {
  const info = { cbSize: 8, dwTime: 0 };
  f.GetLastInputInfo(info);
  return (f.GetTickCount() - info.dwTime) >>> 0;
}

/** True when Windows considers the window's thread hung (no message retrieval for 5 s). Never blocks. */
export const isHung = (hwnd) => f.IsHungAppWindow(hwnd);
export const isWindow = (hwnd) => f.IsWindow(hwnd);

const INPUT_SIZE = koffi.sizeof(INPUT);

function wstr(fn, hwnd) {
  const buf = Buffer.alloc(1024);
  const n = fn(hwnd, buf, 512);
  return buf.toString('utf16le', 0, Math.max(0, n) * 2);
}

export function processImage(pid) {
  const h = f.OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
  if (!h) return '';
  try {
    const buf = Buffer.alloc(2048);
    const size = [1024];
    return f.QueryFullProcessImageNameW(h, 0, buf, size) ? buf.toString('utf16le', 0, size[0] * 2) : '';
  } finally {
    f.CloseHandle(h);
  }
}

export function windowInfo(hwnd) {
  const pid = [0];
  f.GetWindowThreadProcessId(hwnd, pid);
  const r = {};
  f.GetWindowRect(hwnd, r);
  return {
    hwnd,
    pid: pid[0],
    cls: wstr(f.GetClassNameW, hwnd),
    title: wstr(f.GetWindowTextW, hwnd),
    visible: f.IsWindowVisible(hwnd),
    rect: { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top },
    owner: f.GetWindow(hwnd, 4 /* GW_OWNER */),
  };
}

/** Window facts that are safe to log for any window: no title (other applications' titles can be private). */
export function windowRef(hwnd) {
  const { pid, cls, visible, rect } = windowInfo(hwnd);
  return { hwnd, pid, cls, visible, rect };
}

export function topLevelWindows() {
  const out = [];
  const cb = koffi.register((h) => {
    out.push(h);
    return true;
  }, koffi.pointer(EnumProc));
  f.EnumWindows(cb, 0);
  koffi.unregister(cb);
  return out.map(windowInfo);
}

export function clientOrigin(hwnd) {
  const p = { x: 0, y: 0 };
  f.ClientToScreen(hwnd, p);
  return p;
}

export function setWindowRect(hwnd, x, y, width, height) {
  // SetWindowPos on another process' window waits for that window's thread: refuse when it is hung.
  if (f.IsHungAppWindow(hwnd)) throw new Error('window is not responding');
  return f.SetWindowPos(hwnd, 0, x, y, width, height, 0x0040 /* SWP_SHOWWINDOW */);
}

export const foreground = () => f.GetForegroundWindow();

export function rootAt(x, y) {
  const hit = f.WindowFromPoint({ x, y });
  return hit ? f.GetAncestor(hit, 2 /* GA_ROOT */) : 0;
}

function send(input) {
  return f.SendInput(1, input, INPUT_SIZE);
}

function key(vk, up = false) {
  send({ type: 1, u: { ki: { wVk: vk, wScan: 0, dwFlags: up ? 0x0002 : 0, time: 0, dwExtraInfo: 0 } } });
}

/** Brings `hwnd` to the front. A synthetic Alt tap lifts Windows' foreground lock for this process. */
export function bringToFront(hwnd) {
  if (f.IsHungAppWindow(hwnd)) throw new Error('window is not responding');
  f.ShowWindow(hwnd, 9 /* SW_RESTORE */);
  key(0x12);
  key(0x12, true);
  f.SetForegroundWindow(hwnd);
  return f.GetForegroundWindow() === hwnd;
}

export function click(x, y) {
  f.SetCursorPos(x, y);
  send({ type: 0, u: { mi: { dx: 0, dy: 0, mouseData: 0, dwFlags: 0x0002, time: 0, dwExtraInfo: 0 } } });
  send({ type: 0, u: { mi: { dx: 0, dy: 0, mouseData: 0, dwFlags: 0x0004, time: 0, dwExtraInfo: 0 } } });
}

export function typeText(text) {
  for (const ch of text) {
    if (ch === '\n') {
      key(0x0d);
      key(0x0d, true);
      continue;
    }
    const code = ch.codePointAt(0);
    send({ type: 1, u: { ki: { wVk: 0, wScan: code, dwFlags: 0x0004, time: 0, dwExtraInfo: 0 } } });
    send({ type: 1, u: { ki: { wVk: 0, wScan: code, dwFlags: 0x0004 | 0x0002, time: 0, dwExtraInfo: 0 } } });
  }
}

/** Keyboard layout (HKL) of the thread that owns `hwnd`. */
export function keyboardLayout(hwnd) {
  return f.GetKeyboardLayout(f.GetWindowThreadProcessId(hwnd, [0]));
}

/**
 * Types `text` the way a person does: every character becomes the key (with Shift/Ctrl/Alt as needed) that
 * produces it in the keyboard layout of `hwnd`'s thread, so the target sees ordinary WM_KEYDOWN/WM_CHAR input.
 * Characters the layout cannot produce fall back to VK_PACKET input and are returned.
 */
export function typeKeys(text, hwnd) {
  const hkl = keyboardLayout(hwnd);
  const scan = (vk) => f.MapVirtualKeyExW(vk, 0 /* MAPVK_VK_TO_VSC */, hkl);
  const press = (vk, up) => send({ type: 1, u: { ki: { wVk: vk, wScan: scan(vk), dwFlags: up ? 0x0002 : 0, time: 0, dwExtraInfo: 0 } } });
  const capsOn = (f.GetKeyState(0x14) & 1) !== 0;
  if (capsOn) {
    press(0x14, false);
    press(0x14, true);
  }
  const fallback = [];
  try {
    for (const ch of text) {
      const code = ch === '\n' ? 0x0d : ch.codePointAt(0);
      const r = code <= 0xffff ? f.VkKeyScanExW(code, hkl) : -1;
      if (r === -1) {
        fallback.push(ch);
        typeText(ch);
        continue;
      }
      const mods = [];
      if (r & 0x200) mods.push(0x11);
      if (r & 0x400) mods.push(0x12);
      if (r & 0x100) mods.push(0x10);
      for (const m of mods) press(m, false);
      press(r & 0xff, false);
      press(r & 0xff, true);
      for (const m of mods.reverse()) press(m, true);
    }
  } finally {
    if (capsOn) {
      press(0x14, false);
      press(0x14, true);
    }
  }
  return fallback;
}

/** Presses a key chord, e.g. chord([0x11, 0x53]) = Ctrl+S. */
export function chord(vks) {
  for (const vk of vks) key(vk);
  for (const vk of [...vks].reverse()) key(vk, true);
}

/** Copies a screen rectangle (what the user actually sees, owned windows included) into a PNG buffer. */
export function captureScreen({ x, y, width, height }) {
  const screen = f.GetDC(0);
  const mem = f.CreateCompatibleDC(screen);
  const bmp = f.CreateCompatibleBitmap(screen, width, height);
  const old = f.SelectObject(mem, bmp);
  f.BitBlt(mem, 0, 0, width, height, screen, x, y, 0x00cc0020 | 0x40000000 /* SRCCOPY | CAPTUREBLT */);
  const bmi = { bmiHeader: { biSize: 40, biWidth: width, biHeight: -height, biPlanes: 1, biBitCount: 32, biCompression: 0, biSizeImage: 0, biXPelsPerMeter: 0, biYPelsPerMeter: 0, biClrUsed: 0, biClrImportant: 0 }, bmiColors: [0] };
  const bgra = Buffer.alloc(width * height * 4);
  f.GetDIBits(mem, bmp, 0, height, bgra, bmi, 0);
  f.SelectObject(mem, old);
  f.DeleteObject(bmp);
  f.DeleteDC(mem);
  f.ReleaseDC(0, screen);
  const png = new PNG({ width, height });
  for (let i = 0; i < bgra.length; i += 4) {
    png.data[i] = bgra[i + 2];
    png.data[i + 1] = bgra[i + 1];
    png.data[i + 2] = bgra[i];
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

export const VK = { CONTROL: 0x11, SHIFT: 0x10, MENU: 0x12, RETURN: 0x0d, ESCAPE: 0x1b, TAB: 0x09, UP: 0x26, DOWN: 0x28, HOME: 0x24, END: 0x23, A: 0x41, B: 0x42, S: 0x53, Z: 0x5a };
