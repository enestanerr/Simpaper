/**
 * PDF documents in the main process: the flush protocol with the renderer (pdf.js keeps form/annotation edits
 * until its debounced pdf:update; `flushRequest` → `documents:flushDone`) before saves, extracts, closes and the
 * quit, and the save guards the office saves have (target open in another tab, file changed on disk).
 * Real DocumentService + PdfService on the harness fakes; the "renderer" is the harness' flush responder.
 */
import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import type { Prompt } from '@shared/api/documents';
import { QuitController } from '../../../src/main/app/quit';
import type { DocumentServiceDeps } from '../../../src/main/documents/service';
import { createPdfService, type PdfService } from '../../../src/main/pdf';
import { memoryLogger } from '../platform/helpers';
import { silentLog } from './helpers/fakes';
import { createHarness, type Harness } from './helpers/harness';

let h: Harness | null = null;

afterEach(async () => {
  if (h) await h.dispose();
  h = null;
});

async function pdfWithPages(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([200, 200]);
  return doc.save();
}

async function pagesOf(path: string): Promise<number> {
  return (await PDFDocument.load(await readFile(path))).getPageCount();
}

interface Setup {
  h: Harness;
  pdf: PdfService;
  /** Answers of the PDF save dialog (null = cancelled). */
  saveAs: Array<string | null>;
  open(name: string, pages: number): Promise<{ docId: string; path: string }>;
}

async function setup(deps: Partial<DocumentServiceDeps> = {}): Promise<Setup> {
  const hh = await createHarness({}, deps);
  h = hh;
  const saveAs: Array<string | null> = [];
  const pdf = createPdfService({
    registry: hh.service,
    safeWrite: async (target, write) => {
      // A plain writer is enough here (the safe-save pipeline has its own tests).
      await write(`${target}.tmp`);
      await writeFile(target, await readFile(`${target}.tmp`));
    },
    log: silentLog,
    fontFiles: () => [],
    dialogs: { saveAs: async () => saveAs.shift() ?? null, openPdfs: async () => [] },
  });
  hh.service.setPdfService(pdf);
  await mkdir(hh.docsDir, { recursive: true });
  return {
    h: hh,
    pdf,
    saveAs,
    async open(name, pages) {
      const path = join(hh.docsDir, name);
      await writeFile(path, await pdfWithPages(pages));
      return { docId: (await hh.service.open(path)).docId, path };
    },
  };
}

