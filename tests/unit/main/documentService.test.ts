import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Prompt } from '@shared/api/documents';
import { RPC_ERROR } from '@shared/engine-protocol';
import { rpcError } from './helpers/fakes';
import { createHarness, waitFor, type Harness } from './helpers/harness';
import { buildOoxml, tinyPdf } from './helpers/packages';

let h: Harness;

afterEach(async () => {
  if (h) await h.dispose();
});

async function setup(): Promise<Harness> {
  h = await createHarness();
  await mkdir(h.docsDir, { recursive: true });
  return h;
}

async function writeDoc(name: string, bytes: Buffer): Promise<string> {
  const p = join(h.docsDir, name);
  await writeFile(p, bytes);
  return p;
}

type RiskPrompt = Extract<Prompt, { kind: 'saveRisk' }>;

describe('DocumentService — open / edit / save', () => {
  it('opens a DOCX on a working copy in its own engine instance and attaches the view', async () => {
    await setup();
    const src = await writeDoc('Rapor.docx', await buildOoxml('docx'));
    const doc = await h.service.open(src);
    expect(doc).toMatchObject({ kind: 'writer', title: 'Rapor.docx', path: src, format: 'docx', state: 'ready', modified: false, readOnly: false });
    const inst = h.engine.instance(doc.docId);
    const load = inst.callsOf('doc.load')[0]?.params ?? {};
    expect(load['baseUrl']).toBe(pathToFileURL(src).href);
    expect(String(load['url'])).toContain('/work/sess01/');
    expect(load['view']).toEqual({ mode: 'child', parentHwnd: '100' }); // default view mode (ADR 0003 amendment)
    expect(h.view.log).toContain(`attach:${doc.docId}:4242`);
    expect(h.eventsOf('opened')).toHaveLength(1);
    expect((await h.recent.list()).map((r) => r.path)).toEqual([src]);
    // Opening the same file again activates the existing document.
    expect((await h.service.open(src)).docId).toBe(doc.docId);
    expect(h.engine.history).toHaveLength(1);
  });

  it('open → edit → save → risk prompt → "save a copy": the original stays untouched', async () => {
    await setup();
    const src = await writeDoc('Rapor.docx', await buildOoxml('docx', { parts: { 'word/diagrams/data1.xml': '<dgm/>' } }));
    const original = await readFile(src);
    const doc = await h.service.open(src);
    expect(doc.compat?.findings.map((f) => f.id)).toEqual(['smartArt']);
    const inst = h.engine.instance(doc.docId);

    inst.emit({ type: 'modified', docId: doc.docId, modified: true });
    expect(h.service.get(doc.docId)?.descriptor.modified).toBe(true);

    const copyPath = join(h.docsDir, 'Rapor (kopya).docx');
    h.dialogs.saveAnswers = [copyPath];
    h.answer((p) => (p.kind === 'saveRisk' ? { kind: 'saveRisk', choice: 'saveCopy' } : undefined));
    const result = await h.service.save(doc.docId);

    expect(result).toEqual({ outcome: 'savedCopy', path: copyPath, format: 'docx' });
    const prompt = h.prompts[0] as RiskPrompt;
    expect(prompt).toMatchObject({ kind: 'saveRisk', docId: doc.docId, fileName: 'Rapor.docx', format: 'docx' });
    expect(prompt.findings.map((f) => f.messageKey)).toEqual(['compat.finding.smartArt']);
    expect(h.dialogs.saveRequests[0]?.defaultPath).toBe(copyPath);
    expect(Buffer.compare(await readFile(src), original)).toBe(0);
    expect((await readFile(copyPath)).subarray(0, 2).toString()).toBe('PK');
    const store = inst.callsOf('doc.store')[0]?.params ?? {};
    expect(store['filter']).toBe('MS Word 2007 XML');
    expect(String(store['url'])).toMatch(/\/\.%7Esimpaper-[0-9a-f]{12}-Rapor%20\(kopya\)\.docx\.tmp$/);
    expect(h.service.get(doc.docId)?.descriptor).toMatchObject({ path: copyPath, title: 'Rapor (kopya).docx', modified: false });
    // The engine clears its modified flag in the store job (markSaved); nothing forces it afterwards.
    expect(store['markSaved']).toBe(true);
    expect(inst.callsOf('doc.setModified')).toEqual([]);
    expect(inst.modifiedFlag).toBe(false);
    expect((await readdir(h.docsDir)).sort()).toEqual(['Rapor (kopya).docx', 'Rapor.docx']);

    // The accepted target is not asked about again.
    inst.emit({ type: 'modified', docId: doc.docId, modified: true });
    expect((await h.service.save(doc.docId)).outcome).toBe('saved');
    expect(h.prompts).toHaveLength(1);
  });

  it('"save anyway" overwrites the original once accepted; "cancel" leaves everything as is', async () => {
    await setup();
    const src = await writeDoc('Tablo.xlsx', await buildOoxml('xlsx', { parts: { 'xl/slicers/slicer1.xml': '<s/>' } }));
    h.engine.nextKind = 'calc';
    const original = await readFile(src);
    const doc = await h.service.open(src);

    h.answer((p) => (p.kind === 'saveRisk' ? { kind: 'saveRisk', choice: 'cancel' } : undefined));
    expect(await h.service.save(doc.docId)).toEqual({ outcome: 'cancelled' });
    expect(Buffer.compare(await readFile(src), original)).toBe(0);

    h.answer((p) => (p.kind === 'saveRisk' ? { kind: 'saveRisk', choice: 'saveAnyway' } : undefined));
    expect(await h.service.save(doc.docId)).toEqual({ outcome: 'saved', path: src, format: 'xlsx' });
    expect(Buffer.compare(await readFile(src), original)).not.toBe(0);
    expect((h.prompts[1] as RiskPrompt).findings[0]).toMatchObject({ id: 'slicers', severity: 'risk' });
    await h.service.save(doc.docId);
    expect(h.prompts).toHaveLength(2);
  });

  it('"save as ODF" writes an ODF file chosen in the dialog', async () => {
    await setup();
    const src = await writeDoc('Sunu.pptx', await buildOoxml('pptx', { parts: { 'ppt/slides/slide1.xml': '<p:sld><p159:morph/></p:sld>' } }));
    h.engine.nextKind = 'impress';
    const doc = await h.service.open(src);
    const odp = join(h.docsDir, 'Sunu.odp');
    h.dialogs.saveAnswers = [odp];
    h.answer((p) => (p.kind === 'saveRisk' ? { kind: 'saveRisk', choice: 'saveOdf' } : undefined));
    expect(await h.service.save(doc.docId)).toEqual({ outcome: 'saved', path: odp, format: 'odp' });
    expect(h.dialogs.saveRequests[0]).toMatchObject({ defaultPath: odp, format: 'odp', kind: 'impress' });
    expect(h.engine.instance(doc.docId).callsOf('doc.store')[0]?.params['filter']).toBe('impress8');
  });

  it('warns about macro loss when a DOCM is saved as DOCX', async () => {
    await setup();
    const src = await writeDoc('Makro.docm', await buildOoxml('docm', { parts: { 'word/vbaProject.bin': new Uint8Array([1, 2]) } }));
    const doc = await h.service.open(src);
    h.answer((p) => (p.kind === 'saveRisk' ? { kind: 'saveRisk', choice: 'cancel' } : undefined));
    const target = join(h.docsDir, 'Makro.docx');
    expect(await h.service.save(doc.docId, { format: 'docx', path: target })).toEqual({ outcome: 'cancelled' });
    expect((h.prompts[0] as RiskPrompt).findings.map((f) => f.messageKey)).toEqual(['compat.loss.macros']);
  });

  it('saves a new document through Save As with the default format and title', async () => {
    await setup();
    const doc = await h.service.create('writer');
    expect(doc).toMatchObject({ title: 'Belge 1', path: null, format: null, state: 'ready' });
    const target = join(h.docsDir, 'Belge 1.docx');
    h.dialogs.saveAnswers = [target];
    expect(await h.service.save(doc.docId)).toEqual({ outcome: 'saved', path: target, format: 'docx' });
    expect(h.dialogs.saveRequests[0]).toMatchObject({ defaultPath: target, format: 'docx', kind: 'writer' });
    expect(h.engine.instance(doc.docId).callsOf('doc.store')[0]?.params['filter']).toBe('MS Word 2007 XML');
    expect(h.service.get(doc.docId)?.descriptor).toMatchObject({ title: 'Belge 1.docx', path: target, format: 'docx' });

    expect((await h.service.create('calc')).title).toBe('Tablo 1');
    h.settings.language = 'en';
    expect((await h.service.create('impress')).title).toBe('Presentation 1');
    await expect(h.service.create('pdf')).rejects.toThrow('errors.create.pdfUnsupported');
  });

  it('cancelling the Save As dialog cancels the save', async () => {
    await setup();
    const doc = await h.service.create('calc');
    expect(await h.service.save(doc.docId)).toEqual({ outcome: 'cancelled' });
  });

  it('verifies by re-opening through the conversion instance and refuses to replace on failure', async () => {
    h = await createHarness({ verifyAfterSave: true });
    await mkdir(h.docsDir, { recursive: true });
    const src = await writeDoc('V.docx', await buildOoxml('docx'));
    const original = await readFile(src);
    const doc = await h.service.open(src);
    expect((await h.service.save(doc.docId)).outcome).toBe('saved');
    expect(h.engine.conversions).toHaveLength(1);
    expect(h.engine.conversions[0]?.['filter']).toBe('writer_pdf_Export');

    await writeFile(src, original);
    h.answer((p) => (p.kind === 'overwriteNewer' ? { kind: 'overwriteNewer', choice: 'overwrite' } : undefined));
    h.engine.convertError = new Error('load failed');
    const failed = await h.service.save(doc.docId);
    expect(failed).toMatchObject({ outcome: 'failed', errorKey: 'errors.save.verifyFailed' });
    expect(Buffer.compare(await readFile(src), original)).toBe(0);
    expect((await readdir(h.docsDir)).filter((n) => n.startsWith('.~simpaper'))).toEqual([]);
  });

  it('maps engine store failures to a key and keeps the original', async () => {
    await setup();
    const src = await writeDoc('F.docx', await buildOoxml('docx'));
    const original = await readFile(src);
    const doc = await h.service.open(src);
    h.engine.behavior.storeError = rpcError(RPC_ERROR.STORE_FAILED, 'store failed');
    expect(await h.service.save(doc.docId)).toMatchObject({ outcome: 'failed', errorKey: 'errors.save.engineFailed' });
    expect(Buffer.compare(await readFile(src), original)).toBe(0);
  });

  it('asks before overwriting a file that changed on disk since it was opened', async () => {
    await setup();
    const src = await writeDoc('Ortak.docx', await buildOoxml('docx'));
    const doc = await h.service.open(src);
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(src, 'changed by another program');
    h.answer((p) => (p.kind === 'overwriteNewer' ? { kind: 'overwriteNewer', choice: 'cancel' } : undefined));
    expect(await h.service.save(doc.docId)).toEqual({ outcome: 'cancelled' });
    expect(await readFile(src, 'utf8')).toBe('changed by another program');
    h.answer((p) => (p.kind === 'overwriteNewer' ? { kind: 'overwriteNewer', choice: 'overwrite' } : undefined));
    expect((await h.service.save(doc.docId)).outcome).toBe('saved');
  });

  it('opens read-only files for editing but forces Save As', async () => {
    await setup();
    const src = await writeDoc('Salt.docx', await buildOoxml('docx'));
    await chmod(src, 0o444);
    try {
      const doc = await h.service.open(src);
      expect(doc.readOnly).toBe(true);
      expect(h.eventsOf('notice').map((e) => e.noticeKey)).toContain('errors.notice.readOnly');
      expect(await h.service.save(doc.docId)).toEqual({ outcome: 'cancelled' });
      expect(h.dialogs.saveRequests).toHaveLength(1);
    } finally {
      await chmod(src, 0o666);
    }
  });

  it('refuses to save onto a file that is open in another tab', async () => {
    await setup();
    const a = await writeDoc('A.docx', await buildOoxml('docx'));
    const b = await writeDoc('B.docx', await buildOoxml('docx'));
    const docA = await h.service.open(a);
    await h.service.open(b);
    expect(await h.service.save(docA.docId, { path: b })).toMatchObject({ outcome: 'failed', errorKey: 'errors.save.targetOpen' });
  });

  it('exports PDF with FilterData and verification', async () => {
    await setup();
    const src = await writeDoc('Rapor.docx', await buildOoxml('docx'));
    const doc = await h.service.open(src);
    const pdf = join(h.docsDir, 'Rapor.pdf');
    h.dialogs.pdfAnswers = [pdf];
    expect(await h.service.exportPdf(doc.docId, { pdfA: true, hybrid: true })).toEqual({ outcome: 'saved', path: pdf, format: 'pdf' });
    expect(h.dialogs.pdfRequests).toEqual([pdf]);
    const store = h.engine.instance(doc.docId).callsOf('doc.store')[0]?.params ?? {};
    expect(store['filter']).toBe('writer_pdf_Export');
    expect(store['filterData']).toEqual({ SelectPdfVersion: 2, UseTaggedPDF: true, ExportBookmarks: true, IsAddStream: true });
    expect((await readFile(pdf, 'latin1')).startsWith('%PDF-')).toBe(true);
  });

  it('imports CSV with a prompt: preview, locale-aware default separator and explicit filter options', async () => {
    await setup();
    h.engine.nextKind = 'calc';
    const src = await writeDoc('veri.csv', Buffer.from('Ad;Tutar\r\nElma;1,5\r\n', 'utf8'));
    h.answer((p) => (p.kind === 'csvImport' ? { kind: 'csvImport', separator: ';', locale: 'tr-TR' } : undefined));
    const doc = await h.service.open(src);
    expect(h.prompts[0]).toMatchObject({ kind: 'csvImport', fileName: 'veri.csv', defaultSeparator: ';', preview: ['Ad;Tutar', 'Elma;1,5'] });
    const load = h.engine.instance(doc.docId).callsOf('doc.load')[0]?.params ?? {};
    expect(load['filter']).toBe('Text - txt - csv (StarCalc)');
    expect(load['filterOptions']).toBe('59,34,76,1,,1055,false,true,true,false,false,0,false,false,true');
  });

  it('imports CSV with the "Other" separator chosen in the prompt and the code page of the preview', async () => {
    await setup();
    h.engine.nextKind = 'calc';
    // "Şehir#Nüfus" in Windows-1254; the prompt chooses '#' and English number formats on the Turkish UI.
    const src = await writeDoc('eski.csv', Buffer.from([0xde, 0x65, 0x68, 0x69, 0x72, 0x23, 0x4e, 0xfc, 0x66, 0x75, 0x73, 0x0d, 0x0a]));
    h.answer((p) => (p.kind === 'csvImport' ? { kind: 'csvImport', separator: '#', locale: 'en-US' } : undefined));
    const doc = await h.service.open(src);
    expect(h.prompts[0]).toMatchObject({ kind: 'csvImport', preview: ['Şehir#Nüfus'] });
    const options = String(h.engine.instance(doc.docId).callsOf('doc.load')[0]?.params['filterOptions']).split(',');
    expect(options[0]).toBe('35'); // '#', not the default separator
    expect(options[2]).toBe('36'); // Windows-1254, as the preview was decoded
    expect(options[5]).toBe('1033'); // English number and date recognition
  });

  it('imports a Windows-1254 CSV whose first non-ASCII byte comes after 64 KiB with charset 1254', async () => {
    await setup();
    h.engine.nextKind = 'calc';
    const head = Array.from({ length: 6000 }, (_, i) => `${i};${i * 7};OK\r\n`).join('');
    expect(head.length).toBeGreaterThan(64 * 1024);
    // "Şişli" in Windows-1254 (Ş = 0xDE, ş = 0xFE).
    const src = await writeDoc('musteri.csv', Buffer.concat([Buffer.from(head, 'latin1'), Buffer.from([0x39, 0x3b, 0xde, 0x69, 0xfe, 0x6c, 0x69, 0x0d, 0x0a])]));
    h.answer((p) => (p.kind === 'csvImport' ? { kind: 'csvImport', separator: ';', locale: 'tr-TR' } : undefined));
    const doc = await h.service.open(src);
    const options = String(h.engine.instance(doc.docId).callsOf('doc.load')[0]?.params['filterOptions']);
    expect(options.split(',')[2]).toBe('36');
  });

  it('cancelling the CSV import prompt cancels the open and cleans up', async () => {
    await setup();
    h.engine.nextKind = 'calc';
    const src = await writeDoc('veri.csv', Buffer.from('a,b\n1,2\n'));
    h.answer((p) => (p.kind === 'csvImport' ? { kind: 'csvImport', separator: null, locale: 'tr-TR' } : undefined));
    await expect(h.service.open(src)).rejects.toThrow('errors.open.cancelled');
    expect(h.service.descriptors()).toEqual([]);
    expect(h.eventsOf('closed')).toHaveLength(1);
  });

  it('opens PDFs as a working copy without an engine instance', async () => {
    await setup();
    const src = await writeDoc('Belge.pdf', tinyPdf());
    const doc = await h.service.open(src);
    expect(doc).toMatchObject({ kind: 'pdf', format: 'pdf', state: 'ready', compat: null });
    expect(h.engine.history).toHaveLength(0);
    const wc = h.service.get(doc.docId)?.workingCopyPath ?? '';
    expect(Buffer.compare(await readFile(wc), tinyPdf())).toBe(0);
  });

  it('reports unsupported and missing files', async () => {
    await setup();
    await expect(h.service.open(join(h.docsDir, 'yok.docx'))).rejects.toThrow('errors.open.notFound');
    const exe = await writeDoc('program.exe', Buffer.from('MZ\u0000\u0000'));
    await expect(h.service.open(exe)).rejects.toThrow('errors.open.unsupported');
  });

  it('forwards engine events to the renderer', async () => {
    await setup();
    const doc = await h.service.create('writer');
    const inst = h.engine.instance(doc.docId);
    inst.emit({ type: 'state', docId: doc.docId, command: '.uno:Bold', enabled: true, value: true });
    inst.emit({ type: 'context', docId: doc.docId, application: 'com.sun.star.text.TextDocument', context: 'Table' });
    inst.emit({ type: 'dialog', open: true, title: 'x' });
    inst.emit({ type: 'key', docId: doc.docId, key: 'F6' });
    expect(h.eventsOf('state')[0]).toEqual({ type: 'state', docId: doc.docId, command: '.uno:Bold', enabled: true, value: true });
    expect(h.eventsOf('context')[0]).toEqual({ type: 'context', docId: doc.docId, context: 'Table' });
    expect(h.eventsOf('busy').at(-1)).toEqual({ type: 'busy', docId: doc.docId, busy: true, reason: 'dialog' });
    expect(h.eventsOf('shellKey')[0]).toEqual({ type: 'shellKey', docId: doc.docId, key: 'F6' });
    expect(h.service.isBusy(doc.docId)).toBe(true);
  });

  it('handles intercepted commands: Save, macros (refused), unknown (forwarded)', async () => {
    await setup();
    const src = await writeDoc('K.docx', await buildOoxml('docx'));
    const doc = await h.service.open(src);
    const inst = h.engine.instance(doc.docId);
    const before = (await stat(src)).mtimeMs;
    await new Promise((r) => setTimeout(r, 15));
    inst.emit({ type: 'intercept', docId: doc.docId, command: '.uno:Save' });
    await waitFor(() => inst.callsOf('doc.store').length === 1 && !h.service.isBusy(doc.docId));
    await waitFor(() => (h.eventsOf('busy').at(-1)?.busy ?? true) === false);
    expect((await stat(src)).mtimeMs).not.toBe(before);
    inst.emit({ type: 'intercept', docId: doc.docId, command: '.uno:RunMacro' });
    inst.emit({ type: 'intercept', docId: doc.docId, command: '.uno:SomethingNew' });
    await waitFor(() => h.eventsOf('intercept').length === 1);
    expect(h.eventsOf('notice').map((n) => n.noticeKey)).toContain('errors.command.macrosDisabled');
    expect(h.eventsOf('intercept')[0]).toEqual({ type: 'intercept', docId: doc.docId, command: '.uno:SomethingNew' });
  });
});

