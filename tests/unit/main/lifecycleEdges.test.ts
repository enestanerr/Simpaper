import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startHangWatch } from '../../../src/main/documents/hangWatch';
import { PromptBroker } from '../../../src/main/documents/prompts';
import type { DocumentEvent, PromptAnswer } from '@shared/api/documents';
import { RPC_ERROR } from '@shared/engine-protocol';
import { createHarness, waitFor, waitForAsync, type Harness } from './helpers/harness';
import { buildOoxml, tinyPdf } from './helpers/packages';

let h: Harness | null = null;

afterEach(async () => {
  if (h) await h.dispose();
  h = null;
});

async function setup(): Promise<Harness> {
  h = await createHarness();
  await mkdir(h.docsDir, { recursive: true });
  return h;
}

describe('hang watch', () => {
  it('reports a hang after consecutive failed probes and the recovery afterwards', async () => {
    let responding = true;
    const changes: string[] = [];
    const watch = startHangWatch({
      detector: { isResponding: async () => responding },
      targets: () => [{ docId: 'd1', hwnd: '42' }],
      onChange: (docId, ok) => changes.push(`${docId}:${ok}`),
      intervalMs: 60_000,
      strikes: 2,
    });
    try {
      await watch.tick();
      responding = false;
      await watch.tick();
      expect(changes).toEqual([]);
      await watch.tick();
      await watch.tick();
      expect(changes).toEqual(['d1:false']);
      responding = true;
      await watch.tick();
      expect(changes).toEqual(['d1:false', 'd1:true']);
    } finally {
      watch.stop();
    }
  });

  it('probes every visible view with its own strike count and uses the documented defaults', async () => {
    const hung = new Set<string>();
    const probes: Array<{ hwnd: string; timeoutMs: number }> = [];
    const changes: string[] = [];
    let targets = [
      { docId: 'a', hwnd: '1' },
      { docId: 'b', hwnd: '2' },
    ];
    const watch = startHangWatch({
      detector: {
        isResponding: async (hwnd, timeoutMs) => {
          probes.push({ hwnd, timeoutMs });
          return !hung.has(hwnd);
        },
      },
      targets: () => targets,
      onChange: (docId, ok) => changes.push(`${docId}:${ok}`),
    });
    try {
      hung.add('2');
      await watch.tick();
      expect(probes.map((p) => p.hwnd).sort()).toEqual(['1', '2']);
      expect(probes.every((p) => p.timeoutMs === 1_000)).toBe(true);
      expect(changes).toEqual([]);
      await watch.tick();
      expect(changes).toEqual(['b:false']);
      // A hidden view is not probed; its counters start over when it is shown again.
      hung.add('1');
      targets = [{ docId: 'b', hwnd: '2' }];
      await watch.tick();
      targets = [
        { docId: 'a', hwnd: '1' },
        { docId: 'b', hwnd: '2' },
      ];
      await watch.tick();
      expect(changes).toEqual(['b:false']);
      await watch.tick();
      expect(changes).toEqual(['b:false', 'a:false']);
      // A reloaded document (new window) starts over as well.
      hung.clear();
      targets = [{ docId: 'a', hwnd: '9' }];
      await watch.tick();
      expect(changes).toEqual(['b:false', 'a:false']);
    } finally {
      watch.stop();
    }
  });

  it('does not count a failing detector as a hang', async () => {
    const changes: string[] = [];
    const watch = startHangWatch({
      detector: { isResponding: async () => Promise.reject(new Error('binding gone')) },
      targets: () => [{ docId: 'd1', hwnd: '42' }],
      onChange: (docId, ok) => changes.push(`${docId}:${ok}`),
      intervalMs: 60_000,
    });
    try {
      for (let i = 0; i < 4; i++) await watch.tick();
      expect(changes).toEqual([]);
    } finally {
      watch.stop();
    }
  });

  it('marks the active document busy while its engine window hangs, and ready again afterwards', async () => {
    const hh = await setup();
    let responding = false;
    const doc = await hh.service.create('writer');
    const watch = hh.service.watchHangs({ isResponding: async () => responding }, { intervalMs: 60_000, strikes: 2 });
    try {
      await watch.tick();
      expect(hh.service.get(doc.docId)?.descriptor.state).toBe('ready');
      await watch.tick();
      expect(hh.service.get(doc.docId)?.descriptor.state).toBe('busy');
      expect(hh.eventsOf('error').map((e) => e.errorKey)).toEqual(['errors.engine.notResponding']);
      expect(hh.service.isBusy(doc.docId)).toBe(true);
      responding = true;
      await watch.tick();
      expect(hh.service.get(doc.docId)?.descriptor.state).toBe('ready');
      expect(hh.eventsOf('notice').map((e) => e.noticeKey)).toContain('errors.engine.responding');
    } finally {
      watch.stop();
    }
  });
});

