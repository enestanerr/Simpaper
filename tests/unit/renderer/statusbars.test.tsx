// @vitest-environment jsdom
// @jsxRuntime automatic
/**
 * Office status bars fed by `doc.info` (engine:query). The GUI spike showed "Slayt 0 / 3" on the first slide:
 * `currentSlide` is the 0-based index `impress.gotoSlide` takes, people count from 1.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DocInfo } from '@shared/engine-protocol';
import { initI18n } from '../../../src/renderer/i18n';
import { ImpressStatusBar } from '../../../src/renderer/modules/impress/StatusBar';
import { upsertDocument } from '../../../src/renderer/state/appStore';
import { descriptor, installIpc, removeIpc, resetRendererState } from './helpers';

beforeAll(() => {
  initI18n('tr');
});

beforeEach(() => resetRendererState());

afterEach(() => {
  cleanup();
  removeIpc();
});

async function renderImpress(info: Partial<DocInfo>): Promise<void> {
  const ipc = installIpc();
  ipc.handle('engine:subscribe', () => []);
  ipc.handle('engine:query', () => ({ docId: 'p1', modified: false, title: 'Sunu.pptx', ...info }));
  const doc = descriptor('p1', 'impress');
  upsertDocument(doc);
  render(<ImpressStatusBar doc={doc} />);
  // doc.info is queried after a short debounce.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
}

describe('Impress status bar', () => {
  it('shows the slide in the view counted from 1', async () => {
    await renderImpress({ slideCount: 3, currentSlide: 0 });
    expect(screen.getByText('Slayt 1 / 3')).toBeTruthy();
  });

  it('shows the last slide as the slide count', async () => {
    await renderImpress({ slideCount: 4, currentSlide: 3 });
    expect(screen.getByText('Slayt 4 / 4')).toBeTruthy();
  });
});
