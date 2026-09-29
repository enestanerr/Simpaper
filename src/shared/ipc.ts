/**
 * Typed IPC surface between the renderer and the main process.
 * Each namespace lives in src/shared/api/<namespace>.ts and is owned by one main-process service.
 * The preload script only forwards channels listed here.
 */
import { APP_CHANNELS, APP_EVENTS, type AppChannels, type AppEvents } from './api/app';
import { DOCUMENT_CHANNELS, DOCUMENT_EVENTS, type DocumentChannels, type DocumentEvents } from './api/documents';
import { ENGINE_CHANNELS, type EngineChannels } from './api/engine';
import { PDF_CHANNELS, type PdfChannels } from './api/pdf';
import { RECOVERY_CHANNELS, type RecoveryChannels } from './api/recovery';

export type Channels = AppChannels & DocumentChannels & EngineChannels & PdfChannels & RecoveryChannels;
export type Channel = keyof Channels;
export type ChannelReq<C extends Channel> = Channels[C]['req'];
export type ChannelRes<C extends Channel> = Channels[C]['res'];

export type Events = AppEvents & DocumentEvents;
export type EventChannel = keyof Events;

export const INVOKE_CHANNELS: readonly string[] = [
  ...APP_CHANNELS,
  ...DOCUMENT_CHANNELS,
  ...ENGINE_CHANNELS,
  ...PDF_CHANNELS,
  ...RECOVERY_CHANNELS,
];
export const EVENT_CHANNELS: readonly string[] = [...APP_EVENTS, ...DOCUMENT_EVENTS];

/** What the preload script exposes as `window.varakIpc`. */
export interface VarakIpcBridge {
  invoke<C extends Channel>(channel: C, req: ChannelReq<C>): Promise<ChannelRes<C>>;
  on<E extends EventChannel>(channel: E, listener: (payload: Events[E]) => void): () => void;
}