describe('PDF flush protocol (main side)', () => {
  it('a save first asks the renderer to push its pending edits, then writes them', async () => {
    const s = await setup();
    const doc = await s.open('Form.pdf', 1);
    const order: string[] = [];
    // The renderer holds an edit in pdf.js: on the flush request it pushes the bytes, then confirms.
    s.h.onFlush((request, done) => {
      order.push(`flush:${request.docId}`);
      void (async () => {
        await s.pdf.update(request.docId, await pdfWithPages(3));
        order.push('pushed');
        done();
      })();
    });
    const result = await s.h.service.save(doc.docId);
    expect(result).toEqual({ outcome: 'saved', path: doc.path, format: 'pdf' });
    expect(order).toEqual([`flush:${doc.docId}`, 'pushed']);
    expect(await pagesOf(doc.path)).toBe(3);
    expect(s.h.service.get(doc.docId)?.descriptor.modified).toBe(false);
  });

  it('a renderer that does not answer delays a save by the timeout only, with a warning', async () => {
    const log = memoryLogger();
    const s = await setup({ flushTimeoutMs: 40, log });
    const doc = await s.open('Sessiz.pdf', 2);
    s.h.onFlush(() => undefined);
    const started = Date.now();
    expect((await s.pdf.save(doc.docId, false, null)).outcome).toBe('saved');
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect(log.entries.some((e) => e.level === 'warn' && /flush/.test(e.message))).toBe(true);
    // A late answer is ignored.
    const late = s.h.eventsOf('flushRequest')[0];
    s.h.service.flushDone(late?.requestId ?? '');
  });

  it('extracting pages includes edits the renderer pushes on the flush request', async () => {
    const s = await setup();
    const doc = await s.open('Kaynak.pdf', 2);
    const edited = await pdfWithPages(5);
    s.h.onFlush((request, done) => void s.pdf.update(request.docId, edited).then(done));
    const target = join(s.h.docsDir, 'secim.pdf');
    s.saveAs.push(target);
    expect(await s.pdf.extract(doc.docId, [4], null)).toEqual({ outcome: 'savedCopy', path: target, format: 'pdf' });
    expect(await pagesOf(target)).toBe(1);
  });

  it('closing a PDF counts the edit the renderer had not pushed yet: the unsaved-changes prompt appears', async () => {
    const s = await setup();
    const doc = await s.open('Kapat.pdf', 1);
    expect(s.h.service.get(doc.docId)?.descriptor.modified).toBe(false);
    // First edit after load: pdf:markModified arrives with the flush (as the renderer sends it).
    s.h.onFlush((request, done) => {
      s.pdf.markModified(request.docId);
      done();
    });
    s.h.answer((p) => (p.kind === 'unsavedChanges' ? { kind: 'unsavedChanges', choice: 'cancel' } : undefined));
    expect(await s.h.service.close(doc.docId)).toBe('cancelled');
    expect(s.h.prompts.map((p) => p.kind)).toEqual(['unsavedChanges']);
    expect(s.h.service.get(doc.docId)).toBeDefined();
    // Forced closes (quit after the prompts, crashed windows) do not wait for the renderer.
    s.h.onFlush(() => undefined);
    expect(await s.h.service.close(doc.docId, true)).toBe('closed');
  });

  it('a pending flush ends when the window closes or the renderer reloads (nobody is left to answer)', async () => {
    const s = await setup({ flushTimeoutMs: 60_000 });
    const doc = await s.open('Pencere.pdf', 1);
    s.h.onFlush(() => undefined);
    const first = s.h.service.requestFlush(doc.docId);
    s.h.service.resendPrompts(); // did-finish-load after a renderer reload
    await first;
    const second = s.h.service.requestFlush(doc.docId);
    s.h.service.cancelPrompts(); // the window was closed
    await second;
    expect(s.h.eventsOf('flushRequest')).toHaveLength(2);
  });

  it('closing does not hang on a renderer that never answers', async () => {
    const s = await setup({ flushTimeoutMs: 30 });
    const doc = await s.open('Asili.pdf', 1);
    s.h.onFlush(() => undefined);
    expect(await s.h.service.close(doc.docId)).toBe('closed');
    expect(s.h.prompts).toEqual([]);
  });

  it('the quit flushes every PDF before it lists the modified documents', async () => {
    const s = await setup();
    const a = await s.open('A.pdf', 1);
    const b = await s.open('B.pdf', 1);
    s.h.onFlush((request, done) => {
      if (request.docId === b.docId) s.pdf.markModified(request.docId);
      done();
    });
    const asked: string[] = [];
    const quit = new QuitController({
      documents: {
        flushPending: () => s.h.service.flushPdfEdits(),
        modifiedDocuments: () => s.h.service.modifiedDocuments(),
        activate: (id) => s.h.service.activate(id),
        prompt: async (p) => {
          asked.push(p.docId);
          return { kind: 'unsavedChanges', choice: 'cancel' };
        },
        save: (id) => s.h.service.save(id),
        closeAll: () => s.h.service.closeAll(),
        emit: (e) => s.h.service.emit(e),
      },
      recovery: { markCleanShutdown: async () => undefined },
      disposeServices: async () => undefined,
      exit: () => undefined,
      log: silentLog,
    });
    expect(await quit.requestQuit()).toBe(false);
    expect(asked).toEqual([b.docId]);
    expect(s.h.eventsOf('flushRequest').map((e) => e.docId).sort()).toEqual([a.docId, b.docId].sort());
  });

  it('pdf:markModified marks the document modified once (updated event), office documents never get a flush request', async () => {
    const s = await setup();
    const doc = await s.open('M.pdf', 1);
    const before = s.h.eventsOf('updated').length;
    s.pdf.markModified(doc.docId);
    s.pdf.markModified(doc.docId);
    expect(s.h.service.get(doc.docId)?.descriptor.modified).toBe(true);
    expect(s.h.eventsOf('updated').slice(before).filter((e) => e.doc.docId === doc.docId && e.doc.modified)).not.toHaveLength(0);
    const count = s.h.eventsOf('updated').length;
    s.pdf.markModified(doc.docId);
    expect(s.h.eventsOf('updated')).toHaveLength(count);
    const office = await s.h.service.create('writer');
    await s.h.service.requestFlush(office.docId);
    expect(s.h.eventsOf('flushRequest').map((e) => e.docId)).not.toContain(office.docId);
  });
});

