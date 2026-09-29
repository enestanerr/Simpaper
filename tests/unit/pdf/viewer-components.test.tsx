// @vitest-environment jsdom
/**
 * pdf.js viewer integration under jsdom: the Turkish-insensitive find controller on the real viewer components
 * (legacy build) — stock pdf.js vs. our subclass, then an end-to-end search in a generated document — and the
 * i18next-backed localisation service for pdf.js' own UI.
 * (.tsx: tests importing renderer modules stay out of tsconfig.node.json, whose composite project cannot include
 * src/renderer; they are type-checked with tests/unit/pdf/tsconfig.renderer-tests.json.)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18next from 'i18next';
import { withTurkishMatching } from '../../../src/renderer/modules/pdf/pdfjs/find';
import { PdfjsL10n } from '../../../src/renderer/modules/pdf/pdfjs/l10n';
import { PDFJS_FONTS, REPO_ROOT, makeTurkishPdf } from './helpers';

type ViewerModule = typeof import('pdfjs-dist/legacy/web/pdf_viewer.mjs');
type PdfModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let viewer: ViewerModule;
let pdfjs: PdfModule;

beforeAll(async () => {
  // The viewer reads globalThis.pdfjsLib, so the library must load first (as in src/.../pdfjs/lib.ts).
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  viewer = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs');
});

function fakeLinkService(pagesCount: number) {
  return { pagesCount, page: 1 } as unknown as ConstructorParameters<ViewerModule['PDFFindController']>[0]['linkService'];
}

const findState = (query: string) => ({ source: null, type: '', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false, matchDiacritics: false });

/** pdf.js records per page whether its (NFD-normalised) text contains combining marks, e.g. İ = I + U+0307. */
function pageHasDiacritics(controller: unknown): void {
  (controller as { _hasDiacritics: boolean[] })._hasDiacritics = [true];
}

const DOTTED_I = 'İ';

describe('Turkish find controller', () => {
  it('matches every I variant where stock pdf.js misses some', () => {
    const bus = new viewer.EventBus();
    const Turkish = withTurkishMatching(viewer.PDFFindController);
    const stock = new viewer.PDFFindController({ eventBus: bus, linkService: fakeLinkService(1) });
    const ours = new Turkish({ eventBus: bus, linkService: fakeLinkService(1) });
    pageHasDiacritics(stock);
    pageHasDiacritics(ours);
    bus.dispatch('find', findState('istanbul'));
    const content = `${DOTTED_I}STANBUL ve ISTANBUL ve ıstanbul`;
    expect(stock.match('istanbul', content, 0)).toHaveLength(2);
    expect(ours.match('istanbul', content, 0)).toHaveLength(3);
    bus.dispatch('find', findState('ılık'));
    expect(stock.match('ılık', 'ILIK ılık', 0)).toHaveLength(1);
    expect(ours.match('ılık', 'ILIK ılık', 0)).toHaveLength(2);
  });

  it('keeps case-sensitive searches exact', () => {
    const bus = new viewer.EventBus();
    const ours = new (withTurkishMatching(viewer.PDFFindController))({ eventBus: bus, linkService: fakeLinkService(1) });
    pageHasDiacritics(ours);
    bus.dispatch('find', { ...findState('İstanbul'), caseSensitive: true });
    expect(ours.match(`${DOTTED_I}stanbul`, `${DOTTED_I}stanbul istanbul`, 0)).toEqual([{ index: 0, length: 9 }]);
  });

  it('counts matches in a real document', async () => {
    const bytes = await makeTurkishPdf('İSTANBUL ve Istanbul, ılık ILIK hava; istanbul.');
    const task = pdfjs.getDocument({ data: bytes, verbosity: 0, standardFontDataUrl: `${PDFJS_FONTS}/` });
    const pdf = await task.promise;
    const count = (Controller: ViewerModule['PDFFindController'], query: string) => {
      const bus = new viewer.EventBus();
      const controller = new Controller({ eventBus: bus, linkService: fakeLinkService(pdf.numPages) });
      controller.setDocument(pdf as never);
      return countMatches(bus, query);
    };
    try {
      const Turkish = withTurkishMatching(viewer.PDFFindController);
      expect(await count(Turkish, 'istanbul')).toBe(3);
      expect(await count(Turkish, 'ılık')).toBe(2);
      expect(await count(Turkish, 'ankara')).toBe(0);
      // Stock pdf.js finds only the lower-case dotless form.
      expect(await count(viewer.PDFFindController, 'ılık')).toBe(1);
    } finally {
      await task.destroy();
    }
  });
});

