/**
 * IPC router: one `ipcMain.handle` per channel of src/shared/ipc.ts. Every request is checked for its
 * sender (our window, our page, main frame) and its payload shape before a service is called.
 * Failures reject with an i18n key as the message (`errors.*`); internal details stay in the log.
 */
import { INVOKE_CHANNELS, type Channel } from '@shared/ipc';
import { DocumentError } from '../documents/errors';
import { SettingsValidationError } from '../settings/store';
import { appHandlers } from './handlers/app';
import { documentHandlers } from './handlers/documents';
import { engineHandlers } from './handlers/engine';
import { pdfHandlers } from './handlers/pdf';
import { recoveryHandlers } from './handlers/recovery';
import type { IpcEventLike } from './sender';
import type { IpcServices } from './services';
import { IpcValidationError } from './validate';

export type Handler = (payload: unknown) => unknown;
export type HandlerMap = Record<Channel, Handler>;

export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, payload: unknown) => unknown): void;
  removeHandler(channel: string): void;
}

export class IpcRequestError extends Error {
  override readonly name = 'IpcRequestError';
}

export function createHandlers(services: IpcServices): HandlerMap {
  return {
    ...appHandlers(services),
    ...documentHandlers(services),
    ...engineHandlers(services),
    ...pdfHandlers(services),
    ...recoveryHandlers(services),
  };
}

/** The key sent to the renderer for a failure. */
export function errorKeyFor(err: unknown): string {
  if (err instanceof DocumentError) return err.errorKey;
  if (err instanceof IpcValidationError) return 'errors.ipc.invalidRequest';
  if (err instanceof SettingsValidationError) return 'errors.settings.invalid';
  if (err instanceof IpcRequestError) return err.message;
  return 'errors.generic';
}

export interface IpcRouter {
  dispatch(channel: string, event: IpcEventLike, payload: unknown): Promise<unknown>;
  register(ipcMain: IpcMainLike): () => void;
}

export function createIpcRouter(opts: { handlers: HandlerMap; isTrustedSender: (event: IpcEventLike) => boolean; services: Pick<IpcServices, 'log' | 'onRendererRequest'> }): IpcRouter {
  const allowed = new Set<string>(INVOKE_CHANNELS);
  const log = opts.services.log;

  const dispatch = async (channel: string, event: IpcEventLike, payload: unknown): Promise<unknown> => {
    if (!allowed.has(channel)) throw new IpcRequestError('errors.ipc.unknownChannel');
    if (!opts.isTrustedSender(event)) {
      log.warn('IPC request from an untrusted sender rejected', { channel, url: event.senderFrame?.url?.slice(0, 200) });
      throw new IpcRequestError('errors.ipc.untrustedSender');
    }
    opts.services.onRendererRequest?.(channel);
    const handler = opts.handlers[channel as Channel];
    try {
      return await handler(payload);
    } catch (err) {
      const key = errorKeyFor(err);
      if (key === 'errors.generic') log.error('IPC handler failed', { channel, error: err });
      else if (err instanceof IpcValidationError) log.warn('IPC request rejected', { channel, path: err.path });
      throw new IpcRequestError(key);
    }
  };

  return {
    dispatch,
    register(ipcMain) {
      for (const channel of INVOKE_CHANNELS) ipcMain.handle(channel, (event, payload) => dispatch(channel, event, payload));
      return () => {
        for (const channel of INVOKE_CHANNELS) ipcMain.removeHandler(channel);
      };
    },
  };
}
