/** Module registry: the four editors of the suite. */
import type { ModuleKind } from '@shared/modules';
import { calcModule } from './calc';
import { impressModule } from './impress';
import { loadPdfWorkspace, pdfModule } from './pdfLazy';
import { registerModules } from './registry';
import type { ModuleDefinition } from './types';
import { writerModule } from './writer';

export const MODULES: readonly ModuleDefinition[] = [writerModule, calcModule, impressModule, pdfModule];

registerModules(MODULES);

export function moduleFor(kind: ModuleKind): ModuleDefinition {
  const def = MODULES.find((m) => m.kind === kind);
  if (!def) throw new Error(`No module for ${kind}`);
  return def;
}

/**
 * Loads code-split module parts (the PDF workspace with pdf.js) a little after start-up, when the shell is
 * idle, so the first PDF opens without waiting for the chunk while start-up does not pay for it.
 * Failures are ignored here; the workspace reports them when it is used.
 */
export function preloadModules(delayMs = 2500, idleTimeoutMs = 4000): void {
  const load = () => void loadPdfWorkspace().catch(() => undefined);
  const w = globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  setTimeout(() => {
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(load, { timeout: idleTimeoutMs });
    else load();
  }, delayMs);
}

export { writerModule, calcModule, impressModule, pdfModule };