/** pdf.js reports FOUND first and the match count in a separate event; NOT_FOUND (state 1) means 0. */
function countMatches(bus: InstanceType<ViewerModule['EventBus']>, query: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('find timed out')), 10_000);
    const done = (n: number) => {
      clearTimeout(timer);
      bus.off('updatefindcontrolstate', onState);
      bus.off('updatefindmatchescount', onCount);
      resolve(n);
    };
    const onState = ({ state }: { state: number }) => {
      if (state === 1) done(0);
    };
    const onCount = ({ matchesCount }: { matchesCount: { total: number } }) => done(matchesCount.total);
    bus.on('updatefindcontrolstate', onState);
    bus.on('updatefindmatchescount', onCount);
    bus.dispatch('find', findState(query));
  });
}

describe('pdf.js localisation service', () => {
  async function makeI18n(lng: 'tr' | 'en') {
    const load = (l: string) => JSON.parse(readFileSync(join(REPO_ROOT, `src/renderer/i18n/locales/${l}/pdf.json`), 'utf8')) as Record<string, unknown>;
    const instance = i18next.createInstance();
    // Same separators as the shell (src/renderer/i18n/index.ts): keys are `<namespace>.<path>`.
    await instance.init({
      lng,
      fallbackLng: 'en',
      ns: ['pdf'],
      defaultNS: 'pdf',
      nsSeparator: '.',
      keySeparator: '.',
      interpolation: { escapeValue: false },
      resources: { tr: { pdf: load('tr') }, en: { pdf: load('en') } },
      initAsync: false,
    });
    return instance;
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('translates data-l10n-id elements, including ones added later, and follows pause/resume', async () => {
    const l10n = new PdfjsL10n(await makeI18n('tr'));
    const root = document.createElement('div');
    document.body.append(root);
    const editor = document.createElement('div');
    editor.setAttribute('data-l10n-id', 'pdfjs-free-text2');
    root.append(editor);
    await l10n.translate(root);
    expect(editor.getAttribute('default-content')).toBe('Yazmaya başlayın…');
    expect(editor.getAttribute('aria-label')).toBe('Metin düzenleyici');

    const page = document.createElement('div');
    page.setAttribute('data-l10n-id', 'pdfjs-page-landmark');
    page.setAttribute('data-l10n-args', JSON.stringify({ page: 3 }));
    root.append(page);
    await flush();
    expect(page.getAttribute('aria-label')).toBe('Sayfa 3');

    // Layers appended while paused (pdf.js text layers) are not scanned.
    l10n.pause();
    const quiet = document.createElement('button');
    quiet.setAttribute('data-l10n-id', 'pdfjs-editor-remove-stamp-button');
    root.append(quiet);
    await flush();
    expect(quiet.hasAttribute('title')).toBe(false);
    l10n.resume();
    page.setAttribute('data-l10n-args', JSON.stringify({ page: 4 }));
    await flush();
    expect(page.getAttribute('aria-label')).toBe('Sayfa 4');

    expect(await l10n.get('pdfjs-editor-alt-text-button-label')).toBe('Alternatif metin');
    expect(await l10n.get('pdfjs-unknown-id', null, 'fallback')).toBe('fallback');
    expect(l10n.getLanguage()).toBe('tr');
    await l10n.destroy();
    root.remove();
  });

  it('formats pdf.js dates and speaks English', async () => {
    const l10n = new PdfjsL10n(await makeI18n('en'));
    const el = document.createElement('span');
    el.setAttribute('data-l10n-id', 'pdfjs-annotation-date-time-string');
    el.setAttribute('data-l10n-args', JSON.stringify({ dateObj: Date.UTC(2026, 8, 29, 10, 30, 0) }));
    await l10n.translateOnce(el);
    expect(el.textContent).toMatch(/2026|26/);
    expect(l10n.getLanguage()).toBe('en-us');
  });
});
