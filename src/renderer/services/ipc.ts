/** Typed access to the main process. The preload exposes `window.simpaperIpc` (see src/preload/index.ts). */
import type { Channel, ChannelReq, ChannelRes, EventChannel, Events, SimpaperIpcBridge } from '@shared/ipc';

function bridge(): SimpaperIpcBridge {
  const b = (globalThis as unknown as { simpaperIpc?: SimpaperIpcBridge }).simpaperIpc;
  if (!b) throw new Error('simpaperIpc bridge is not available (preload not loaded?)');
  return b;
}

export function invoke<C extends Channel>(channel: C, req: ChannelReq<C>): Promise<ChannelRes<C>> {
  return bridge().invoke(channel, req);
}

export function on<E extends EventChannel>(channel: E, listener: (payload: Events[E]) => void): () => void {
  return bridge().on(channel, listener);
}

/** True when running inside the Electron shell (false in unit tests / storybook-like previews). */
export function hasBridge(): boolean {
  return Boolean((globalThis as unknown as { simpaperIpc?: unknown }).simpaperIpc);
}
