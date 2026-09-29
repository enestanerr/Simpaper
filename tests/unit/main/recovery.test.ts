import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPC_ERROR } from '@shared/engine-protocol';
import { entryId, MANIFEST_SCHEMA, parseEntryId, validateManifest, type RecoveryManifest } from '../../../src/main/recovery/manifest';
import { CLEAN_MARKER } from '../../../src/main/recovery/service';
import { createHarness, waitFor, waitForAsync, type Harness } from './helpers/harness';
import { buildOoxml, tinyPdf } from './helpers/packages';

let h: Harness;

afterEach(async () => {
  vi.useRealTimers();
  if (h) await h.dispose();
});

async function setup() {
  h = await createHarness();
  await mkdir(h.docsDir, { recursive: true });
  await h.recovery.start();
  return h;
}

const sessionDir = () => join(h.dir, 'recovery', 'sess01');

async function openModified(name = 'Rapor.docx') {
  const src = join(h.docsDir, name);
  await writeFile(src, await buildOoxml('docx'));
  const doc = await h.service.open(src);
  h.engine.instance(doc.docId).emit({ type: 'modified', docId: doc.docId, modified: true });
  return { src, doc };
}

function manifest(patch: Partial<RecoveryManifest>): RecoveryManifest {
  return {
    schema: MANIFEST_SCHEMA,
    sessionId: 'old1',
    docId: 'dold',
    kind: 'writer',
    title: 'Eski.docx',
    originalPath: 'C:\\Belgeler\\Eski.docx',
    originalFormat: 'docx',
    originalStamp: { mtimeMs: 1, size: 2 },
    snapshotFile: 'dold.odt',
    snapshotAt: '2026-09-28T20:00:00.000Z',
    reason: 'unclean-shutdown',
    encrypted: false,
    ...patch,
  };
}

