/**
 * Platform layer contracts (implementation: src/main/platform/win32/*).
 * Only Windows is supported for native document views; other platforms get a stub that reports
 * `supported = false` so the PDF module and the shell still work.
 */
import type { BrowserWindow } from 'electron';
import type { ViewMode, ViewParams } from '@shared/engine-protocol';
import type { CssRect } from '@shared/api/engine';

export interface ViewHost {
  readonly supported: boolean;
  /** View parameters for the bridge's doc.load/doc.new (parent HWND + initial physical bounds). */
  viewParamsFor(win: BrowserWindow, mode: ViewMode, cssRect?: CssRect): ViewParams;
  /** Registers the native frame window reported by the bridge (DocLoadResult.hwnd). */
  attach(docId: string, win: BrowserWindow, nativeHwnd: string, mode: ViewMode): void;
  /** Maps a CSS rect of the renderer to the native window (DIP → physical, client → screen for `owned`). */
  setBounds(docId: string, cssRect: CssRect): void;
  setVisible(docId: string, visible: boolean): void;
  focus(docId: string): void;
  /** Snapshot (PNG data URL) + hide, so HTML can be shown over the document area. */
  freeze(docId: string): Promise<string | null>;
  unfreeze(docId: string): void;
  detach(docId: string): void;
  /** Re-applies positions after the host window moved/resized/changed DPI (owned mode follows the host). */
  syncAll(win: BrowserWindow): void;
  dispose(): void;
  /**
   * True when the foreground window is `win` itself or a native document window attached to it.
   * In `owned` mode the LibreOffice window is its own top-level window, so the BrowserWindow emits
   * `blur` while the user works in a document; the shell can use this to keep its active look.
   */
  isForeground?(win: BrowserWindow): boolean;
}

export interface KillTreeOptions {
  /**
   * Only descendants whose executable lies in this directory (or below it) are killed and walked;
   * the root itself is always killed. Protects programs the engine started on the user's behalf
   * (e.g. a browser opened from a hyperlink) from dying with the engine.
   */
  imageDir?: string;
  /** How long to wait for all processes to exit before rejecting (default 5000 ms). */
  timeoutMs?: number;
}

/** Keeps child processes from outliving the app (Windows Job Object with KILL_ON_JOB_CLOSE). */
export interface ProcessGuard {
  readonly supported: boolean;
  adopt(pid: number): void;
  /** Kills the process and all its descendants. */
  killTree(pid: number, options?: KillTreeOptions): Promise<void>;
}

/** Detects a hung native window (SendMessageTimeout WM_NULL from a worker thread). */
export interface HangDetector {
  isResponding(nativeHwnd: string, timeoutMs: number): Promise<boolean>;
}

/** Keys the shell handles itself (KeyTips) even while a native LibreOffice window has the focus. */
export type ShellKey = 'Alt' | 'F10';

/**
 * Experimental: reports a bare Alt tap (AltGr / Ctrl+Alt ignored) and F10 while `win` or one of its
 * native document windows is in the foreground. Installs a low-level keyboard hook only while the
 * app is in the foreground; nothing happens until `start` is called.
 */
export interface ShellKeys {
  start(win: BrowserWindow, onKey: (key: ShellKey) => void): void;
  stop(): void;
}

/** Everything the platform layer provides; created once by `createPlatform()` (src/main/platform/index.ts). */
export interface Platform {
  viewHost: ViewHost;
  processGuard: ProcessGuard;
  hangDetector: HangDetector;
  /**
   * Lets process `pid` bring its own window to the front once (Windows' foreground lock): an engine that opens a
   * LibreOffice dialog in answer to a ribbon command may then activate it, so the dialog gets the keyboard focus.
   * Must be called while the app is in the foreground. No-op where there is no such lock.
   */
  allowForeground(pid: number): void;
  /**
   * Gives the keyboard focus to `win` itself (Simpaper's own controls) when a LibreOffice window inside it has it:
   * Windows leaves it there when the user clicks the web content. Resolves true when it was taken from a
   * LibreOffice window; left alone (false) for LibreOffice dialogs and for a window that does not answer.
   */
  focusHost(win: BrowserWindow): Promise<boolean>;
  /** Present on Windows only. */
  shellKeys?: ShellKeys;
}
