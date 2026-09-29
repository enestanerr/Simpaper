/** `app:*` services: application info, settings, window controls and allow-listed external links. */
import { app, shell, type BrowserWindow } from 'electron';
import type { AppInfo, Settings, WindowState } from '@shared/api/app';
import { BRAND } from '@shared/brand';
import type { EngineManager, EngineProbe } from '../engine/types';
import type { AppController, WindowAction } from '../ipc/services';
import type { Logger } from '../log';
import type { SettingsStore } from '../settings/store';
import { isAllowedExternalUrl } from './security';
import { windowState } from './window';

export interface AppControllerDeps {
  getWindow: () => BrowserWindow | null;
  settings: SettingsStore;
  probeEngine: () => Promise<EngineProbe>;
  log: Logger;
  /** Foreground check of the native document windows (ViewHost.isForeground) for `WindowState.active`. */
  isForeground?: (win: BrowserWindow) => boolean;
}

export function createAppController(deps: AppControllerDeps): AppController {
  const win = () => {
    const w = deps.getWindow();
    return w && !w.isDestroyed() ? w : null;
  };
  const stateOf = (w: BrowserWindow | null): WindowState => {
    const isForeground = deps.isForeground;
    return windowState(w, w && isForeground ? () => isForeground(w) : undefined);
  };
  return {
    async info(): Promise<AppInfo> {
      let engine: EngineProbe;
      try {
        engine = await deps.probeEngine();
      } catch (err) {
        engine = { available: false, programDir: null, officeVersion: null, error: err instanceof Error ? err.message : String(err) };
      }
      return {
        productName: BRAND.productName,
        version: app.getVersion(),
        electronVersion: process.versions.electron ?? '',
        chromeVersion: process.versions.chrome ?? '',
        platform: process.platform,
        locale: app.getLocale(),
        engine: {
          available: engine.available,
          programDir: engine.programDir,
          officeVersion: engine.officeVersion,
          ...(engine.error ? { error: engine.error } : {}),
        },
        isPackaged: app.isPackaged,
      };
    },
    getSettings(): Settings {
      return deps.settings.get();
    },
    updateSettings(patch: unknown): Promise<Settings> {
      return deps.settings.update(patch);
    },
    windowAction(action: WindowAction): WindowState {
      const w = win();
      if (w) {
        switch (action) {
          case 'minimize':
            w.minimize();
            break;
          case 'toggleMaximize':
            if (w.isMaximized()) w.unmaximize();
            else w.maximize();
            break;
          case 'toggleFullScreen':
            w.setFullScreen(!w.isFullScreen());
            break;
          case 'close':
            // Goes through the window's close handler, i.e. the quit flow with unsaved-changes prompts.
            w.close();
            break;
        }
      }
      return stateOf(w);
    },
    windowState: () => stateOf(win()),
    async openExternal(url: string): Promise<boolean> {
      if (!isAllowedExternalUrl(url)) {
        deps.log.warn('external URL not allowed', { url: url.slice(0, 100) });
        return false;
      }
      await shell.openExternal(url);
      return true;
    },
  };
}

/** Caches EngineManager.probe() (it may spawn a process); refreshed when the engine location changes. */
export function createEngineProbe(engine: () => EngineManager | null): { probe(): Promise<EngineProbe>; invalidate(): void } {
  let cached: Promise<EngineProbe> | null = null;
  return {
    probe() {
      const e = engine();
      if (!e) return Promise.resolve({ available: false, programDir: null, officeVersion: null, error: 'engine manager unavailable' });
      cached ??= e.probe().catch((err: unknown) => {
        cached = null;
        return { available: false, programDir: null, officeVersion: null, error: err instanceof Error ? err.message : String(err) };
      });
      return cached;
    },
    invalidate() {
      cached = null;
    },
  };
}
