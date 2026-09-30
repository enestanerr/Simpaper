/** `app:*` — application info, settings and window controls. Owner: main/app + main/settings. */
import type { ModuleKind } from '../modules';

export type UiLanguage = 'tr' | 'en';
export type ThemePreference = 'system' | 'light' | 'dark';
export type ViewModeSetting = 'owned' | 'child';

export interface Settings {
  language: UiLanguage;
  theme: ThemePreference;
  /** Minutes between recovery snapshots of modified documents; 0 disables autosave. */
  autosaveMinutes: number;
  /** Re-open the written file headlessly before replacing the original (slower, safer). */
  verifyAfterSave: boolean;
  recentLimit: number;
  csv: {
    importSeparator: 'auto' | ';' | ',' | '\t';
    exportSeparator: 'auto' | ';' | ',' | '\t';
    exportBom: boolean;
  };
  engine: {
    /** Custom LibreOffice program directory; empty = bundled engine. */
    programDir: string;
    /** How native document windows are attached; see docs/adr/0003-document-surface.md. */
    viewMode: ViewModeSetting;
  };
  ui: {
    ribbonCollapsed: boolean;
    /** Quick Access Toolbar command ids (see renderer/ribbon registry). */
    quickAccess: string[];
    showStatusBar: boolean;
    /**
     * Experimental: KeyTips (bare Alt / F10) while a native document window has the keyboard focus.
     * Installs a low-level keyboard hook while Simpaper is in the foreground (src/main/platform). Default off;
     * absent = off.
     */
    documentKeyTips?: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'tr',
  theme: 'system',
  autosaveMinutes: 3,
  verifyAfterSave: true,
  recentLimit: 20,
  csv: { importSeparator: 'auto', exportSeparator: 'auto', exportBom: true },
  engine: { programDir: '', viewMode: 'child' },
  ui: { ribbonCollapsed: false, quickAccess: ['file.save', 'edit.undo', 'edit.redo'], showStatusBar: true, documentKeyTips: false },
};

export interface AppInfo {
  productName: string;
  version: string;
  electronVersion: string;
  chromeVersion: string;
  /** `process.platform` of the main process ("win32", "linux", "darwin"). */
  platform: string;
  locale: string;
  engine: {
    available: boolean;
    programDir: string | null;
    officeVersion: string | null;
    error?: string;
  };
  isPackaged: boolean;
}

export interface WindowState {
  maximized: boolean;
  fullScreen: boolean;
  focused: boolean;
  /**
   * The window counts as active: it is focused, or the foreground window is one of its native document
   * windows (or their dialogs). In `owned` mode typing in a document activates the LibreOffice window and
   * the BrowserWindow reports `focused: false`; the title bar should keep its active look while `active`.
   * Absent when the main process cannot tell (use `focused`).
   */
  active?: boolean;
}

/** File types of one module that the installer registers as default candidates (src/shared/fileAssociations.ts). */
export interface FileTypeGroup {
  kind: ModuleKind;
  /** Extensions without the dot, in FORMATS order. */
  extensions: string[];
  /** The extensions that open with this copy of Simpaper today. */
  withSimpaper: string[];
}

/** Which registered file types open with Simpaper (Options › File types). Read from Windows; never changed by the app. */
export interface FileTypesStatus {
  /** False where Windows cannot be asked (not Windows, or the Win32 bindings failed to load). */
  supported: boolean;
  /**
   * Where the installer registered Simpaper under Software\RegisteredApplications: `user` (installed for the
   * current user), `machine` (for all users) or null (development runs and the ZIP copy register nothing).
   */
  registration: 'user' | 'machine' | null;
  /** The registered file types start this copy of Simpaper.exe (false for another installation or the ZIP copy). */
  thisCopy: boolean;
  /**
   * Default candidates per module. The plain-text types (TXT, CSV, TSV) are left out: they are offered in "Open with"
   * and on Simpaper's Default apps page but never proposed as the default.
   */
  groups: FileTypeGroup[];
}

export interface AppChannels {
  'app:info': { req: void; res: AppInfo };
  'app:settings:get': { req: void; res: Settings };
  'app:settings:update': { req: Partial<Settings>; res: Settings };
  'app:window': { req: { action: 'minimize' | 'toggleMaximize' | 'close' | 'toggleFullScreen' }; res: WindowState };
  'app:window:state': { req: void; res: WindowState };
  /** Opens only allow-listed https URLs (project pages, licenses). */
  'app:openExternal': { req: { url: string }; res: boolean };
  /** Which registered file types open with Simpaper today (read only; Windows keeps the user's choice). */
  'app:fileTypes': { req: void; res: FileTypesStatus };
  /** Opens Windows Settings › Apps › Default apps on Simpaper's page (fixed target); false when that is not possible. */
  'app:openDefaultApps': { req: void; res: boolean };
}

export interface AppEvents {
  'app:settingsChanged': Settings;
  'app:windowState': WindowState;
}

/**
 * Window chrome colours shared by the main process (window background, Windows caption-button
 * overlay via titleBarOverlay) and the shell's title bar CSS, so both always match.
 */
export const WINDOW_CHROME = {
  titleBarHeight: 40,
  light: { background: '#F5F5F5', titleBar: '#F5F5F5', symbol: '#1D2B53' },
  dark: { background: '#1F1F1F', titleBar: '#202020', symbol: '#F3F3F3' },
} as const;

export const APP_CHANNELS = [
  'app:info',
  'app:settings:get',
  'app:settings:update',
  'app:window',
  'app:window:state',
  'app:openExternal',
  'app:fileTypes',
  'app:openDefaultApps',
] as const;
export const APP_EVENTS = ['app:settingsChanged', 'app:windowState'] as const;
