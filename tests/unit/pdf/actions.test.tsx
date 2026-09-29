/**
 * PDF module actions with a fake controller: what each ribbon action asks the controller or the store to do.
 * (.tsx: tests importing renderer modules stay out of tsconfig.node.json, whose composite project cannot include
 * src/renderer; they are type-checked with tests/unit/pdf/tsconfig.renderer-tests.json.)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocumentDescriptor } from '@shared/api/documents';
import type { PdfPageOp } from '@shared/api/pdf';
import { SHELL_ACTIONS } from '../../../src/renderer/ribbon/types';
import { PDF_ACTIONS, pdfActions, targetPages } from '../../../src/renderer/modules/pdf/actions';
import type { PdfController } from '../../../src/renderer/modules/pdf/controller/controller';
import { registerController, unregisterController } from '../../../src/renderer/modules/pdf/controller/registry';
import { docState, patchDoc, usePdfStore, type EditorTool } from '../../../src/renderer/modules/pdf/state/store';

const DOC = 'doc-1';
const descriptor = { docId: DOC, kind: 'pdf', title: 'a.pdf', path: null, format: 'pdf', readOnly: false, modified: false, compat: null, state: 'ready' } as DocumentDescriptor;

class FakeController {
  readonly docId = DOC;
  pdfDocument: object | null = {};
  calls: unknown[][] = [];
  comment: string | null = null;
  applyPageOps(ops: PdfPageOp[], selection?: number[]) {
    this.calls.push(['applyPageOps', ops, selection]);
    return Promise.resolve();
  }
  setEditorTool(tool: EditorTool) {
    this.calls.push(['setEditorTool', tool]);
    patchDoc(DOC, { editorTool: tool });
  }
  setAnnotationColor(hex: string) {
    this.calls.push(['setAnnotationColor', hex]);
  }
  selectedComment() {
    return this.comment;
  }
  goToPage(n: number) {
    this.calls.push(['goToPage', n]);
  }
  save(saveAs: boolean) {
    this.calls.push(['save', saveAs]);
    return Promise.resolve();
  }
  editingAction(name: string) {
    this.calls.push(['editingAction', name]);
  }
}

let fake: FakeController;
const run = (id: string, payload?: unknown) => pdfActions[id]!(descriptor, payload);

beforeEach(() => {
  fake = new FakeController();
  registerController(fake as unknown as PdfController);
  patchDoc(DOC, { status: 'ready', pageCount: 5, currentPage: 2, selection: [], notices: [], dialog: null, editorTool: 'none' });
});

afterEach(() => {
  unregisterController(fake as unknown as PdfController);
  usePdfStore.getState().remove(DOC);
});

describe('PDF actions', () => {
  it('act on the thumbnail selection, else on the current page', () => {
    expect(targetPages(DOC)).toEqual([1]);
    patchDoc(DOC, { selection: [3, 0] });
    expect(targetPages(DOC)).toEqual([0, 3]);
    void run(PDF_ACTIONS.rotatePagesCw);
    expect(fake.calls[0]).toEqual([
      'applyPageOps',
      [
        { op: 'rotate', pageIndex: 0, value: 90 },
        { op: 'rotate', pageIndex: 3, value: 90 },
      ],
      undefined,
    ]);
  });

  it('asks before deleting pages and refuses to delete every page', () => {
    patchDoc(DOC, { selection: [1, 2] });
    void run(PDF_ACTIONS.deletePages);
    expect(docState(DOC).dialog).toEqual({ kind: 'confirmDelete', pages: [1, 2] });
    patchDoc(DOC, { dialog: null, selection: [0, 1, 2, 3, 4] });
    void run(PDF_ACTIONS.deletePages);
    expect(docState(DOC).dialog).toBeNull();
    expect(docState(DOC).notices.map((n) => n.key)).toEqual(['pdf.errors.lastPage']);
  });

  it('inserts a blank page after the selection and selects it', () => {
    patchDoc(DOC, { selection: [3] });
    void run(PDF_ACTIONS.insertBlank);
    expect(fake.calls[0]).toEqual(['applyPageOps', [{ op: 'insertBlank', pageIndex: 4 }], [4]]);
  });

  it('moves pages and reports the document edges', () => {
    patchDoc(DOC, { selection: [0] });
    void run(PDF_ACTIONS.movePagesUp);
    expect(fake.calls).toEqual([]);
    expect(docState(DOC).notices.at(-1)?.key).toBe('pdf.notices.atStart');
    void run(PDF_ACTIONS.movePagesDown);
    expect(fake.calls[0]).toEqual(['applyPageOps', [{ op: 'move', pageIndex: 0, value: 1 }], undefined]);
  });

  it('toggles annotation tools and maps the default colour per tool', () => {
    void run(PDF_ACTIONS.tool, 'ink');
    void run(PDF_ACTIONS.tool, 'ink');
    expect(fake.calls).toEqual([
      ['setEditorTool', 'ink'],
      ['setEditorTool', 'none'],
    ]);
    patchDoc(DOC, { editorTool: 'highlight' });
    void run(PDF_ACTIONS.color, null);
    void run(PDF_ACTIONS.color, 0x00ff00);
    expect(fake.calls.slice(2)).toEqual([
      ['setAnnotationColor', '#FFFF98'],
      ['setAnnotationColor', '#00ff00'],
    ]);
  });

  it('opens the comment dialog only for a selected annotation', () => {
    void run(PDF_ACTIONS.comment);
    expect(docState(DOC).notices.at(-1)?.key).toBe('pdf.notices.selectAnnotationFirst');
    fake.comment = 'Merhaba';
    void run(PDF_ACTIONS.comment);
    expect(docState(DOC).dialog).toEqual({ kind: 'comment', initial: 'Merhaba' });
  });

  it('overrides the shell actions for PDFs and handles navigation input', () => {
    void run(SHELL_ACTIONS.saveAs);
    void run(SHELL_ACTIONS.undo);
    void run(PDF_ACTIONS.goToPage, '4');
    void run(PDF_ACTIONS.goToPage);
    expect(fake.calls).toEqual([
      ['save', true],
      ['editingAction', 'undo'],
      ['goToPage', 4],
    ]);
    expect(docState(DOC).dialog).toEqual({ kind: 'goToPage' });
    void run(SHELL_ACTIONS.find);
    expect(docState(DOC).findOpen).toBe(true);
    expect(docState(DOC).findFocus).toBeGreaterThan(0);
  });

  it('reports a document that is still opening and ignores unknown documents', () => {
    fake.pdfDocument = null;
    void run(PDF_ACTIONS.merge);
    expect(docState(DOC).notices.at(-1)?.key).toBe('pdf.notices.notReady');
    expect(() => pdfActions[PDF_ACTIONS.merge]!({ ...descriptor, docId: 'other' })).not.toThrow();
    expect(() => pdfActions[PDF_ACTIONS.merge]!(null)).not.toThrow();
  });
});
