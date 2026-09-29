/**
 * doc.store options against the real engine (review 2026-09-29):
 *  - `markSaved` (#4): a real save clears the modified flag in the store's own main-thread job; edits made
 *    afterwards (e.g. while the save is verified) set it again and are reported.
 *  - `baseUrl` (#20): recovery snapshots are stored with `baseUrl: ''`, so links are written absolute. A
 *    snapshot in the recovery folder written relative to that folder would break the document's relative
 *    links when it is restored with the user's file as base URL and saved over it.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RPC_ERROR } from '@shared/engine-protocol';
import { isEngineRpcError } from '../../src/main/engine';
import type { EngineInstance, EngineManager } from '../../src/main/engine/types';
import { docxDocument } from '../tools/ooxml';
import { openPackage, relKind } from '../tools/opc';
import { engineAvailable, EventLog, fileUrl, makeManager, outDir, printTimings, timed } from './helpers';

const WORD = 'MS Word 2007 XML';

/** A minimal DOCX whose only paragraph is a hyperlink to `target` (a relative reference, as Word writes it). */
async function docxWithHyperlink(target: string, text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/>` +
      '</Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<w:body><w:p><w:hyperlink r:id="rId5"><w:r><w:t>${text}</w:t></w:r></w:hyperlink></w:p><w:sectPr/></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** xlink:href of the first text:a of an ODT. */
async function odtHyperlink(path: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const content = (await zip.file('content.xml')?.async('string')) ?? '';
  const match = /<text:a\b[^>]*\bxlink:href="([^"]*)"/.exec(content);
  if (!match?.[1]) throw new Error(`no hyperlink in ${path}`);
  return match[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** Target of the first hyperlink relationship of a DOCX. */
async function docxHyperlink(path: string): Promise<string> {
  const pkg = await openPackage(readFileSync(path));
  const rel = (await pkg.relationships('word/document.xml')).find((r) => relKind(r.type) === 'hyperlink');
  if (!rel) throw new Error(`no hyperlink in ${path}`);
  return rel.target;
}

/** The file a DOCX hyperlink target points to, resolved like Word does (relative to the document's folder). */
function docxLinkFile(target: string, docxPath: string): string {
  return resolve(fileURLToPath(new URL(target.replace(/\\/g, '/'), pathToFileURL(docxPath))));
}

const samePath = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

describe.skipIf(!engineAvailable)('doc.store options (headless)', () => {
  let manager: EngineManager;
  let instance: EngineInstance;
  let dir: string;

  beforeAll(async () => {
    manager = makeManager('store');
    dir = outDir('store');
    instance = await manager.acquireDocumentInstance('store-1');
  });

  afterAll(async () => {
    await manager?.dispose();
    printTimings('doc.store timings');
  });

  const modified = async (docId: string) => (await instance.call('doc.info', { docId })).modified;

  it('markSaved clears the modified flag right after the store; later edits set it again (#4)', async () => {
    const events = new EventLog(instance);
    await instance.call('doc.new', { docId: 'm', kind: 'writer', view: { mode: 'hidden' } });
    await instance.call('writer.insertText', { docId: 'm', text: 'Kaydedilen metin' });
    await events.waitFor((e) => e.type === 'modified' && e.docId === 'm' && e.modified);

    // Recovery snapshots and exports are copies and keep the flag; so does a store that failed.
    await instance.call('doc.store', { docId: 'm', url: fileUrl(join(dir, 'snapshot.odt')), filter: 'writer8' });
    expect(await modified('m')).toBe(true);
    await expect(
      instance.call('doc.store', { docId: 'm', url: fileUrl(join(dir, 'failed.docx')), filter: 'NoSuchFilter', markSaved: true }),
    ).rejects.toSatisfy((e) => isEngineRpcError(e, RPC_ERROR.STORE_FAILED));
    expect(await modified('m')).toBe(true);

    events.clear();
    const saved = join(dir, 'kaydedilen.docx');
    await timed('DOCX store with markSaved', () => instance.call('doc.store', { docId: 'm', url: fileUrl(saved), filter: WORD, markSaved: true }));
    expect(await modified('m')).toBe(false);
    await events.waitFor((e) => e.type === 'modified' && e.docId === 'm' && !e.modified);

    // An edit after the save (e.g. typed while the save is verified) makes the document modified again.
    events.clear();
    await instance.call('writer.insertText', { docId: 'm', text: ' ve sonra yazılan' });
    expect(await modified('m')).toBe(true);
    await events.waitFor((e) => e.type === 'modified' && e.docId === 'm' && e.modified);
    expect((await docxDocument(readFileSync(saved))).text).toBe('Kaydedilen metin');
    await instance.call('doc.close', { docId: 'm' });
  });

  it("baseUrl '' stores links absolute, so a restored snapshot keeps the document's relative links (#20)", async () => {
    // The user's folder: a DOCX with a relative hyperlink to a file next to it. Working copies and snapshots
    // live elsewhere, as deep as in the app (%LOCALAPPDATA%\Varak\{work,recovery}\<session>, see
    // src/main/app/paths); at the same depth a link relative to the recovery folder would resolve by chance.
    const userDir = join(dir, 'Belgeler', 'Plan 2026');
    const appData = join(dir, 'AppData', 'Local', 'Varak');
    const workDir = join(appData, 'work', 'session');
    const recoveryDir = join(appData, 'recovery', 'session');
    for (const d of [userDir, workDir, recoveryDir]) mkdirSync(d, { recursive: true });
    const sibling = join(userDir, 'veri.xlsx');
    writeFileSync(sibling, 'placeholder');
    const original = join(userDir, 'plan.docx');
    writeFileSync(original, await docxWithHyperlink('veri.xlsx', 'Veri tablosu'));
    const base = fileUrl(original);

    // As DocumentService does it: the engine edits a working copy elsewhere; the base URL is the user's file.
    const working = join(workDir, 'plan.docx');
    copyFileSync(original, working);
    await instance.call('doc.load', { docId: 'l', url: fileUrl(working), baseUrl: base, view: { mode: 'hidden' } });
    // RecoveryService's snapshot (ODF, into the recovery folder) and, as a control, the same without baseUrl.
    const snapshot = join(recoveryDir, 'snapshot.odt');
    const control = join(recoveryDir, 'control.odt');
    await instance.call('doc.store', { docId: 'l', url: fileUrl(snapshot), filter: 'writer8', baseUrl: '' });
    await instance.call('doc.store', { docId: 'l', url: fileUrl(control), filter: 'writer8' });
    await instance.call('doc.close', { docId: 'l' });

    const snapshotHref = await odtHyperlink(snapshot);
    const controlHref = await odtHyperlink(control);
    console.log(`snapshot link: ${snapshotHref}\ncontrol link:  ${controlHref}`);
    expect(snapshotHref).toMatch(/^file:\/\/\//);
    expect(samePath(fileURLToPath(snapshotHref), sibling)).toBe(true);
    expect(controlHref).not.toMatch(/^file:/); // relative to the recovery folder: the bug being fixed

    // Restore (restoreAfterCrash / openRecovered load the snapshot with the user's file as base URL), then save.
    async function restoreAndSave(from: string, to: string): Promise<string> {
      await instance.call('doc.load', { docId: 'r', url: fileUrl(from), baseUrl: base, filter: 'writer8', view: { mode: 'hidden' } });
      await instance.call('doc.store', { docId: 'r', url: fileUrl(to), filter: WORD, markSaved: true });
      await instance.call('doc.close', { docId: 'r' });
      return docxHyperlink(to);
    }
    const saved = join(userDir, 'plan-restored.docx');
    const savedTarget = await restoreAndSave(snapshot, saved);
    expect(samePath(docxLinkFile(savedTarget, saved), sibling)).toBe(true);
    // The control shows what the fix prevents: after the restore the link points somewhere else.
    const controlSaved = join(userDir, 'plan-control.docx');
    const controlTarget = await restoreAndSave(control, controlSaved);
    console.log(`saved link after restore: ${savedTarget}\ncontrol after restore:    ${controlTarget}`);
    expect(samePath(docxLinkFile(controlTarget, controlSaved), sibling)).toBe(false);
  });
});
