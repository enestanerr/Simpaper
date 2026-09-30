/**
 * Experimental KeyTips trigger: a bare Alt tap or F10 while the Simpaper window (or one of its owned
 * LibreOffice windows) is in the foreground. LibreOffice's UNO key handler never sees a bare Alt
 * (modifier-only keys arrive as KeyModChange), hence a low-level keyboard hook.
 *
 * Cost control, since a WH_KEYBOARD_LL hook sees every keystroke of the session and runs on our UI
 * thread: the keyboard hook is installed only while one of our windows is in the foreground
 * (EVENT_SYSTEM_FOREGROUND WinEvent, delivered through the UI thread's message loop), a mouse hook
 * only while an Alt/F10 gesture is in progress (a click cancels it: Alt+drag is block selection in
 * LibreOffice). Hooks never swallow input: every callback ends with CallNextHookEx, and the report
 * is delivered with setImmediate so the hook returns at once.
 */
import type { BrowserWindow } from 'electron';
import type { Logger } from '../../log';
import { canonicalHwnd, type Hwnd } from '../hwnd';
import { ShellKeyDetector } from '../key-state';
import type { ShellKey, ShellKeys } from '../types';
import {
  EVENT_SYSTEM_FOREGROUND,
  HC_ACTION,
  LLKHF_UP,
  VK_LBUTTON,
  VK_MBUTTON,
  VK_RBUTTON,
  VK_XBUTTON1,
  VK_XBUTTON2,
  WH_KEYBOARD_LL,
  WINEVENT_OUTOFCONTEXT,
} from './constants';
import type { KbdLlHookStruct, Win32Api } from './ffi';

const WH_MOUSE_LL = 14;
/** WM_LBUTTONDOWN, WM_RBUTTONDOWN, WM_MBUTTONDOWN, WM_MOUSEWHEEL, WM_XBUTTONDOWN, WM_MOUSEHWHEEL. */
const MOUSE_CANCEL_MESSAGES = new Set([0x0201, 0x0204, 0x0207, 0x020a, 0x020b, 0x020e]);
const MOUSE_BUTTONS = [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON, VK_XBUTTON1, VK_XBUTTON2];

/** Decides whether `hwnd` (the foreground window) is the host or one of its native document views. */
export type ForegroundPredicate = (win: BrowserWindow, hwnd: Hwnd) => boolean;

export class Win32ShellKeys implements ShellKeys {
  private win: BrowserWindow | null = null;
  private onKey: ((key: ShellKey) => void) | null = null;
  private readonly detector = new ShellKeyDetector();
  private winEventHook: bigint | null = null;
  private keyboardHook: bigint | null = null;
  private mouseHook: bigint | null = null;
  private winEventProc: bigint | null = null;
  private keyboardProc: bigint | null = null;
  private mouseProc: bigint | null = null;
  private readonly onClosed = (): void => this.stop();

  constructor(
    private readonly api: Win32Api,
    private readonly isOurs: ForegroundPredicate,
    private readonly log: Logger,
  ) {}