async function writePreviousSession(session: string, m: RecoveryManifest, marker = false) {
  const dir = join(h.dir, 'recovery', session);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${m.docId}.json`), JSON.stringify(m));
  await writeFile(join(dir, m.snapshotFile), m.snapshotFile.endsWith('.pdf') ? tinyPdf() : await buildOoxml('docx'));
  if (marker) await writeFile(join(dir, CLEAN_MARKER), 'x');
  return dir;
}

describe('RecoveryService', () => {
  it('snapshots only modified documents as ODF with an atomic manifest', async () => {
    await setup();
    const { src, doc } = await openModified();
    const clean = join(h.docsDir, 'Temiz.docx');
    await writeFile(clean, await buildOoxml('docx'));
    const untouched = await h.service.open(clean);
    await h.recovery.snapshotAll();

    const files = (await readdir(sessionDir())).sort();
    expect(files).toEqual([`${doc.docId}.json`, `${doc.docId}.odt`, 'session.json'].sort());
    expect(h.engine.instance(untouched.docId).callsOf('doc.store')).toHaveLength(0);
    const m = validateManifest(JSON.parse(await readFile(join(sessionDir(), `${doc.docId}.json`), 'utf8')));
    expect(m).toMatchObject({ docId: doc.docId, kind: 'writer', title: 'Rapor.docx', originalPath: src, originalFormat: 'docx', snapshotFile: `${doc.docId}.odt`, reason: 'unclean-shutdown', encrypted: false });
    expect(m?.originalStamp?.size).toBeGreaterThan(0);
  });

  it('stores the links of a snapshot absolute (baseUrl ""); saves keep LibreOffice\'s default base', async () => {
    await setup();
    const { doc } = await openModified();
    await h.recovery.snapshotAll();
    const inst = h.engine.instance(doc.docId);
    // The snapshot lives in the recovery folder but is loaded with the document's path as base URL later.
    expect(inst.callsOf('doc.store')[0]?.params).toMatchObject({ filter: 'writer8', baseUrl: '' });
    expect((await h.service.save(doc.docId)).outcome).toBe('saved');
    expect(inst.callsOf('doc.store')[1]?.params).not.toHaveProperty('baseUrl');
  });

  it('runs on the autosave interval from settings', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await setup();
    h.settings.autosaveMinutes = 1;
    h.recovery.applySettings();
    const { doc } = await openModified();
    const stores = () => h.engine.instance(doc.docId).callsOf('doc.store').length;
    vi.advanceTimersByTime(59_000);
    expect(stores()).toBe(0);
    vi.advanceTimersByTime(1_000);
    vi.useRealTimers();
    await waitFor(() => stores() === 1);
    h.settings.autosaveMinutes = 0;
    h.recovery.applySettings();
  });

  it('skips busy documents (open engine dialog)', async () => {
    await setup();
    const { doc } = await openModified();
    h.engine.instance(doc.docId).emit({ type: 'dialog', open: true });
    await h.recovery.snapshotAll();
    expect(h.engine.instance(doc.docId).callsOf('doc.store')).toHaveLength(0);
  });

  it('stores password-protected documents with their password', async () => {
    await setup();
    const src = join(h.docsDir, 'Gizli.docx');
    await writeFile(src, await buildOoxml('docx'));
    h.engine.behavior.password = 'pw';
    h.answer((p) => (p.kind === 'password' ? { kind: 'password', password: 'pw' } : undefined));
    const doc = await h.service.open(src);
    h.engine.instance(doc.docId).emit({ type: 'modified', docId: doc.docId, modified: true });
    await h.recovery.snapshotAll();
    expect(h.engine.instance(doc.docId).callsOf('doc.store')[0]?.params['password']).toBe('pw');
    const m = JSON.parse(await readFile(join(sessionDir(), `${doc.docId}.json`), 'utf8')) as RecoveryManifest;
    expect(m.encrypted).toBe(true);
  });

  it('snapshots modified PDFs by copying the working copy', async () => {
    await setup();
    const src = join(h.docsDir, 'Form.pdf');
    await writeFile(src, tinyPdf());
    const doc = await h.service.open(src);
    h.service.update(doc.docId, { modified: true });
    await h.recovery.snapshotAll();
    expect(Buffer.compare(await readFile(join(sessionDir(), `${doc.docId}.pdf`)), tinyPdf())).toBe(0);
  });

  it('removes the snapshot when the document is saved or closed', async () => {
    await setup();
    const { doc } = await openModified();
    await h.recovery.snapshotAll();
    await h.service.save(doc.docId);
    await waitForAsync(async () => (await readdir(sessionDir())).every((n) => !n.startsWith(doc.docId)));

    const second = await openModified('Iki.docx');
    await h.recovery.snapshotAll();
    h.answer((p) => (p.kind === 'unsavedChanges' ? { kind: 'unsavedChanges', choice: 'discard' } : undefined));
    await h.service.close(second.doc.docId);
    await waitForAsync(async () => (await readdir(sessionDir())).every((n) => !n.startsWith(second.doc.docId)));
  });

  it('clean shutdown writes the marker and removes the session folder', async () => {
    await setup();
    await h.recovery.markCleanShutdown();
    expect(await readdir(join(h.dir, 'recovery'))).toEqual([]);
  });

  it('lists earlier sessions without the clean marker; clean or empty sessions are removed', async () => {
    await setup();
    await writePreviousSession('old1', manifest({}));
    await writePreviousSession('old2', manifest({ sessionId: 'old2', docId: 'dclean', snapshotFile: 'dclean.odt' }), true);
    await mkdir(join(h.dir, 'recovery', 'old3'), { recursive: true });
    await writePreviousSession('old4', manifest({ sessionId: 'old4', docId: 'dpdf', kind: 'pdf', snapshotFile: 'dpdf.pdf', originalFormat: 'pdf', reason: 'engine-crash' }));
    await writeFile(join(h.dir, 'recovery', 'old4', 'broken.json'), '{"schema":1}');

    const entries = await h.recovery.scanPrevious();
    expect(entries.map((e) => e.id).sort()).toEqual([entryId('old1', 'dold'), entryId('old4', 'dpdf')].sort());
    expect(entries.find((e) => e.id === 'old4.dpdf')?.reason).toBe('engine-crash');
    expect(entries.find((e) => e.id === 'old1.dold')).toMatchObject({ kind: 'writer', title: 'Eski.docx', originalFormat: 'docx', reason: 'unclean-shutdown' });
    expect(entries[0]?.sizeBytes).toBeGreaterThan(0);
    expect((await readdir(join(h.dir, 'recovery'))).sort()).toEqual(['old1', 'old4', 'sess01']);
  });

  it('restores an entry as a new document tied to the original path, then forgets it', async () => {
    await setup();
    const original = join(h.docsDir, 'Eski.docx');
    await writeFile(original, await buildOoxml('docx'));
    await writePreviousSession('old1', manifest({ originalPath: original }));
    await h.recovery.scanPrevious();

    const doc = await h.recovery.restore('old1.dold');
    expect(doc).toMatchObject({ kind: 'writer', title: 'Eski.docx', path: original, format: 'docx', modified: true, recoveredAt: '2026-09-28T20:00:00.000Z', state: 'ready' });
    const load = h.engine.instance(doc.docId).callsOf('doc.load')[0]?.params ?? {};
    expect(load['filter']).toBe('writer8');
    expect(await h.recovery.list()).toEqual([]);
    expect((await readdir(join(h.dir, 'recovery'))).sort()).toEqual(['sess01']);
    // The restored content is protected by a fresh snapshot in the current session right away.
    expect(await readdir(sessionDir())).toEqual(expect.arrayContaining([`${doc.docId}.odt`, `${doc.docId}.json`]));
    await expect(h.recovery.restore('old1.dold')).rejects.toThrow('errors.recovery.notFound');
  });

  it('a restored DOCM asks before a save would drop its macros (the ODF snapshot has no VBA project)', async () => {
    await setup();
    const original = join(h.docsDir, 'Makro.docm');
    await writeFile(original, await buildOoxml('docm', { parts: { 'word/vbaProject.bin': new Uint8Array([1, 2]) } }));
    await writePreviousSession('old1', manifest({ title: 'Makro.docm', originalPath: original, originalFormat: 'docm' }));
    await h.recovery.scanPrevious();
    const doc = await h.recovery.restore('old1.dold');
    expect(doc).toMatchObject({ path: original, format: 'docm', modified: true });
    const before = await readFile(original);
    h.answer((p) => (p.kind === 'saveRisk' ? { kind: 'saveRisk', choice: 'cancel' } : undefined));
    expect(await h.service.save(doc.docId)).toEqual({ outcome: 'cancelled' });
    expect(h.prompts.filter((p) => p.kind === 'saveRisk').flatMap((p) => (p.kind === 'saveRisk' ? p.findings.map((f) => f.messageKey) : []))).toEqual(['compat.loss.macros']);
    expect((await readFile(original)).equals(before)).toBe(true);
  });

  it('a restore whose new engine ends right after loading fails cleanly and keeps the entry', async () => {
    await setup();
    const original = join(h.docsDir, 'Eski.docx');
    await writeFile(original, await buildOoxml('docx'));
    await writePreviousSession('old1', manifest({ originalPath: original }));
    await h.recovery.scanPrevious();
    h.engine.overrides = {
      'doc.setModified': () => {
        // soffice ends after it answered: no call is pending that could fail.
        h.engine.history.at(-1)?.crash();
        return { ok: true };
      },
    };
    await expect(h.recovery.restore('old1.dold')).rejects.toThrow('errors.recovery.restoreFailed');
    expect(h.service.descriptors()).toEqual([]);
    expect(h.engine.released).toHaveLength(1);
    expect((await h.recovery.list()).map((e) => e.id)).toEqual(['old1.dold']);

    // ENGINE_UNAVAILABLE from doc.setModified is an error, not ignored.
    h.engine.overrides = { 'doc.setModified': () => Promise.reject(Object.assign(new Error('gone'), { code: RPC_ERROR.ENGINE_UNAVAILABLE })) };
    await expect(h.recovery.restore('old1.dold')).rejects.toThrow('errors.engine.unavailable');
    expect(h.service.descriptors()).toEqual([]);
    expect((await h.recovery.list()).map((e) => e.id)).toEqual(['old1.dold']);
  });

  it('forgets a restored entry only once the restored document has a snapshot of its own', async () => {
    await setup();
    const original = join(h.docsDir, 'Eski.docx');
    await writeFile(original, await buildOoxml('docx'));
    const oldDir = await writePreviousSession('old1', manifest({ originalPath: original }));
    await h.recovery.scanPrevious();
    // The protective snapshot right after the restore fails (disk full): the entry stays.
    h.engine.behavior.storeError = Object.assign(new Error('There is not enough space on the disk'), { code: 'ENOSPC' });
    const doc = await h.recovery.restore('old1.dold');
    expect(doc.modified).toBe(true);
    expect(await readdir(oldDir)).toEqual(expect.arrayContaining(['dold.json', 'dold.odt']));
    // Hidden while its document is open: it cannot be restored a second time.
    expect(await h.recovery.list()).toEqual([]);
    await expect(h.recovery.restore('old1.dold')).rejects.toThrow('errors.recovery.notFound');
    // The next autosave works: the restored document is protected now, the old entry goes.
    h.engine.behavior.storeError = undefined;
    await h.recovery.snapshotAll();
    expect(await readdir(sessionDir())).toEqual(expect.arrayContaining([`${doc.docId}.odt`, `${doc.docId}.json`]));
    await waitForAsync(async () => !(await readdir(join(h.dir, 'recovery'))).includes('old1'));
    expect(await h.recovery.list()).toEqual([]);
  });

  it('a restored document that crashes before its first snapshot is restored again from the kept entry', async () => {
    await setup();
    const original = join(h.docsDir, 'Eski.docx');
    await writeFile(original, await buildOoxml('docx'));
    const oldDir = await writePreviousSession('old1', manifest({ originalPath: original }));
    await h.recovery.scanPrevious();
    h.engine.behavior.storeError = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    const doc = await h.recovery.restore('old1.dold');
    h.engine.instance(doc.docId).crash();
    await waitFor(() => h.engine.history.length === 2 && h.service.get(doc.docId)?.descriptor.state === 'ready');
    // Reloaded from the entry's snapshot (not from the original file, which lacks the recovered work).
    expect(String(h.engine.history[1]?.callsOf('doc.load')[0]?.params['url'])).toMatch(/recovered\.odt$/);
    expect(h.service.get(doc.docId)?.descriptor).toMatchObject({ modified: true, recoveredAt: '2026-09-28T20:00:00.000Z' });
    expect(await readdir(oldDir)).toEqual(expect.arrayContaining(['dold.json', 'dold.odt']));
  });

  it('forgets the kept entry when the user closes the restored document', async () => {
    await setup();
    const oldDir = await writePreviousSession('old1', manifest({}));
    await h.recovery.scanPrevious();
    h.engine.behavior.storeError = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    const doc = await h.recovery.restore('old1.dold');
    expect(await readdir(oldDir)).toEqual(expect.arrayContaining(['dold.odt']));
    h.answer((p) => (p.kind === 'unsavedChanges' ? { kind: 'unsavedChanges', choice: 'discard' } : undefined));
    expect(await h.service.close(doc.docId)).toBe('closed');
    await waitForAsync(async () => !(await readdir(join(h.dir, 'recovery'))).includes('old1'));
    expect(await h.recovery.list()).toEqual([]);
  });

  it('discards entries', async () => {
    await setup();
    await writePreviousSession('old1', manifest({}));
    await h.recovery.scanPrevious();
    await h.recovery.discard('old1.dold');
    expect(await h.recovery.list()).toEqual([]);
    await expect(h.recovery.discard('../../etc')).rejects.toThrow('errors.recovery.notFound');
  });

  it('keeps crash snapshots of unrestored documents for recovery:list and the next start', async () => {
    await setup();
    const doc = await h.service.create('writer');
    h.engine.instance(doc.docId).emit({ type: 'modified', docId: doc.docId, modified: true });
    await h.recovery.snapshotAll();
    // Make restoring fail so the entry stays.
    h.engine.overrides = {
      'doc.load': () => {
        throw new Error('crashes again');
      },
    };
    h.engine.instance(doc.docId).crash();
    await waitFor(() => h.eventsOf('error').some((e) => e.errorKey === 'errors.engine.restoreFailed'));
    expect(h.service.get(doc.docId)?.descriptor.state).toBe('crashed');
    const entries = await h.recovery.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: `sess01.${doc.docId}`, reason: 'engine-crash' });
    h.answer((p) => (p.kind === 'closeStuck' ? { kind: 'closeStuck', choice: 'close' } : undefined));
    expect(await h.service.close(doc.docId)).toBe('closed');
    expect(h.prompts.map((p) => p.kind)).toEqual(['closeStuck']);
    // The prompt names the crash snapshot's time.
    expect(h.prompts[0]).toMatchObject({ snapshotAt: entries[0]?.snapshotAt });
    await new Promise((r) => setTimeout(r, 30));
    expect(await h.recovery.list()).toHaveLength(1);
    await h.recovery.markCleanShutdown();
    expect((await readdir(sessionDir())).some((n) => n === CLEAN_MARKER)).toBe(false);
  });

  it('parses entry ids strictly', () => {
    expect(parseEntryId('abc.d123')).toEqual({ sessionId: 'abc', docId: 'd123' });
    expect(parseEntryId('a.b.c')).toBeNull();
    expect(parseEntryId('../x.y')).toBeNull();
  });
});
