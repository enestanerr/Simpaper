import type { SimpaperIpcBridge } from '../shared/ipc';

declare global {
  interface Window {
    simpaperIpc: SimpaperIpcBridge;
  }
}

export {};