describe('DocumentService — edits made while a save runs', () => {
  it('an edit made while the written file is verified keeps the document modified, and closing still asks', async () => {
    h = await createHarness({ verifyAfterSave: true });
    await mkdir(h.docsDir, { recursive: true });
    const src = await writeDoc('Rapor.docx', await buildOoxml('docx'));
    const doc = await h.service.open(src);
    const inst = h.engine.instance(doc.docId);
    inst.emit({ type: 'modified', docId: doc.docId, modified: true });
    // The user types while the conversion instance re-opens the temp file: LibreOffice sets the flag again,
    // which the bridge reports as a false → true transition (the store cleared it).
    const convert = h.engine.convert.bind(h.engine);
    h.engine.convert = async (params) => {
      inst.emit({ type: 'modified', docId: doc.docId, modified: true });
      await new Promise((r) => setTimeout(r, 10));
      return convert(params);
    };
    expect((await h.service.save(doc.docId)).outcome).toBe('saved');
    expect(inst.callsOf('doc.store')[0]?.params['markSaved']).toBe(true);
    expect(inst.callsOf('doc.setModified')).toEqual([]);
    expect(h.service.get(doc.docId)?.descriptor).toMatchObject({ modified: true, path: src });

    h.answer((p) => (p.kind === 'unsavedChanges' ? { kind: 'unsavedChanges', choice: 'cancel' } : undefined));
    expect(await h.service.close(doc.docId)).toBe('cancelled');
    expect(h.prompts.filter((p) => p.kind === 'unsavedChanges')).toHaveLength(1);
  });

  it('the store clearing the flag is not shown while saving; a failed verification sets the engine flag again', async () => {
    h = await createHarness({ verifyAfterSave: true });
    await mkdir(h.docsDir, { recursive: true });
    const src = await writeDoc('Rapor.docx', await buildOoxml('docx'));
    const doc = await h.service.open(src);
    const inst = h.engine.instance(doc.docId);
    inst.emit({ type: 'modified', docId: doc.docId, modified: true });
    const duringVerify: Array<boolean | undefined> = [];
    const convert = h.engine.convert.bind(h.engine);
    h.engine.convert = async (params) => {
      duringVerify.push(h.service.get(doc.docId)?.descriptor.modified);
      return convert(params);
    };
    h.engine.convertError = new Error('load failed');
    expect(await h.service.save(doc.docId)).toMatchObject({ outcome: 'failed', errorKey: 'errors.save.verifyFailed' });
    // The engine reported modified:false right after the store; the file was not written, so it does not count.
    expect(duringVerify).toEqual([true]);
    expect(inst.callsOf('doc.setModified').map((c) => c.params['modified'])).toEqual([true]);
    expect(inst.modifiedFlag).toBe(true);
    expect(h.service.get(doc.docId)?.descriptor.modified).toBe(true);
    // Nothing is set again when the store itself failed (the flag was never cleared).
    h.engine.convertError = undefined;
    h.engine.behavior.storeError = new Error('disk');
    expect((await h.service.save(doc.docId)).outcome).toBe('failed');
    expect(inst.callsOf('doc.setModified')).toHaveLength(1);
  });

  it('only real saves clear the engine flag: recovery snapshots and PDF exports do not (markSaved)', async () => {
    await setup();
    await h.recovery.start();
    const src = await writeDoc('Rapor.docx', await buildOoxml('docx'));
    const doc = await h.service.open(src);
    const inst = h.engine.instance(doc.docId);
    inst.emit({ type: 'modified', docId: doc.docId, modified: true });
    await h.recovery.snapshotAll();
    h.dialogs.pdfAnswers = [join(h.docsDir, 'Rapor.pdf')];
    expect((await h.service.exportPdf(doc.docId)).outcome).toBe('saved');
    const [snapshot, pdf] = inst.callsOf('doc.store').map((c) => c.params);
    expect(snapshot?.['filter']).toBe('writer8');
    expect(snapshot?.['markSaved']).toBeUndefined();
    expect(pdf?.['filter']).toBe('writer_pdf_Export');
    expect(pdf?.['markSaved']).toBeUndefined();
    expect(inst.modifiedFlag).toBe(true);
    expect(h.service.get(doc.docId)?.descriptor.modified).toBe(true);
  });
});

