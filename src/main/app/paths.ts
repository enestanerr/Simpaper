/**
 * Where Simpaper keeps its data.
 *  - userData (%APPDATA%\Simpaper, roaming): small user files — settings.json, recent.json.
 *  - local data (%LOCALAPPDATA%\Simpaper, machine-local): engine profiles, working copies, recovery
 *    snapshots, logs, Chromium session data, scratch files.
 * Unpackaged (development) runs use a `-dev` suffix so they never touch a user's real data.
 */
import { dirname, join } from 'node:path';

export interface AppPaths {
  userData: string;
  localData: string;
  sessionData: string;
  engineProfiles: string;
  work: string;
  recovery: string;
  logs: string;
  scratch: string;
  settingsFile: string;
  recentFile: string;
}

export interface PathInputs {
  /** app.getPath('appData'). */
  appData: string;
  /** %LOCALAPPDATA% (Windows); undefined elsewhere. */
  localAppData?: string;
  folderName: string;
  platform?: NodeJS.Platform;
}

export function localDataRoot(inputs: PathInputs): string {
  const platform = inputs.platform ?? process.platform;
  if (platform === 'win32') {
    const base = inputs.localAppData && inputs.localAppData.trim() ? inputs.localAppData : join(dirname(inputs.appData), 'Local');
    return join(base, inputs.folderName);
  }
  return join(inputs.appData, inputs.folderName, 'Local');
}

export function resolveAppPaths(inputs: PathInputs): AppPaths {
  const userData = join(inputs.appData, inputs.folderName);
  const localData = localDataRoot(inputs);
  return {
    userData,
    localData,
    sessionData: join(localData, 'session'),
    engineProfiles: join(localData, 'engine'),
    work: join(localData, 'work'),
    recovery: join(localData, 'recovery'),
    logs: join(localData, 'logs'),
    scratch: join(localData, 'tmp'),
    settingsFile: join(userData, 'settings.json'),
    recentFile: join(userData, 'recent.json'),
  };
}