describe('prompt broker', () => {
  it('cancels the prompts of a closed document, including password prompts that carry no docId', async () => {
    const sent: DocumentEvent[] = [];
    const broker = new PromptBroker((e) => sent.push(e));
    const pw = broker.ask({ kind: 'password', fileName: 'a.docx', retry: false }, 'd1');
    const risk = broker.ask({ kind: 'saveRisk', docId: 'd1', fileName: 'a.docx', format: 'docx', findings: [] });
    const other = broker.ask({ kind: 'unsavedChanges', docId: 'd2', fileName: 'b.docx' });
    broker.cancelFor('d1');
    expect(await pw).toEqual({ kind: 'password', password: null });
    expect(await risk).toEqual({ kind: 'saveRisk', choice: 'cancel' });
    expect(broker.size).toBe(1);
    const id = (sent[2] as Extract<DocumentEvent, { type: 'prompt' }>).prompt.id;
    const wrongKind: PromptAnswer = { kind: 'password', password: 'x' };
    expect(broker.answer(id, wrongKind)).toBe(false);
    expect(broker.answer(id, { kind: 'unsavedChanges', choice: 'discard' })).toBe(true);
    expect(await other).toEqual({ kind: 'unsavedChanges', choice: 'discard' });
    broker.resend();
    expect(sent).toHaveLength(3);
  });
});