describe('DocumentService — passwords', () => {
  it('prompts, retries after a wrong password and keeps the password for saving', async () => {
    await setup();
    const src = await writeDoc('Gizli.docx', await buildOoxml('docx'));
    h.engine.behavior.password = 'gizli';
    const answers = ['yanlis', 'gizli'];
    h.answer((p) => (p.kind === 'password' ? { kind: 'password', password: answers.shift() ?? null } : undefined));
    const doc = await h.service.open(src);
    expect(h.prompts.map((p) => (p.kind === 'password' ? p.retry : null))).toEqual([false, true]);
    const loads = h.engine.instance(doc.docId).callsOf('doc.load').map((c) => c.params['password']);
    expect(loads).toEqual([undefined, 'yanlis', 'gizli']);
    expect(h.service.get(doc.docId)?.password).toBe('gizli');
    expect(h.service.get(doc.docId)?.descriptor.compat?.findings.map((f) => f.id)).toContain('encryption');

    await h.service.save(doc.docId);
    expect(h.engine.instance(doc.docId).callsOf('doc.store')[0]?.params['password']).toBe('gizli');
  });

  it('never renders a password-protected document into an unencrypted verification PDF', async () => {
    h = await createHarness({ verifyAfterSave: true });
    await mkdir(h.docsDir, { recursive: true });
    const src = await writeDoc('Gizli.docx', await buildOoxml('docx'));
    h.engine.behavior.password = 'gizli';
    h.answer((p) => (p.kind === 'password' ? { kind: 'password', password: 'gizli' } : undefined));
    const doc = await h.service.open(src);
    h.engine.instance(doc.docId).emit({ type: 'modified', docId: doc.docId, modified: true });
    expect(await h.service.save(doc.docId)).toEqual({ outcome: 'saved', path: src, format: 'docx' });
    // Structural verification only (compound file with an EncryptedPackage): no re-open into a throwaway PDF.
    expect(h.engine.conversions).toEqual([]);
    expect(h.engine.instance(doc.docId).callsOf('doc.store')[0]?.params['password']).toBe('gizli');
    expect((await readFile(src)).subarray(0, 4).toString('hex')).toBe('d0cf11e0');

    // Documents without a password are still re-opened by the conversion instance.
    h.engine.behavior.password = undefined;
    const plain = await h.service.open(await writeDoc('Acik.docx', await buildOoxml('docx')));
    expect((await h.service.save(plain.docId)).outcome).toBe('saved');
    expect(h.engine.conversions).toHaveLength(1);
    expect(h.engine.conversions[0]).not.toHaveProperty('password');
  });

  it('cancelling the password prompt cancels the open and releases the engine', async () => {
    await setup();
    const src = await writeDoc('Gizli.docx', await buildOoxml('docx'));
    h.engine.behavior.password = 'gizli';
    h.answer((p) => (p.kind === 'password' ? { kind: 'password', password: null } : undefined));
    await expect(h.service.open(src)).rejects.toThrow('errors.open.cancelled');
    expect(h.service.descriptors()).toEqual([]);
    expect(h.engine.released).toHaveLength(1);
    expect(h.eventsOf('error')).toEqual([]);
  });
});

