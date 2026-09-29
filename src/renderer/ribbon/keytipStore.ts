/**
 * KeyTip runtime: which scope is showing badges, what has been typed, and the registry of mounted
 * targets. Scopes: `root` (File, tabs, QAT), `tab:<tabId>` (controls of the selected tab) and
 * `popup:<id>` (controls inside an opened collapsed group).
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { create } from 'zustand';
import { appendKeyTipChar, matchKeyTip, type KeyTipTarget } from './keytips';

export interface RegisteredKeyTip extends KeyTipTarget {
  /** Performs the control's action; returns the next scope to show, or null to leave KeyTip mode. */
  activate: () => string | null | void;
}

interface KeyTipState {
  active: boolean;
  scope: string;
  /** Scopes entered so far (Esc steps back). */
  stack: string[];
  typed: string;
}

export const useKeyTips = create<KeyTipState>()(() => ({ active: false, scope: 'root', stack: [], typed: '' }));

const registry = new Map<string, Map<string, RegisteredKeyTip>>();

export function registerKeyTip(scope: string, target: RegisteredKeyTip): () => void {
  let map = registry.get(scope);
  if (!map) {
    map = new Map();
    registry.set(scope, map);
  }
  map.set(target.id, target);
  return () => {
    const m = registry.get(scope);
    if (m?.get(target.id) === target) m.delete(target.id);
  };
}

export function keyTipTargets(scope: string): RegisteredKeyTip[] {
  return [...(registry.get(scope)?.values() ?? [])];
}

export function startKeyTips(scope = 'root'): void {
  useKeyTips.setState({ active: true, scope, stack: [], typed: '' });
}

export function stopKeyTips(): void {
  if (useKeyTips.getState().active) useKeyTips.setState({ active: false, scope: 'root', stack: [], typed: '' });
}

export function enterKeyTipScope(scope: string): void {
  const s = useKeyTips.getState();
  useKeyTips.setState({ active: true, scope, stack: [...s.stack, s.scope], typed: '' });
}

/** Esc: clears the typed prefix, else returns to the previous scope, else leaves KeyTip mode. */
export function keyTipBack(): void {
  const s = useKeyTips.getState();
  if (!s.active) return;
  if (s.typed) {
    useKeyTips.setState({ typed: '' });
    return;
  }
  const prev = s.stack[s.stack.length - 1];
  if (prev === undefined) stopKeyTips();
  else useKeyTips.setState({ scope: prev, stack: s.stack.slice(0, -1), typed: '' });
}

/**
 * Handles one typed key while KeyTips are shown. Returns true when the key was consumed.
 * Unknown keys are swallowed (Office ignores them) so they never reach the document.
 */
export function keyTipInput(key: string): boolean {
  const s = useKeyTips.getState();
  if (!s.active) return false;
  const typed = appendKeyTipChar(s.typed, key);
  if (typed === null) return false;
  const match = matchKeyTip(keyTipTargets(s.scope), typed);
  if (match.kind === 'none') return true;
  if (match.kind === 'partial') {
    useKeyTips.setState({ typed });
    return true;
  }
  const next = match.target.activate();
  if (typeof next === 'string') enterKeyTipScope(next);
  else stopKeyTips();
  return true;
}

/**
 * Registers a KeyTip target while the component is mounted and returns the badge text to show
 * (null when KeyTips are off, in another scope, or filtered out by the typed prefix).
 */
export function useKeyTip(scope: string | null, id: string, keytip: string | undefined, activate: RegisteredKeyTip['activate']): string | null {
  const activateRef = useRef(activate);
  useLayoutEffect(() => {
    activateRef.current = activate;
  });
  useEffect(() => {
    if (!scope || !keytip) return;
    return registerKeyTip(scope, { id, keytip, activate: () => activateRef.current() });
  }, [scope, id, keytip]);
  return useKeyTips((s) => (s.active && scope && keytip && s.scope === scope && keytip.startsWith(s.typed) ? keytip : null));
}
