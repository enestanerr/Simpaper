/**
 * Selection-change notifications per document. The engine emits `selection` events; they reach the
 * renderer only if the main process forwards them as a documents:event of type `selection`
 * (not part of the current DocumentEvent contract). Consumers therefore also poll while no event
 * has been seen (see CalcFormulaBar).
 */
type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
let seen = false;

export function emitSelectionChange(docId: string): void {
  seen = true;
  for (const l of listeners.get(docId) ?? []) l();
}

export function onSelectionChange(docId: string, listener: Listener): () => void {
  let set = listeners.get(docId);
  if (!set) {
    set = new Set();
    listeners.set(docId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

/** True once the main process has delivered at least one selection event (polling can stop). */
export function selectionEventsAvailable(): boolean {
  return seen;
}
