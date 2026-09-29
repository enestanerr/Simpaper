/**
 * Sandboxed preload: exposes a minimal, allow-listed IPC bridge as `window.varakIpc`.
 * No Node APIs reach the renderer.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type VarakIpcBridge } from '@shared/ipc';

const invokeAllowed = new Set<string>(INVOKE_CHANNELS);
const eventAllowed = new Set<string>(EVENT_CHANNELS);

const bridge: VarakIpcBridge = {
  invoke(channel, req) {
    if (!invokeAllowed.has(channel)) return Promise.reject(new Error(`Blocked IPC channel: ${String(channel)}`));
    return ipcRenderer.invoke(channel, req);
  },
  on(channel, listener) {
    if (!eventAllowed.has(channel)) throw new Error(`Blocked IPC event: ${String(channel)}`);
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => listener(payload as never);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('varakIpc', bridge);
