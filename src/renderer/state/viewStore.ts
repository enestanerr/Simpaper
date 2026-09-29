/** Native document view bookkeeping: freeze-frame snapshots and the placeholder elements of each document. */
import { create } from 'zustand';

interface ViewStoreState {
  /** docId → snapshot (PNG data URL) shown while the native view is frozen; null = frozen without image. */
  frozen: Record<string, string | null>;
}

export const useViews = create<ViewStoreState>()(() => ({ frozen: {} }));

export function setFrozen(docId: string, snapshot: string | null): void {
  useViews.setState((s) => ({ frozen: { ...s.frozen, [docId]: snapshot } }));
}

export function clearFrozen(docId: string): void {
  useViews.setState((s) => {
    if (!(docId in s.frozen)) return {};
    const frozen = { ...s.frozen };
    delete frozen[docId];
    return { frozen };
  });
}

export function useFrozenSnapshot(docId: string): { frozen: boolean; snapshot: string | null } {
  const value = useViews((s) => s.frozen[docId]);
  return { frozen: value !== undefined, snapshot: value ?? null };
}

const surfaces = new Map<string, HTMLElement>();

/** DocumentSurface registers its placeholder so popups can test whether they overlap the native view. */
export function registerSurface(docId: string, el: HTMLElement): () => void {
  surfaces.set(docId, el);
  return () => {
    if (surfaces.get(docId) === el) surfaces.delete(docId);
  };
}

export function getSurface(docId: string): HTMLElement | undefined {
  return surfaces.get(docId);
}
