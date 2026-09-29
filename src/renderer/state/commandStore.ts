/**
 * Per-document state of `.uno:` commands (FeatureStateEvents streamed by the engine) and the
 * current LibreOffice context (Text, Table, Graphic, ...) used for contextual ribbon tabs.
 */
import { create } from 'zustand';
import type { CommandState, UnoPlain } from '@shared/engine-protocol';

export interface CommandStateEntry {
  enabled: boolean;
  value: UnoPlain;
}

interface CommandStoreState {
  states: Record<string, Record<string, CommandStateEntry>>;
  contexts: Record<string, string>;
  /** Monotonic counter per document, bumped on every state event (used as a cheap "something changed" signal). */
  revision: Record<string, number>;
}

export const useCommands = create<CommandStoreState>()(() => ({ states: {}, contexts: {}, revision: {} }));

export function setCommandState(docId: string, command: string, entry: CommandStateEntry): void {
  useCommands.setState((s) => {
    const prev = s.states[docId]?.[command];
    if (prev && prev.enabled === entry.enabled && sameValue(prev.value, entry.value)) return {};
    return {
      states: { ...s.states, [docId]: { ...s.states[docId], [command]: entry } },
      revision: { ...s.revision, [docId]: (s.revision[docId] ?? 0) + 1 },
    };
  });
}

export function setCommandStates(docId: string, list: readonly CommandState[]): void {
  if (list.length === 0) return;
  useCommands.setState((s) => {
    const next = { ...s.states[docId] };
    for (const st of list) next[st.command] = { enabled: st.enabled, value: st.value };
    return { states: { ...s.states, [docId]: next }, revision: { ...s.revision, [docId]: (s.revision[docId] ?? 0) + 1 } };
  });
}

export function setContext(docId: string, context: string): void {
  useCommands.setState((s) => (s.contexts[docId] === context ? {} : { contexts: { ...s.contexts, [docId]: context } }));
}

export function clearDocumentCommands(docId: string): void {
  useCommands.setState((s) => {
    const states = { ...s.states };
    const contexts = { ...s.contexts };
    const revision = { ...s.revision };
    delete states[docId];
    delete contexts[docId];
    delete revision[docId];
    return { states, contexts, revision };
  });
}

export function getCommandState(docId: string, command: string): CommandStateEntry | undefined {
  return useCommands.getState().states[docId]?.[command];
}

export function useCommandState(docId: string | null, command: string | undefined): CommandStateEntry | undefined {
  return useCommands((s) => (docId && command ? s.states[docId]?.[command] : undefined));
}

export function useDocContext(docId: string | null): string | undefined {
  return useCommands((s) => (docId ? s.contexts[docId] : undefined));
}

function sameValue(a: UnoPlain, b: UnoPlain): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
