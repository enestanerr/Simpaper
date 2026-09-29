/**
 * doc.info on a real engine. Writer's page count comes from the document statistics (the pages of the current
 * layout), not from controller.PageCount: that formats the whole document with a progress bar, and Writer drops
 * every keystroke that arrives meanwhile — typed text got lost in the GUI spike whenever the status bar asked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineManager } from '../../src/main/engine/types';
import { engineAvailable, makeManager } from './helpers';

describe.skipIf(!engineAvailable)('doc.info (headless)', () => {
  let manager: EngineManager;

  beforeAll(() => {
    manager = makeManager('docinfo');
  });

  afterAll(async () => {
    await manager?.dispose();
  });

  it('reports the Writer page count of the current layout and follows the text', async () => {
    const instance = await manager.acquireDocumentInstance('info-1');
    await instance.call('doc.new', { docId: 'w', kind: 'writer', view: { mode: 'hidden' } });
    expect((await instance.call('doc.info', { docId: 'w' })).pageCount).toBe(1);
    const sentence = 'Pijamalı hasta yağız şoföre çabucak güvendi. ';
    await instance.call('writer.insertText', { docId: 'w', text: sentence.repeat(900) });
    await expect
      .poll(async () => (await instance.call('doc.info', { docId: 'w' })).pageCount ?? 0, { timeout: 20_000, interval: 250 })
      .toBeGreaterThan(2);
    const info = await instance.call('doc.info', { docId: 'w' });
    expect(info.wordCount).toBe(900 * 6);
    expect(info.currentPage).toBeGreaterThanOrEqual(1);
    await manager.releaseDocumentInstance('info-1');
  });
});
