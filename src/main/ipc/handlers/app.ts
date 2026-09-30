/** `app:*` handlers. */
import type { AppChannels } from '@shared/api/app';
import type { Handler } from '../router';
import type { IpcServices } from '../services';
import { IpcValidationError, isRecord, none, obj, oneOf, req, str } from '../validate';

const windowReq = obj({ action: req(oneOf(['minimize', 'toggleMaximize', 'close', 'toggleFullScreen'] as const)) });
const externalReq = obj({ url: req(str({ min: 8, max: 2048 })) });

/**
 * `engine.programDir` names the folder soffice.exe and python.exe are started from, so it is read-only over IPC:
 * the renderer is untrusted and must never choose executables. The unchanged value is accepted because the shell
 * sends the whole `engine` group back when it changes `viewMode`. The folder can only be set in settings.json
 * (or with SIMPAPER_ENGINE_DIR) and takes effect at the next start.
 */
export function assertProgramDirUnchanged(patch: unknown, current: string): void {
  if (!isRecord(patch)) return; // the settings store rejects it
  const engine = patch['engine'];
  if (!isRecord(engine) || !Object.hasOwn(engine, 'programDir')) return;
  if (engine['programDir'] !== current) throw new IpcValidationError('req.engine.programDir');
}

export function appHandlers(s: IpcServices): Record<keyof AppChannels, Handler> {
  return {
    'app:info': (p) => {
      none(p, 'req');
      return s.app.info();
    },
    'app:settings:get': (p) => {
      none(p, 'req');
      return s.app.getSettings();
    },
    // The settings store validates every field (schema.ts) and rejects unknown keys.
    'app:settings:update': (p) => {
      assertProgramDirUnchanged(p, s.app.getSettings().engine.programDir);
      return s.app.updateSettings(p);
    },
    'app:window': (p) => s.app.windowAction(windowReq(p, 'req').action),
    'app:window:state': (p) => {
      none(p, 'req');
      return s.app.windowState();
    },
    'app:openExternal': (p) => s.app.openExternal(externalReq(p, 'req').url),
    'app:fileTypes': (p) => {
      none(p, 'req');
      return s.app.fileTypes();
    },
    'app:openDefaultApps': (p) => {
      none(p, 'req');
      return s.app.openDefaultApps();
    },
  };
}
