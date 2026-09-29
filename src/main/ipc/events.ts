/** Main → renderer events (EVENT_CHANNELS of src/shared/ipc.ts). */
import type { EventChannel, Events } from '@shared/ipc';

export interface EventTargetWindow {
  isDestroyed(): boolean;
  webContents: { isDestroyed(): boolean; send(channel: string, payload: unknown): void };
}

export type EventSender = <E extends EventChannel>(channel: E, payload: Events[E]) => void;

export function createEventSender(getWindow: () => EventTargetWindow | null): EventSender {
  return (channel, payload) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(channel, payload);
  };
}
