/** Module lookup without import cycles: modules/index.ts registers the definitions at start-up. */
import type { ModuleKind } from '@shared/modules';
import type { ModuleDefinition } from './types';

const modules = new Map<ModuleKind, ModuleDefinition>();

export function registerModules(defs: readonly ModuleDefinition[]): void {
  for (const def of defs) modules.set(def.kind, def);
}

export function getModule(kind: ModuleKind): ModuleDefinition | undefined {
  return modules.get(kind);
}

export function allModules(): ModuleDefinition[] {
  return [...modules.values()];
}
