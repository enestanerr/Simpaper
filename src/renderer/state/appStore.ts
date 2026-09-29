/** Application-wide renderer state: settings, open documents, backstage, messages and prompts. */
import { create } from 'zustand';
import { DEFAULT_SETTINGS, type AppInfo, type Settings, type WindowState } from '@shared/api/app';
import type { DocumentDescriptor, Prompt, RecentFile } from '@shared/api/documents';
import type { RecoveryEntry } from '@shared/api/recovery';
import type { ModuleKind } from '@shared/modules';

export type BackstagePage =
  | 'info'
  | 'new'
  | 'open'
  | 'saveAs'
  | 'exportPdf'
  | 'print'
  | 'recover'
  | 'options'
  | 'about';

export type MessageKind = 'error' | 'warning' | 'info' | 'success';

export interface MessageBarItem {
  id: string;
  kind: MessageKind;
  /** Document the message belongs to; null = global. */
  docId: string | null;
  /** i18n key (renderer or main-process namespace). */
  key: string;
  /** Interpolation values for the key. */
  values?: Record<string, string | number>;
  /** Extra technical detail (error code, file name); never document content. */
  detail?: string;
  /** Optional action button. */
  action?: { labelKey: string; run: () => void };
  /** Auto-dismiss after this many ms. */
  timeoutMs?: number;
}

export interface BusyState {
  busy: boolean;
  reason?: 'dialog' | 'saving' | 'loading';
}

export interface AppState {
  ready: boolean;
  settings: Settings;
  appInfo: AppInfo | null;
  windowState: WindowState | null;
  /** Open documents in tab order. */
  documents: DocumentDescriptor[];
  activeDocId: string | null;
  recent: RecentFile[];
  recovery: RecoveryEntry[];
  backstage: { open: boolean; page: BackstagePage };
  /** Selected ribbon tab per module. */
  ribbonTab: Partial<Record<ModuleKind, string>>;
  /** Ribbon temporarily shown while collapsed (tab clicked). */
  ribbonPeek: boolean;
  messages: MessageBarItem[];
  prompts: Prompt[];
  busy: Record<string, BusyState>;
  globalBusy: BusyState;
  /** Calc formula bar visibility (renderer-only view option). */
  formulaBarVisible: boolean;
}

export const initialAppState: AppState = {
  ready: false,
  settings: DEFAULT_SETTINGS,
  appInfo: null,
  windowState: null,
  documents: [],
  activeDocId: null,
  recent: [],
  recovery: [],
  backstage: { open: false, page: 'new' },
  ribbonTab: {},
  ribbonPeek: false,
  messages: [],
  prompts: [],
  busy: {},
  globalBusy: { busy: false },
  formulaBarVisible: true,
};

export const useApp = create<AppState>()(() => ({ ...initialAppState }));

/** Resets the store (tests). */
export function resetAppStore(patch: Partial<AppState> = {}): void {
  useApp.setState({ ...initialAppState, ...patch }, true);
}

export function selectActiveDocument(s: AppState): DocumentDescriptor | null {
  if (!s.activeDocId) return null;
  return s.documents.find((d) => d.docId === s.activeDocId) ?? null;
}

export function getActiveDocument(): DocumentDescriptor | null {
  return selectActiveDocument(useApp.getState());
}

export function getDocument(docId: string): DocumentDescriptor | undefined {
  return useApp.getState().documents.find((d) => d.docId === docId);
}

// ------------------------------------------------------------------ documents

export function upsertDocument(doc: DocumentDescriptor): void {
  useApp.setState((s) => {
    const i = s.documents.findIndex((d) => d.docId === doc.docId);
    if (i < 0) return { documents: [...s.documents, doc] };
    const documents = s.documents.slice();
    documents[i] = doc;
    return { documents };
  });
}

/** Removes a document and returns the id of the document that should become active (neighbour tab). */
export function removeDocument(docId: string): string | null {
  const s = useApp.getState();
  const i = s.documents.findIndex((d) => d.docId === docId);
  if (i < 0) return s.activeDocId;
  const documents = s.documents.filter((d) => d.docId !== docId);
  let activeDocId = s.activeDocId;
  if (activeDocId === docId) activeDocId = documents[Math.min(i, documents.length - 1)]?.docId ?? null;
  const busy = { ...s.busy };
  delete busy[docId];
  useApp.setState({
    documents,
    activeDocId,
    busy,
    messages: s.messages.filter((m) => m.docId !== docId),
    prompts: s.prompts.filter((p) => !('docId' in p) || p.docId !== docId),
  });
  return activeDocId;
}

export function setActiveDocId(docId: string | null): void {
  if (useApp.getState().activeDocId !== docId) useApp.setState({ activeDocId: docId, ribbonPeek: false });
}

/** Moves a tab (drag-free keyboard reordering: Ctrl+Shift+PageUp/PageDown). */
export function moveDocument(docId: string, delta: number): void {
  useApp.setState((s) => {
    const i = s.documents.findIndex((d) => d.docId === docId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= s.documents.length) return {};
    const documents = s.documents.slice();
    const [d] = documents.splice(i, 1);
    if (d) documents.splice(j, 0, d);
    return { documents };
  });
}

// ------------------------------------------------------------------ messages & prompts

let messageSeq = 0;

export function pushMessage(message: Omit<MessageBarItem, 'id'> & { id?: string }): string {
  const id = message.id ?? `m${++messageSeq}`;
  useApp.setState((s) => ({ messages: [...s.messages.filter((m) => m.id !== id), { ...message, id }] }));
  if (message.timeoutMs) setTimeout(() => dismissMessage(id), message.timeoutMs);
  return id;
}

export function dismissMessage(id: string): void {
  useApp.setState((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
}

export function enqueuePrompt(prompt: Prompt): void {
  useApp.setState((s) => (s.prompts.some((p) => p.id === prompt.id) ? {} : { prompts: [...s.prompts, prompt] }));
}

export function removePrompt(promptId: string): void {
  useApp.setState((s) => ({ prompts: s.prompts.filter((p) => p.id !== promptId) }));
}

// ------------------------------------------------------------------ backstage & ribbon

export function openBackstage(page: BackstagePage = 'info'): void {
  useApp.setState({ backstage: { open: true, page }, ribbonPeek: false });
}

export function setBackstagePage(page: BackstagePage): void {
  useApp.setState((s) => ({ backstage: { ...s.backstage, page } }));
}

export function closeBackstage(): void {
  useApp.setState((s) => (s.backstage.open ? { backstage: { ...s.backstage, open: false } } : {}));
}

export function setRibbonTab(kind: ModuleKind, tabId: string): void {
  useApp.setState((s) => ({ ribbonTab: { ...s.ribbonTab, [kind]: tabId } }));
}

export function setRibbonPeek(peek: boolean): void {
  if (useApp.getState().ribbonPeek !== peek) useApp.setState({ ribbonPeek: peek });
}

export function setBusy(docId: string | null, state: BusyState): void {
  if (docId === null) {
    useApp.setState({ globalBusy: state });
    return;
  }
  useApp.setState((s) => ({ busy: { ...s.busy, [docId]: state } }));
}