describe('DocumentService — close', () => {
  it('asks about unsaved changes: cancel keeps the document, discard closes it', async () => {
    await setup();
    const src = await writeDoc('C.docx', await buildOoxml('docx'));
    const doc = await h.service.open(src);
    const wc = h.service.get(doc.docId)?.workingCopyPath ?? '';
    h.engine.instance(doc.docId).emit({ type: 'modified', docId: doc.docId, modified: true });

    h.answer((p) => (p.kind === 'unsavedChanges' ? { kind: 'unsavedChanges', choice: 'cancel' } : undefined));
    expect(await h.service.close(doc.docId)).toBe('cancelled');
    expect(h.service.get(doc.docId)).toBeDefined();

    h.answer((p) => (p.kind === 'unsavedChanges' ? { kind: 'unsavedChanges', choice: 'discard' } : undefined));
    expect(await h.service.close(doc.docId)).toBe('closed');
    expect(h.service.get(doc.docId)).toBeUndefined();
    expect(h.engine.released).toContain(doc.docId);
    expect(h.view.log).toContain(`detach:${doc.docId}`);
    await expect(stat(wc)).rejects.toThrow();
    expect(h.eventsOf('closed').map((e) => e.docId)).toEqual([doc.docId]);
  });

  it('"save" in the unsaved prompt saves, then closes', async () => {
    await setup();
    const src = await writeDoc('S.docx', await buildOoxml('docx'));
    const original = await readFile(src);
    const doc = await h.service.open(src);
    h.engine.instance(doc.docId).emit({ type: 'modified', docId: doc.docId, modified: true });
    h.answer((p) => (p.kind === 'unsavedChanges' ? { kind: 'unsavedChanges', choice: 'save' } : undefined));
    expect(await h.service.close(doc.docId)).toBe('closed');
    expect(Buffer.compare(await readFile(src), original)).not.toBe(0);
  });

  it('keeps the document when saving from the unsaved prompt fails', async () => {
    await setup();
    const src = await writeDoc('S.docx', await buildOoxml('docx'));
    const doc = await h.service.open(src);
    h.engine.instance(doc.docId).emit({ type: 'modified', docId: doc.docId, modified: true });
    h.engine.behavior.storeError = new Error('disk');
    h.answer((p) => (p.kind === 'unsavedChanges' ? { kind: 'unsavedChanges', choice: 'save' } : undefined));
    expect(await h.service.close(doc.docId)).toBe('cancelled');
    expect(h.eventsOf('error').at(-1)).toMatchObject({ docId: doc.docId, errorKey: 'errors.save.engineFailed' });
  });

  it('closes unmodified documents without asking', async () => {
    await setup();
    const doc = await h.service.create('writer');
    expect(await h.service.close(doc.docId)).toBe('closed');
    expect(h.prompts).toEqual([]);
  });
});

