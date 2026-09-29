/** Per-document UI state of the PDF module (read by the workspace, status bar and ribbon controls). */
import { create } from 'zustand';

export type EditorTool = 'none' | 'highlight' | 'freetext' | 'ink' | 'stamp';
export type ContentTool = 'none' | 'addText' | 'addImage';

export type PdfDialog =
  | { kind: 'password'; retry: boolean }
  | { kind: 'addText'; pageIndex: number; x: number; y: number }
  | { kind: 'comment'; initial: string }
  | { kind: 'confirmDelete'; pages: number[] }
  | { kind: 'extract'; initial: string }
  | { kind: 'goToPage' }
  | { kind: 'externalLink'; url: string };

export interface Notice {
  id: number;
  kind: 'error' | 'info';
  /** i18n key (full, e.g. `pdf.errors.encrypted`). */
  key: string;
  values?: Record<string, string | number>;
}

export interface FindStatus {
  /** pdf.js FindState: 0 found, 1 not found, 2 wrapped, 3 pending. */
  state: number;
  current: number;
  total: number;
}

export interface PdfDocState {
  status: 'loading' | 'ready' | 'error';
  /** Incremented whenever a new pdf.js document is loaded (reload after page operations). */
  version: number;
  pageCount: number;
  /** 1-based. */
  currentPage: number;
  scale: number;
  scaleValue: string;
  viewRotation: number;
  editorTool: EditorTool;
  contentTool: ContentTool;
  sidebarOpen: boolean;
  /** 0-based page indices selected in the thumbnails. */
  selection: number[];
  findOpen: boolean;
  /** Incremented to move the focus into the find bar (Ctrl+F while it is already open). */
  findFocus: number;
  find: FindStatus | null;
  /** Annotation editor state reported by pdf.js. */
  canUndo: boolean;
  canRedo: boolean;
  hasSelectedEditor: boolean;
  hasFormFields: boolean;
  /** pdf.js tints form fields; the Forms tab can turn that off. */
  highlightFields: boolean;
  scrollMode: 'vertical' | 'horizontal' | 'wrapped' | 'page';
  spreadMode: 'none' | 'odd' | 'even';
  encrypted: boolean;
  busy: { key: string; done?: number; total?: number } | null;
  dialog: PdfDialog | null;
  notices: Notice[];
  errorKey: string | null;
}

export const INITIAL_DOC_STATE: PdfDocState = {
  status: 'loading',
  version: 0,
  pageCount: 0,
  currentPage: 1,
  scale: 1,
  scaleValue: 'auto',
  viewRotation: 0,
  editorTool: 'none',
  contentTool: 'none',
  sidebarOpen: true,
  selection: [],
  findOpen: false,
  findFocus: 0,
  find: null,
  canUndo: false,
  canRedo: false,
  hasSelectedEditor: false,
  hasFormFields: false,
  highlightFields: true,
  scrollMode: 'vertical',
  spreadMode: 'none',
  encrypted: false,
  busy: null,
  dialog: null,
  notices: [],
  errorKey: null,
};

interface PdfStore {
  docs: Record<string, PdfDocState>;
  patch(docId: string, patch: Partial<PdfDocState> | ((s: PdfDocState) => Partial<PdfDocState>)): void;
  remove(docId: string): void;
}

export const usePdfStore = create<PdfStore>((set) => ({
  docs: {},
  patch: (docId, patch) =>
    set((store) => {
      const current = store.docs[docId] ?? INITIAL_DOC_STATE;
      const next = typeof patch === 'function' ? patch(current) : patch;
      return { docs: { ...store.docs, [docId]: { ...current, ...next } } };
    }),
  remove: (docId) =>
    set((store) => {
      if (!(docId in store.docs)) return store;
      const docs = { ...store.docs };
      delete docs[docId];
      return { docs };
    }),
}));

export function docState(docId: string): PdfDocState {
  return usePdfStore.getState().docs[docId] ?? INITIAL_DOC_STATE;
}

export function patchDoc(docId: string, patch: Partial<PdfDocState> | ((s: PdfDocState) => Partial<PdfDocState>)): void {
  usePdfStore.getState().patch(docId, patch);
}

/** Hook: one field (or derived value) of a document's state. */
export function usePdfDoc<T>(docId: string | null | undefined, select: (s: PdfDocState) => T): T {
  return usePdfStore((store) => select((docId && store.docs[docId]) || INITIAL_DOC_STATE));
}

let noticeId = 0;

export function pushNotice(docId: string, notice: Omit<Notice, 'id'>): void {
  const id = ++noticeId;
  patchDoc(docId, (s) => ({ notices: [...s.notices.filter((n) => n.key !== notice.key), { ...notice, id }].slice(-3) }));
}

export function dismissNotice(docId: string, id: number): void {
  patchDoc(docId, (s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
}

/** Opens the find bar (or focuses it again). */
export function openFind(docId: string): void {
  patchDoc(docId, (s) => ({ findOpen: true, findFocus: s.findFocus + 1 }));
}