  start(win: BrowserWindow, onKey: (key: ShellKey) => void): void {
    this.stop();
    if (win.isDestroyed()) return;
    const { koffi, types, user32 } = this.api;
    this.win = win;
    this.onKey = onKey;
    win.once('closed', this.onClosed);
    this.winEventProc = koffi.register(this.handleWinEvent, koffi.pointer(types.WinEventProc));
    this.winEventHook = user32.SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, null, this.winEventProc, 0, 0, WINEVENT_OUTOFCONTEXT);
    if (!this.winEventHook) {
      this.log.warn('SetWinEventHook failed; Alt/F10 detection disabled');
      this.stop();
      return;
    }
    this.updateKeyboardHook(canonicalHwnd(user32.GetForegroundWindow()));
    this.log.info('Shell keys started');
  }

  stop(): void {
    const { koffi, user32 } = this.api;
    this.removeMouseHook();
    if (this.keyboardHook) user32.UnhookWindowsHookEx(this.keyboardHook);
    if (this.winEventHook) user32.UnhookWinEvent(this.winEventHook);
    for (const proc of [this.keyboardProc, this.winEventProc]) if (proc !== null) koffi.unregister(proc);
    this.keyboardHook = this.winEventHook = this.keyboardProc = this.winEventProc = null;
    if (this.win && !this.win.isDestroyed()) this.win.removeListener('closed', this.onClosed);
    this.win = null;
    this.onKey = null;
    this.detector.reset();
  }

  private ours(hwnd: Hwnd | null): boolean {
    return hwnd !== null && this.win !== null && !this.win.isDestroyed() && this.isOurs(this.win, hwnd);
  }

  private readonly handleWinEvent = (_hook: unknown, _event: number, hwnd: bigint | null): void => {
    try {
      this.updateKeyboardHook(canonicalHwnd(hwnd));
    } catch (err) {
      this.log.warn('Foreground tracking failed', { error: err instanceof Error ? err.message : String(err) });
    }
  };

  private updateKeyboardHook(foreground: Hwnd | null): void {
    const { koffi, types, user32, kernel32 } = this.api;
    const active = this.ours(foreground);
    if (active && !this.keyboardHook) {
      this.detector.reset();
      this.keyboardProc ??= koffi.register(this.handleKeyboard, koffi.pointer(types.LowLevelHookProc));
      this.keyboardHook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, this.keyboardProc, kernel32.GetModuleHandleW(null), 0);
      if (!this.keyboardHook) this.log.warn('SetWindowsHookExW(WH_KEYBOARD_LL) failed', { win32Error: kernel32.GetLastError() });
    } else if (!active && this.keyboardHook) {
      user32.UnhookWindowsHookEx(this.keyboardHook);
      this.keyboardHook = null;
      this.removeMouseHook();
      this.detector.reset();
    }
  }

  private readonly handleKeyboard = (code: number, wParam: number | bigint, lParam: bigint | null): number | bigint => {
    try {
      if (code === HC_ACTION && lParam !== null) this.onKeyEvent(this.api.koffi.decode(lParam, this.api.types.KBDLLHOOKSTRUCT) as KbdLlHookStruct);
    } catch (err) {
      this.log.warn('Keyboard hook error', { error: err instanceof Error ? err.message : String(err) });
    }
    return this.api.user32.CallNextHookEx(null, code, wParam, lParam);
  };

  private onKeyEvent(info: KbdLlHookStruct): void {
    if (!this.ours(canonicalHwnd(this.api.user32.GetForegroundWindow()))) {
      this.detector.reset();
      return;
    }
    const key = this.detector.handle({ vk: info.vkCode, down: (info.flags & LLKHF_UP) === 0, time: info.time });
    // A gesture that starts while a mouse button is held (Alt+drag) is not a KeyTips request.
    if (this.detector.armed && MOUSE_BUTTONS.some((vk) => (this.api.user32.GetAsyncKeyState(vk) & 0x8000) !== 0)) this.detector.cancel();
    if (this.detector.armed) this.installMouseHook();
    else this.removeMouseHook();
    if (key) {
      const onKey = this.onKey;
      setImmediate(() => onKey?.(key));
    }
  }

  private readonly handleMouse = (code: number, wParam: number | bigint, lParam: bigint | null): number | bigint => {
    try {
      if (code === HC_ACTION && MOUSE_CANCEL_MESSAGES.has(Number(wParam))) {
        this.detector.cancel();
        setImmediate(() => this.removeMouseHook());
      }
    } catch (err) {
      this.log.warn('Mouse hook error', { error: err instanceof Error ? err.message : String(err) });
    }
    return this.api.user32.CallNextHookEx(null, code, wParam, lParam);
  };

  private installMouseHook(): void {
    if (this.mouseHook) return;
    const { koffi, types, user32, kernel32 } = this.api;
    this.mouseProc ??= koffi.register(this.handleMouse, koffi.pointer(types.LowLevelHookProc));
    this.mouseHook = user32.SetWindowsHookExW(WH_MOUSE_LL, this.mouseProc, kernel32.GetModuleHandleW(null), 0);
  }

  private removeMouseHook(): void {
    if (this.mouseHook) this.api.user32.UnhookWindowsHookEx(this.mouseHook);
    this.mouseHook = null;
    if (this.mouseProc !== null) this.api.koffi.unregister(this.mouseProc);
    this.mouseProc = null;
  }
}
