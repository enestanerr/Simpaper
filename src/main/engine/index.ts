/**
 * Engine layer entry point. See docs/dev/engine.md for the process model, the bridge protocol and
 * the profile.
 */
import type { Logger } from '../log';
import type { ProcessGuard } from '../platform/types';
import { DefaultEngineManager } from './EngineManager';
import type { EngineManager, EngineManagerOptions } from './types';

export function createEngineManager(opts: EngineManagerOptions, deps: { processGuard: ProcessGuard; log: Logger }): EngineManager {
  return new DefaultEngineManager(opts, deps);
}

export { EngineRpcError, isEngineRpcError } from './rpc';
export { EngineStartError } from './EngineInstance';
export type * from './types';
