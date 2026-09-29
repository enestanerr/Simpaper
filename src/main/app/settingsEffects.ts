/**
 * What a settings change does while the app runs (SettingsStore.onChange in bootstrap.ts).
 *
 * `engine.programDir` is deliberately not applied at runtime: engines are started from that folder, so a new
 * value (only possible by editing settings.json; IPC rejects it) takes effect at the next start. Passing it to
 * the engine manager would also restart the warm spare from the new folder at once.
 */
import type { Settings, ThemePreference } from '@shared/api/app';
import type { EngineManager } from '../engine/types';
import type { Logger } from '../log';

export interface SettingsEffectDeps {
  setThemeSource(theme: ThemePreference): void;
  engine: Pick<EngineManager, 'updateProfileOptions'>;
  documentLocale(language: Settings['language']): string;
  recovery: { applySettings(): void };
  recent: { trim(): Promise<void> };
  /** Starts/stops the experimental shell-key hook (settings.ui.documentKeyTips). */
  applyShellKeys(): void;
  /** `app:settingsChanged` to the renderer. */
  notify(next: Settings): void;
  log?: Logger;
}

export function applySettingsChange(next: Settings, prev: Settings, deps: SettingsEffectDeps): void {
  if (next.theme !== prev.theme) deps.setThemeSource(next.theme);
  if (next.language !== prev.language || next.theme !== prev.theme) {
    deps.engine.updateProfileOptions({ uiLanguage: next.language, documentLocale: deps.documentLocale(next.language), appearance: next.theme });
  }
  if (next.engine.programDir !== prev.engine.programDir) deps.log?.info('engine folder changed; it takes effect at the next start');
  if (next.autosaveMinutes !== prev.autosaveMinutes) deps.recovery.applySettings();
  if (next.recentLimit !== prev.recentLimit) void deps.recent.trim();
  if (Boolean(next.ui.documentKeyTips) !== Boolean(prev.ui.documentKeyTips)) deps.applyShellKeys();
  deps.notify(next);
}