describe('PDF save guards', () => {
  it('refuses Save As onto a PDF that is open in another tab (both tabs would share one file)', async () => {
    const s = await setup();
    const a = await s.open('A.pdf', 1);
    const b = await s.open('B.pdf', 3);
    const bBefore = await readFile(b.path);
    s.saveAs.push(b.path);
    expect(await s.pdf.save(a.docId, true, null)).toEqual({ outcome: 'failed', errorKey: 'errors.save.targetOpen' });
    expect((await readFile(b.path)).equals(bBefore)).toBe(true);
    expect(s.h.service.get(a.docId)?.descriptor.path).toBe(a.path);
    // Extracting pages into it is refused too.
    s.saveAs.push(b.path);
    expect(await s.pdf.extract(a.docId, [0], null)).toEqual({ outcome: 'failed', errorKey: 'errors.save.targetOpen' });
    expect((await readFile(b.path)).equals(bBefore)).toBe(true);
  });

  it('asks before overwriting a PDF that changed on disk since it was opened; the stamp follows each save', async () => {
    const s = await setup();
    const doc = await s.open('Sozlesme.pdf', 1);
    s.pdf.markModified(doc.docId);
    // A sync client brings a newer 4-page version.
    const newer = await pdfWithPages(4);
    await writeFile(doc.path, newer);
    const later = new Date(Date.now() + 5_000);
    await utimes(doc.path, later, later);
    const prompts = () => s.h.prompts.filter((p): p is Extract<Prompt, { kind: 'overwriteNewer' }> => p.kind === 'overwriteNewer');

    s.h.answer((p) => (p.kind === 'overwriteNewer' ? { kind: 'overwriteNewer', choice: 'cancel' } : undefined));
    expect(await s.pdf.save(doc.docId, false, null)).toEqual({ outcome: 'cancelled' });
    expect(prompts()).toMatchObject([{ docId: doc.docId, fileName: 'Sozlesme.pdf' }]);
    expect(await pagesOf(doc.path)).toBe(4);

    // "Save a copy": the newer file stays, the document stays bound to it and modified.
    const copy = join(s.h.docsDir, 'Sozlesme (2).pdf');
    s.saveAs.push(copy);
    s.h.answer((p) => (p.kind === 'overwriteNewer' ? { kind: 'overwriteNewer', choice: 'saveCopy' } : undefined));
    expect(await s.pdf.save(doc.docId, false, null)).toEqual({ outcome: 'savedCopy', path: copy, format: 'pdf' });
    expect(await pagesOf(copy)).toBe(1);
    expect(await pagesOf(doc.path)).toBe(4);
    expect(s.h.service.get(doc.docId)?.descriptor).toMatchObject({ path: doc.path, modified: true });

    s.h.answer((p) => (p.kind === 'overwriteNewer' ? { kind: 'overwriteNewer', choice: 'overwrite' } : undefined));
    expect((await s.pdf.save(doc.docId, false, null)).outcome).toBe('saved');
    expect(await pagesOf(doc.path)).toBe(1);
    expect(prompts()).toHaveLength(3);
    // The stamp of the written file is recorded: the next save does not ask again.
    const st = await stat(doc.path);
    expect(s.h.service.diskStampOf(doc.docId)).toEqual({ mtimeMs: st.mtimeMs, size: st.size });
    s.pdf.markModified(doc.docId);
    expect((await s.pdf.save(doc.docId, false, null)).outcome).toBe('saved');
    expect(prompts()).toHaveLength(3);
  });

  it('records the stamp of a new file after Save As', async () => {
    const s = await setup();
    const doc = await s.open('Ilk.pdf', 1);
    const target = join(s.h.docsDir, 'Yeni.pdf');
    s.saveAs.push(target);
    expect(await s.pdf.save(doc.docId, true, null)).toEqual({ outcome: 'saved', path: target, format: 'pdf' });
    const st = await stat(target);
    expect(s.h.service.diskStampOf(doc.docId)).toEqual({ mtimeMs: st.mtimeMs, size: st.size });
  });
});
