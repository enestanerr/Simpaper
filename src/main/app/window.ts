/** The main window: frameless title bar with the Windows caption-button overlay, secure web preferences. */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, nativeTheme } from 'electron';
import type { WindowState } from '@shared/api/app';
import { BRAND } from '@shared/brand';
import { computeWindowState } from './activeState';
import { chromeColors } from './theme';

export interface AppEntry {
  /** URL passed to loadURL (dev server) — or undefined for the bundled file. */
  devUrl?: string;
  /** Bundled index.html. */
  file: string;
  /** The URL our page has once loaded (used to validate IPC senders and navigation). */
  appUrl: string;
}

export function resolveAppEntry(mainDir: string, devUrl = process.env['ELECTRON_RENDERER_URL']): AppEntry {
  const file = join(mainDir, '../renderer/index.html');
  if (devUrl) return { devUrl, file, appUrl: devUrl };
  return { file, appUrl: pathToFileURL(file).href };
}

export interface MainWindowOptions {
  /**
   * Show the window once it has painted (default true). The smoke run (SIMPAPER_SMOKE) passes false: the window
   * then stays hidden for its whole life.
   */
  show?: boolean;
}

export function createMainWindow(preload: string, opts: MainWindowOptions = {}): BrowserWindow {
  const colors = chromeColors(nativeTheme.shouldUseDarkColors);
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: BRAND.productName,
    backgroundColor: colors.background,
    titleBarStyle: 'hidden',
    titleBarOverlay: colors.overlay,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      webviewTag: false,
    },
  });
  if (opts.show === false) return win;
  let shown = false;
  const show = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
  };
  win.once('ready-to-show', show);
  // Never stay invisible if the renderer fails to paint (crash, blocked load).
  const fallback = setTimeout(show, 8000);
  win.once('show', () => clearTimeout(fallback));
  win.once('closed', () => clearTimeout(fallback));
  return win;
}

export async function loadApp(win: BrowserWindow, entry: AppEntry): Promise<void> {
  if (entry.devUrl) await win.loadURL(entry.devUrl);
  else await win.loadFile(entry.file);
}

export function applyChromeTheme(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const colors = chromeColors(nativeTheme.shouldUseDarkColors);
  win.setBackgroundColor(colors.background);
  try {
    win.setTitleBarOverlay(colors.overlay);
  } catch {
    // titleBarOverlay is not available on this platform/window
  }
}

/** Window state for the renderer; `isForeground` (ViewHost) makes `active` cover the native document windows. */
export function windowState(win: BrowserWindow | null, isForeground?: () => boolean): WindowState {
  return computeWindowState(win, isForeground);
}
