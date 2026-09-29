/**
 * Crash recovery of the main-process core against the real LibreOffice engine (headless, hidden views):
 *  - an autosave snapshot of a session that did not shut down cleanly is restored in the next session;
 *  - a password-protected document is snapshotted *encrypted* with its password (never in plain text), and
 *    restoring it asks for the password again (cancel keeps the snapshot);
 *  - killing soffice while a document is edited turns the document `crashed` and restores it from its newest
 *    snapshot in a new engine instance (changes after the snapshot are lost, nothing else).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentDescriptor, Prompt } from '@shared/api/documents';
import { readManifest } from '../../src/main/recovery/manifest';
import { copyCorpus, createRealHarness, engineAvailable, killTree, until, type RealHarness } from '../unit/main/helpers/realEngine';

const PASSWORD = 'Gizli-Şifre 7';
const COMPOUND_FILE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** A minimal DOCX whose text links to `target`, relative to the document's folder. */
async function docxWithLink(target: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t xml:space="preserve">Veriler: </w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t>tablo</w:t></w:r></w:hyperlink></w:p><w:sectPr/></w:body></w:document>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/></Relationships>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe.skipIf(!engineAvailable)('recovery with the real engine', () => {
  let h: RealHarness;

  beforeAll(async () => {
    h = await createRealHarness('recovery');
  });

  afterAll(async () => {
    if (!h) return;
    const left = await h.dispose();
    expect(left).toEqual([]);
    expect(h.views.attached).toEqual([]);
  });

  /** A spreadsheet file: the generated corpus workbook or a small one the engine writes. */
  async function workbook(name: string): Promise<string> {
    const copied = copyCorpus('xlsx-basic.xlsx', h.docsDir, name);
    if (copied) return copied;
    const doc = await h.service.create('calc');
    await h.instance(doc.docId).call('calc.setCell', { docId: doc.docId, sheet: 0, address: 'A1', value: 'Şehir' });
    const path = join(h.docsDir, name);
    expect((await h.service.save(doc.docId, { path, format: 'xlsx' })).outcome).toBe('saved');
    expect(await h.service.close(doc.docId)).toBe('closed');
    return path;
  }

  const cell = async (service: RealHarness['service'], docId: string, address: string) => {
    const inst = service.instanceOf(docId);
    if (!inst) throw new Error('no engine instance');
    return inst.call('calc.getCell', { docId, sheet: 0, address });
  };

  const sessionDir = (session: string) => join(h.dir, 'recovery', session);

  it(
    'restores the autosave snapshot of a session that did not shut down cleanly',
    async () => {
      const src = await workbook('Kurtarma.xlsx');
      const original = readFileSync(src);
      const doc = await h.service.open(src);
      const docId = doc.docId;
      const text = 'Kaydedilmemiş değişiklik — çğıöşü';
      await h.instance(docId).call('calc.setCell', { docId, sheet: 0, address: 'Z1', value: text });
      await until(() => h.service.get(docId)?.descriptor.modified === true, 30_000, 'modified flag');
      await h.recovery.snapshotAll();

      const manifest = await readManifest(join(sessionDir('sessA'), `${docId}.json`));
      expect(manifest).toMatchObject({ docId, kind: 'calc', title: 'Kurtarma.xlsx', originalPath: src, originalFormat: 'xlsx', reason: 'unclean-shutdown', encrypted: false, snapshotFile: `${docId}.ods` });
      // The snapshot is an ODF spreadsheet with the unsaved change; the user's file is untouched.
      const ods = await JSZip.loadAsync(readFileSync(join(sessionDir('sessA'), `${docId}.ods`)));
      expect(await ods.file('mimetype')?.async('string')).toBe('application/vnd.oasis.opendocument.spreadsheet');
      expect(await ods.file('content.xml')?.async('string')).toContain(text);
      expect(readFileSync(src).equals(original)).toBe(true);

      // The app "died" (no clean-shutdown marker): the next session offers the snapshot.
      const b = await h.nextSession('sessB');
      const entries = await b.recovery.scanPrevious();
      const entry = entries.find((e) => e.originalPath === src);
      expect(entry).toMatchObject({ kind: 'calc', title: 'Kurtarma.xlsx', originalFormat: 'xlsx', reason: 'unclean-shutdown' });
      const restored = await b.recovery.restore(entry!.id);
      expect(restored).toMatchObject({ kind: 'calc', path: src, format: 'xlsx', modified: true, state: 'ready' });
      expect(restored.recoveredAt).toBe(manifest?.snapshotAt);
      expect((await cell(b.service, restored.docId, 'Z1')).value).toBe(text);
      expect((await b.recovery.list()).map((e) => e.id)).not.toContain(entry!.id);

      // Saving the restored document writes the user's XLSX (original format and path).
      expect(await b.service.save(restored.docId)).toEqual({ outcome: 'saved', path: src, format: 'xlsx' });
      const zip = await JSZip.loadAsync(readFileSync(src));
      expect((await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '').toContain(text);
      expect(await b.service.close(restored.docId)).toBe('closed');
      expect(await h.service.close(docId, true)).toBe('closed');
    },
    600_000,
  );

  it(
    'a relative hyperlink survives snapshot → restore → save (snapshots store links absolute)',
    async () => {
      const folder = join(h.docsDir, 'Plan');
      mkdirSync(folder, { recursive: true });
      const src = join(folder, 'Bağlantı.docx');
      writeFileSync(src, await docxWithLink('veri.xlsx'));
      const doc = await h.service.open(src);
      const docId = doc.docId;
      await h.instance(docId).call('writer.insertText', { docId, text: 'Kurtarılacak metin. ' });
      await until(() => h.service.get(docId)?.descriptor.modified === true, 30_000, 'modified flag');
      await h.recovery.snapshotAll();

      const linked = join(folder, 'veri.xlsx').toLowerCase();
      /** A link as a file path: file URLs as they are, relative links against `base`. */
      const asPath = (link: string, base: string) => (link.startsWith('file:') ? fileURLToPath(link) : resolve(base, decodeURIComponent(link))).toLowerCase();

      // In the snapshot the link is absolute: relative to the recovery folder it would point elsewhere once the
      // snapshot is loaded with the document's own path as base URL.
      const snapshot = await JSZip.loadAsync(readFileSync(join(sessionDir('sessA'), `${docId}.odt`)));
      const content = (await snapshot.file('content.xml')?.async('string')) ?? '';
      const href = /<text:a [^>]*xlink:href="([^"]+)"/.exec(content)?.[1] ?? '';
      expect(href.startsWith('file:')).toBe(true);
      expect(asPath(href, '')).toBe(linked);

      const d = await h.nextSession('sessD');
      const entry = (await d.recovery.scanPrevious()).find((e) => e.originalPath === src);
      expect(entry).toBeDefined();
      const restored = await d.recovery.restore(entry!.id);
      expect(await d.service.save(restored.docId)).toEqual({ outcome: 'saved', path: src, format: 'docx' });
      const rels = (await (await JSZip.loadAsync(readFileSync(src))).file('word/_rels/document.xml.rels')?.async('string')) ?? '';
      const relation = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes('/hyperlink"')) ?? '';
      const target = /Target="([^"]+)"/.exec(relation)?.[1] ?? '';
      // The user's file links to the same file as before (relative or absolute), never via the recovery folder.
      expect(asPath(target, folder)).toBe(linked);
      expect(target.toLowerCase()).not.toContain('recovery');
      expect(await d.service.close(restored.docId)).toBe('closed');
      expect(await h.service.close(docId, true)).toBe('closed');
    },
    600_000,
  );

  it(
    'snapshots a password-protected document encrypted and asks for the password when restoring it',
    async () => {
      // A password-protected XLSX written by the engine (agile encryption → compound file).
      const plain = await workbook('Açık.xlsx');
      const seed = await h.service.open(plain);
      const src = join(h.docsDir, 'Şifreli.xlsx');
      await h.instance(seed.docId).call('doc.store', { docId: seed.docId, url: pathToFileURL(src).href, filter: 'Calc MS Excel 2007 XML', password: PASSWORD });
      expect(await h.service.close(seed.docId)).toBe('closed');
      expect(readFileSync(src).subarray(0, 8).equals(COMPOUND_FILE)).toBe(true);

      // Open: the password is asked first; a wrong one is asked again with `retry`.
      let attempts = 0;
      h.answer((p) => (p.kind === 'password' ? { kind: 'password', password: attempts++ === 0 ? 'yanlış' : PASSWORD } : undefined));
      const promptsBefore = h.prompts.length;
      const doc = await h.service.open(src);
      const docId = doc.docId;
      const asked = h.prompts.slice(promptsBefore).filter((p): p is Extract<Prompt, { kind: 'password' }> => p.kind === 'password');
      expect(asked.map((p) => p.retry)).toEqual([false, true]);
      expect(doc.compat?.findings.map((f) => f.id)).toContain('encryption');

      const secret = 'Gizli içerik: çğıöşü ÇĞİÖŞÜ 4815162342';
      await h.instance(docId).call('calc.setCell', { docId, sheet: 0, address: 'Z1', value: secret });
      await until(() => h.service.get(docId)?.descriptor.modified === true, 30_000, 'modified flag');
      await h.recovery.snapshotAll();

      // The snapshot carries the document's password: ODF package encryption, never plain content.
      const manifest = await readManifest(join(sessionDir('sessA'), `${docId}.json`));
      expect(manifest).toMatchObject({ encrypted: true, snapshotFile: `${docId}.ods` });
      const snapshotPath = join(sessionDir('sessA'), `${docId}.ods`);
      const snapshot = await JSZip.loadAsync(readFileSync(snapshotPath));
      const names = Object.keys(snapshot.files);
      const odfManifest = (await snapshot.file('META-INF/manifest.xml')?.async('string')) ?? '';
      expect(names.includes('encrypted-package') || odfManifest.includes('encryption-data')).toBe(true);
      for (const name of names) {
        const entry = snapshot.file(name);
        if (!entry) continue;
        // Encrypted entries do not inflate to the text; plain ones must not contain it either.
        const content = await entry.async('nodebuffer').catch(() => Buffer.alloc(0));
        expect(content.includes(Buffer.from(secret, 'utf8'))).toBe(false);
      }
      expect(readFileSync(snapshotPath).includes(Buffer.from(secret, 'utf8'))).toBe(false);

      // Next session: restoring asks for the password; cancelling keeps the entry and the snapshot.
      const c = await h.nextSession('sessC');
      const entry = (await c.recovery.scanPrevious()).find((e) => e.originalPath === src);
      expect(entry).toBeDefined();
      c.answer((p) => (p.kind === 'password' ? { kind: 'password', password: null } : undefined));
      await expect(c.recovery.restore(entry!.id)).rejects.toThrow('errors.open.cancelled');
      expect((await c.recovery.list()).map((e) => e.id)).toContain(entry!.id);
      expect(readdirSync(sessionDir('sessA'))).toContain(`${docId}.ods`);

      let restoreAttempts = 0;
      c.answer((p) => (p.kind === 'password' ? { kind: 'password', password: restoreAttempts++ === 0 ? 'yine yanlış' : PASSWORD } : undefined));
      const before = c.prompts.length;
      const restored: DocumentDescriptor = await c.recovery.restore(entry!.id);
      expect(c.prompts.slice(before).filter((p) => p.kind === 'password').map((p) => (p as Extract<Prompt, { kind: 'password' }>).retry)).toEqual([false, true]);
      expect((await cell(c.service, restored.docId, 'Z1')).value).toBe(secret);

      // Saving keeps the protection: the user's file is again an encrypted compound file.
      expect(await c.service.save(restored.docId)).toEqual({ outcome: 'saved', path: src, format: 'xlsx' });
      expect(readFileSync(src).subarray(0, 8).equals(COMPOUND_FILE)).toBe(true);
      expect(readFileSync(src).includes(Buffer.from(secret, 'utf8'))).toBe(false);
      expect(await c.service.close(restored.docId)).toBe('closed');
      expect(await h.service.close(docId, true)).toBe('closed');
      h.answer(() => undefined);
    },
    600_000,
  );

  it(
    'engine crash while editing: the document becomes "crashed" and is restored from its newest snapshot',
    async () => {
      const src = await workbook('Çökme.xlsx');
      const doc = await h.service.open(src);
      const docId = doc.docId;
      const first = h.instance(docId);
      const kept = 'Anlık görüntüde var';
      const lost = 'Anlık görüntüden sonra';
      await first.call('calc.setCell', { docId, sheet: 0, address: 'Z1', value: kept });
      await until(() => h.service.get(docId)?.descriptor.modified === true, 30_000, 'modified flag');
      await h.recovery.snapshotAll();
      await first.call('calc.setCell', { docId, sheet: 0, address: 'Z2', value: lost });

      const states: string[] = [];
      const seen = h.events.length;
      const officePid = first.info().officePid;
      expect(officePid).toBeGreaterThan(0);
      await killTree(officePid!);

      await until(
        () => {
          const d = h.service.get(docId)?.descriptor;
          return d?.state === 'ready' && Boolean(d.recoveredAt);
        },
        300_000,
        'restore after the crash',
      );
      for (const e of h.events.slice(seen)) if (e.type === 'updated' && e.doc.docId === docId) states.push(e.doc.state);
      expect(states).toContain('crashed');
      expect(states.indexOf('crashed')).toBeLessThan(states.lastIndexOf('ready'));
      const events = h.events.slice(seen);
      expect(events.some((e) => e.type === 'error' && e.docId === docId && e.errorKey === 'errors.engine.crashed')).toBe(true);
      expect(events.some((e) => e.type === 'notice' && e.docId === docId && e.noticeKey === 'errors.engine.restored')).toBe(true);

      const second = h.instance(docId);
      expect(second).not.toBe(first);
      expect(second.info().officePid).not.toBe(officePid);
      expect(h.service.get(docId)?.descriptor).toMatchObject({ state: 'ready', modified: true, path: src, format: 'xlsx' });
      // The snapshot content is back; what came after it is lost (at most one autosave interval).
      expect((await cell(h.service, docId, 'Z1')).value).toBe(kept);
      expect((await cell(h.service, docId, 'Z2')).type).toBe('empty');
      // Restored: no longer offered as a crash entry.
      expect((await h.recovery.list()).filter((e) => e.reason === 'engine-crash')).toEqual([]);

      // It saves back to the user's XLSX.
      expect(await h.service.save(docId)).toEqual({ outcome: 'saved', path: src, format: 'xlsx' });
      expect(((await (await JSZip.loadAsync(readFileSync(src))).file('xl/sharedStrings.xml')?.async('string')) ?? '').includes(kept)).toBe(true);
      expect(await h.service.close(docId)).toBe('closed');
    },
    600_000,
  );
});