describe('DocumentService edge cases', () => {
  it('closing a document while it waits for its password cancels the open', async () => {
    const hh = await setup();
    const src = join(hh.docsDir, 'Gizli.docx');
    await writeFile(src, await buildOoxml('docx'));
    hh.engine.behavior.password = 'x';
    const opening = hh.service.open(src);
    await waitFor(() => hh.prompts.length === 1);
    const docId = hh.eventsOf('opened')[0]?.doc.docId ?? '';
    expect(await hh.service.close(docId)).toBe('closed');
    await expect(opening).rejects.toThrow('errors.open.cancelled');
    expect(hh.service.descriptors()).toEqual([]);
    expect(hh.eventsOf('closed').map((e) => e.docId)).toEqual([docId]);
  });

  it('treats a frame that closes on its own like a crash and reloads the document', async () => {
    const hh = await setup();
    const src = join(hh.docsDir, 'Kendi.docx');
    await writeFile(src, await buildOoxml('docx'));
    const doc = await hh.service.open(src);
    hh.engine.instance(doc.docId).emit({ type: 'closed', docId: doc.docId });
    await waitFor(() => hh.engine.history.length === 2 && hh.service.get(doc.docId)?.descriptor.state === 'ready');
    expect(hh.service.get(doc.docId)).toBeDefined();
  });

  it('closing a hung, modified document says what is lost and keeps its recovery snapshot', async () => {
    const hh = await setup();
    await hh.recovery.start();
    const doc = await hh.service.create('writer');
    hh.engine.instance(doc.docId).emit({ type: 'modified', docId: doc.docId, modified: true });
    await hh.recovery.snapshotAll();
    hh.service.update(doc.docId, { state: 'busy' });
    hh.answer((p) => (p.kind === 'closeStuck' ? { kind: 'closeStuck', choice: 'close' } : undefined));
    expect(await hh.service.close(doc.docId)).toBe('closed');
    expect(hh.prompts).toHaveLength(1);
    expect(hh.prompts[0]).toMatchObject({ kind: 'closeStuck', docId: doc.docId });
    expect((hh.prompts[0] as { snapshotAt: string | null }).snapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await new Promise((r) => setTimeout(r, 30));
    const entries = await hh.recovery.list();
    expect(entries.map((e) => e.reason)).toEqual(['engine-crash']);
    const files = await readdir(join(hh.dir, 'recovery', 'sess01'));
    expect(files).toContain(`${doc.docId}.odt`);
  });

  it('cancelling the close of a hung, modified document keeps it open', async () => {
    const hh = await setup();
    await hh.recovery.start();
    const doc = await hh.service.create('writer');
    hh.engine.instance(doc.docId).emit({ type: 'modified', docId: doc.docId, modified: true });
    hh.service.update(doc.docId, { state: 'busy' });
    hh.answer((p) => (p.kind === 'closeStuck' ? { kind: 'closeStuck', choice: 'cancel' } : undefined));
    expect(await hh.service.close(doc.docId)).toBe('cancelled');
    expect(hh.prompts[0]).toMatchObject({ kind: 'closeStuck', snapshotAt: null });
    expect(hh.service.get(doc.docId)?.descriptor.state).toBe('busy');
  });

  it('mirrors PDF saves done by the PDF service (recent files, recovery cleanup)', async () => {
    const hh = await setup();
    await hh.recovery.start();
    const src = join(hh.docsDir, 'A.pdf');
    await writeFile(src, tinyPdf());
    const doc = await hh.service.open(src);
    hh.service.update(doc.docId, { modified: true });
    await hh.recovery.snapshotAll();
    expect(await readdir(join(hh.dir, 'recovery', 'sess01'))).toContain(`${doc.docId}.pdf`);
    const copy = join(hh.docsDir, 'B.pdf');
    hh.service.update(doc.docId, { modified: false, path: copy, title: 'B.pdf' });
    await waitForAsync(async () => !(await readdir(join(hh.dir, 'recovery', 'sess01'))).includes(`${doc.docId}.pdf`));
    await waitForAsync(async () => (await hh.recent.list()).length === 2);
    expect((await hh.recent.list()).map((r) => r.path)).toEqual([copy, src]);
  });
});

describe('DocumentService crash races', () => {
  it('an engine crash during the initial load fails the open without a restore attempt', async () => {
    const hh = await setup();
    const src = join(hh.docsDir, 'Kirik.docx');
    await writeFile(src, await buildOoxml('docx'));
    hh.engine.overrides = {
      'doc.load': () => {
        hh.engine.history.at(-1)?.crash();
        throw Object.assign(new Error('bridge gone'), { code: 1001 });
      },
    };
    await expect(hh.service.open(src)).rejects.toThrow('errors.engine.unavailable');
    await new Promise((r) => setTimeout(r, 30));
    expect(hh.engine.history).toHaveLength(1);
    expect(hh.service.descriptors()).toEqual([]);
    expect(hh.eventsOf('error').map((e) => e.errorKey)).not.toContain('errors.engine.crashed');
  });

  it('an engine that ends right after a restore loaded into it is not left "ready": the crash path runs again', async () => {
    const hh = await setup();
    const src = join(hh.docsDir, 'Kirilgan.docx');
    await writeFile(src, await buildOoxml('docx'));
    const doc = await hh.service.open(src);
    const first = hh.engine.instance(doc.docId);
    first.emit({ type: 'modified', docId: doc.docId, modified: true });
    await hh.recovery.start();
    await hh.recovery.snapshotAll();
    // The restored instance dies while the restore marks the document modified (after doc.load succeeded).
    let calls = 0;
    hh.engine.overrides = {
      'doc.setModified': () => {
        if (calls++ > 0) return { ok: true };
        hh.engine.instance(doc.docId).crash();
        throw Object.assign(new Error('engine unavailable'), { code: RPC_ERROR.ENGINE_UNAVAILABLE });
      },
    };
    first.crash();
    await waitFor(() => hh.engine.history.length === 3 && hh.service.get(doc.docId)?.descriptor.state === 'ready');
    expect(hh.service.instanceOf(doc.docId)).toBe(hh.engine.history[2]);
    expect(hh.eventsOf('error').filter((e) => e.errorKey === 'errors.engine.crashed')).toHaveLength(2);
    expect(hh.service.get(doc.docId)?.descriptor).toMatchObject({ state: 'ready', modified: true });
  });

  it('a restore whose engine ends without a failing call is caught before the document becomes ready', async () => {
    const hh = await setup();
    const src = join(hh.docsDir, 'Sessiz.docx');
    await writeFile(src, await buildOoxml('docx'));
    const doc = await hh.service.open(src);
    const first = hh.engine.instance(doc.docId);
    first.emit({ type: 'modified', docId: doc.docId, modified: true });
    await hh.recovery.start();
    await hh.recovery.snapshotAll();
    let calls = 0;
    hh.engine.overrides = {
      'doc.setModified': () => {
        // Dies after answering (no pending call left to fail): only its state tells.
        if (calls++ === 0) queueMicrotask(() => hh.engine.instance(doc.docId).crash());
        return { ok: true };
      },
    };
    first.crash();
    await waitFor(() => hh.engine.history.length === 3 && hh.service.get(doc.docId)?.descriptor.state === 'ready');
    expect(hh.service.instanceOf(doc.docId)).toBe(hh.engine.history[2]);
  });

  it('closing a document while it is being restored after a crash releases the new instance', async () => {
    const hh = await setup();
    const src = join(hh.docsDir, 'Yarim.docx');
    await writeFile(src, await buildOoxml('docx'));
    const doc = await hh.service.open(src);
    let rejectLoad: ((e: Error) => void) | null = null;
    hh.engine.overrides = {
      'doc.load': () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
    };
    hh.engine.instance(doc.docId).crash();
    await waitFor(() => hh.service.get(doc.docId)?.descriptor.state === 'loading' && rejectLoad !== null);
    expect(await hh.service.close(doc.docId)).toBe('closed');
    (rejectLoad as unknown as (e: Error) => void)(new Error('aborted'));
    // `closed` is emitted after the instance is released and the working copy removed.
    await waitFor(() => hh.eventsOf('closed').length === 1);
    expect(hh.service.get(doc.docId)).toBeUndefined();
    expect(hh.engine.released.filter((id) => id === doc.docId)).toHaveLength(2);
    expect(hh.eventsOf('closed').map((e) => e.docId)).toEqual([doc.docId]);
  });
});
