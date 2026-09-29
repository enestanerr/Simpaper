/** Settings: read from and written to the main process; language and theme are applied on every change. */
import type { Settings } from '@shared/api/app';
import { setLanguage } from '../i18n';
import { applyTheme } from '../theme/theme';
import { pushMessage, useApp } from '../state/appStore';
import { errorText } from './engine';
import { hasBridge, invoke } from './ipc';

export function applySettings(settings: Settings): void {
  const prev = useApp.getState().settings;
  useApp.setState({ settings });
  if (prev.language !== settings.language || document.documentElement.lang !== settings.language) void setLanguage(settings.language);
  applyTheme(settings.theme);
}

/**
 * Updates settings. Nested groups (csv, engine, ui) are merged with the current values because the
 * IPC contract replaces top-level keys.
 */
export async function updateSettings(patch: {
  [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K];
}): Promise<void> {
  const current = useApp.getState().settings;
  const full: Partial<Settings> = {};
  for (const key of Object.keys(patch) as (keyof Settings)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    const base = current[key];
    (full as Record<string, unknown>)[key] =
      typeof base === 'object' && base !== null && !Array.isArray(base) ? { ...base, ...(value as object) } : value;
  }
  // Optimistic: the UI reacts immediately, the main process answers with the persisted settings.
  applySettings({ ...current, ...full });
  if (!hasBridge()) return;
  try {
    applySettings(await invoke('app:settings:update', full));
  } catch (err) {
    applySettings(current);
    pushMessage({ kind: 'error', docId: null, key: 'shell.messages.settingsFailed', detail: errorText(err) });
  }
}
