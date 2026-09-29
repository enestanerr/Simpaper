/**
 * Writer documents through the main-process core against the real LibreOffice engine (headless, hidden views):
 * DOCX open → insert text → save through the whole pipeline → reopen; the original content (headings, table,
 * image, header/footer) survives. Kept apart from the spreadsheet/presentation tests so that a Writer-specific
 * engine problem shows up on its own.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyCorpus, createRealHarness, engineAvailable, until, type RealHarness } from '../unit/main/helpers/realEngine';

describe.skipIf(!engineAvailable)('documents with the real engine: Writer', () => {
  let h: RealHarness;

  beforeAll(async () => {
    h = await createRealHarness('writer');
  });

  afterAll(async () => {
    if (!h) return;
    const left = await h.dispose();
    expect(left).toEqual([]);
    expect(h.views.attached).toEqual([]);
  });

  it(
    'DOCX: open → insert text → save with verification → reopen: the edit and the original content survive',
    async () => {
      let src = copyCorpus('docx-basic.docx', h.docsDir, 'Rapor.docx');
      const fromCorpus = src !== null;
      if (!src) {
        const seed = await h.service.create('writer');
        await h.instance(seed.docId).call('writer.insertText', { docId: seed.docId, text: 'Pijamalı hasta yağız şoföre çabucak güvendi.' });
        src = join(h.docsDir, 'Rapor.docx');
        expect((await h.service.save(seed.docId, { path: src, format: 'docx' })).outcome).toBe('saved');
        expect(await h.service.close(seed.docId)).toBe('closed');
      }
      const doc = await h.service.open(src);
      expect(doc).toMatchObject({ kind: 'writer', format: 'docx', state: 'ready', modified: false });
      const docId = doc.docId;
      const inst = h.instance(docId);
      expect((await inst.call('writer.getText', { docId })).text).toContain('Pijamalı hasta yağız şoföre çabucak güvendi.');

      const added = 'Eklenen paragraf: çğıöşü ÇĞİÖŞÜ ıIiİ. ';
      await inst.call('writer.insertText', { docId, text: added });
      await until(() => h.service.get(docId)?.descriptor.modified === true, 30_000, 'modified flag');
      const promptsBefore = h.prompts.length;
      expect(await h.service.save(docId)).toEqual({ outcome: 'saved', path: src, format: 'docx' });
      // Tracked changes are kept by the engine: nothing at risk, no prompt.
      expect(h.prompts.slice(promptsBefore)).toEqual([]);

      const zip = await JSZip.loadAsync(readFileSync(src));
      const body = (await zip.file('word/document.xml')?.async('string')) ?? '';
      expect(body).toContain('Eklenen paragraf: çğıöşü ÇĞİÖŞÜ ıIiİ.');
      if (fromCorpus) {
        const names = Object.keys(zip.files);
        expect(body).toContain('<w:tbl>');
        expect(names.some((n) => /^word\/header\d*\.xml$/.test(n))).toBe(true);
        expect(names.some((n) => /^word\/footer\d*\.xml$/.test(n))).toBe(true);
        expect(names.some((n) => /^word\/media\/[^/]+\.(png|jpe?g)$/i.test(n))).toBe(true);
      }

      expect(await h.service.close(docId)).toBe('closed');
      const again = await h.service.open(src);
      const text = (await h.instance(again.docId).call('writer.getText', { docId: again.docId })).text;
      expect(text).toContain('Eklenen paragraf: çğıöşü ÇĞİÖŞÜ ıIiİ.');
      expect(text).toContain('Pijamalı hasta yağız şoföre çabucak güvendi.');
      expect(await h.service.close(again.docId)).toBe('closed');
    },
    900_000,
  );
});