describe('DocumentService — engine crash and recovery', () => {
  it('restores the newest recovery snapshot into a new engine instance', async () => {
    await setup();
    const src = await writeDoc('Uzun.docx', await buildOoxml('docx'));
    const doc = await h.service.open(src);
    const first = h.engine.instance(doc.docId);
    first.emit({ type: 'modified', docId: doc.docId, modified: true });
    await h.recovery.start();
    await h.recovery.snapshotAll();
    expect(first.callsOf('doc.store')[0]?.params['filter']).toBe('writer8');

    first.crash();
    await waitFor(() => h.engine.history.length === 2 && h.service.get(doc.docId)?.descriptor.state === 'ready');

    const second = h.engine.history[1];
    const load = second?.callsOf('doc.load')[0]?.params ?? {};
    expect(load['filter']).toBe('writer8');
    expect(String(load['url'])).toMatch(/recovered\.odt$/);
    expect(load['baseUrl']).toBe(pathToFileURL(src).href);
    const d = h.service.get(doc.docId)?.descriptor;
    expect(d?.modified).toBe(true);
    expect(d?.recoveredAt).toBeTruthy();
    expect(h.engine.released).toContain(doc.docId);
    expect(h.eventsOf('error').map((e) => e.errorKey)).toContain('errors.engine.crashed');
    expect(h.eventsOf('notice').map((e) => e.noticeKey)).toContain('errors.engine.restored');
    // The restored document still saves to the user's DOCX with the original filter.
    h.answer(() => undefined);
    expect((await h.service.save(doc.docId)).outcome).toBe('saved');
    expect(second?.callsOf('doc.store').at(-1)?.params['filter']).toBe('MS Word 2007 XML');
    // Old instance events are ignored.
    first.emit({ type: 'modified', docId: doc.docId, modified: true });
    expect(h.service.get(doc.docId)?.descriptor.modified).toBe(false);
  });

  it('reopens the last saved file when there is no snapshot', async () => {
    await setup();
    const src = await writeDoc('Temiz.docx', await buildOoxml('docx'));
    const doc = await h.service.open(src);
    h.engine.instance(doc.docId).crash();
    await waitFor(() => h.engine.history.length === 2 && h.service.get(doc.docId)?.descriptor.state === 'ready');
    expect(h.eventsOf('notice').map((e) => e.noticeKey)).toContain('errors.engine.restarted');
    expect(h.service.get(doc.docId)?.descriptor.modified).toBe(false);
  });

  it('reloads a CSV that was saved as XLSX with the XLSX import after a crash, not with the CSV filter', async () => {
    await setup();
    h.engine.nextKind = 'calc';
    const src = await writeDoc('data.csv', Buffer.from('a;b\n1;2\n', 'utf8'));
    h.answer((p) => (p.kind === 'csvImport' ? { kind: 'csvImport', separator: ';', locale: 'tr-TR' } : p.kind === 'saveRisk' ? { kind: 'saveRisk', choice: 'saveAnyway' } : undefined));
    const doc = await h.service.open(src);
    const xlsx = join(h.docsDir, 'data.xlsx');
    h.dialogs.saveAnswers.push(xlsx);
    expect(await h.service.save(doc.docId, { saveAs: true, format: 'xlsx' })).toEqual({ outcome: 'saved', path: xlsx, format: 'xlsx' });

    // No snapshot since the save: the crash restore reloads data.xlsx (type detection finds the XLSX filter).
    h.engine.behavior.loadFilter = 'Calc MS Excel 2007 XML';
    h.engine.instance(doc.docId).crash();
    await waitFor(() => h.engine.history.length === 2 && h.service.get(doc.docId)?.descriptor.state === 'ready');
    const load = h.engine.history[1]?.callsOf('doc.load')[0]?.params ?? {};
    expect(String(load['url'])).toMatch(/data\.xlsx$/);
    expect(load['filter']).toBeUndefined();
    expect(load['filterOptions']).toBeUndefined();
    expect(await h.service.save(doc.docId)).toEqual({ outcome: 'saved', path: xlsx, format: 'xlsx' });
    expect(h.engine.history[1]?.callsOf('doc.store').at(-1)?.params['filter']).toBe('Calc MS Excel 2007 XML');
  });

  it('reloads a legacy-encoded text file after its save as UTF-8, the way the save wrote it', async () => {
    await setup();
    // "Şişli" in Windows-1254 (Ş = 0xDE, ş = 0xFE).
    const src = await writeDoc('notlar.txt', Buffer.from([0xde, 0x69, 0xfe, 0x6c, 0x69, 0x0d, 0x0a]));
    h.answer((p) => (p.kind === 'saveRisk' ? { kind: 'saveRisk', choice: 'saveAnyway' } : undefined));
    const doc = await h.service.open(src);
    expect(h.engine.instance(doc.docId).callsOf('doc.load')[0]?.params['filterOptions']).toBe('MS_1254,CRLF,,tr-TR');
    h.engine.instance(doc.docId).emit({ type: 'modified', docId: doc.docId, modified: true });
    expect((await h.service.save(doc.docId)).outcome).toBe('saved');
    expect(h.engine.instance(doc.docId).callsOf('doc.store')[0]?.params['filterOptions']).toBe('UTF8,CRLF,,tr-TR,true,false');
    h.engine.instance(doc.docId).crash();
    await waitFor(() => h.engine.history.length === 2 && h.service.get(doc.docId)?.descriptor.state === 'ready');
    const load = h.engine.history[1]?.callsOf('doc.load')[0]?.params ?? {};
    expect(load['filter']).toBe('Text (encoded)');
    expect(load['filterOptions']).toBe('UTF8,CRLF,,tr-TR');
  });

  it('a DOCM restored from its ODF snapshot asks before a save would drop its macros (no VBA project left)', async () => {
    await setup();
    await h.recovery.start();
    const src = await writeDoc('Makro.docm', await buildOoxml('docm', { parts: { 'word/vbaProject.bin': new Uint8Array([1, 2]) } }));
    h.engine.behavior.hasMacros = true;
    const doc = await h.service.open(src);
    const first = h.engine.instance(doc.docId);
    // Loaded from the DOCM itself: saving back copies the VBA project, no prompt.
    first.emit({ type: 'modified', docId: doc.docId, modified: true });
    expect(await h.service.save(doc.docId)).toEqual({ outcome: 'saved', path: src, format: 'docm' });
    expect(h.prompts).toEqual([]);

    first.emit({ type: 'modified', docId: doc.docId, modified: true });
    await h.recovery.snapshotAll();
    first.crash();
    await waitFor(() => h.engine.history.length === 2 && h.service.get(doc.docId)?.descriptor.state === 'ready');
    expect(h.engine.history[1]?.callsOf('doc.load')[0]?.params['filter']).toBe('writer8');
    h.answer((p) => (p.kind === 'saveRisk' ? { kind: 'saveRisk', choice: 'cancel' } : undefined));
    expect(await h.service.save(doc.docId)).toEqual({ outcome: 'cancelled' });
    expect((h.prompts[0] as RiskPrompt).findings.map((f) => f.messageKey)).toEqual(['compat.loss.macros']);
  });

  it('leaves an unsaved new document in the crashed state when nothing can be restored', async () => {
    await setup();
    const doc = await h.service.create('writer');
    h.engine.instance(doc.docId).crash();
    await waitFor(() => h.eventsOf('error').some((e) => e.errorKey === 'errors.engine.restoreUnavailable'));
    expect(h.service.get(doc.docId)?.descriptor.state).toBe('crashed');
    // Closing a crashed document does not prompt.
    expect(await h.service.close(doc.docId)).toBe('closed');
  });
});
