import type { VarakIpcBridge } from '../shared/ipc';

declare global {
  interface Window {
    varakIpc: VarakIpcBridge;
  }
}

export {};
