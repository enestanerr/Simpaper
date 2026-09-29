// @vitest-environment jsdom
// @jsxRuntime automatic
/**
 * Module registry: the four editors, and the PDF module whose workspace (with pdf.js) is a separate chunk
 * loaded on demand — it must expose exactly what src/renderer/modules/pdf/index.ts defines, show a loading
 * state while the chunk loads and a message if it cannot be loaded.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import type { ModuleDefinition } from '../../../src/renderer/modules/types';
import { descriptor, flush, REPO_ROOT } from './helpers';

const WORKSPACE = '../../../src/renderer/modules/pdf/components/Workspace';

beforeAll(() => {
  initI18n('tr');
});

afterEach(() => {
  cleanup();
  vi.doUnmock(WORKSPACE);
  vi.resetModules();
});

describe('registry', () => {
  it('registers the four editors in tab-menu order', async () => {
    const { MODULES, moduleFor } = await import('../../../src/renderer/modules');
    const { getModule, allModules } = await import('../../../src/renderer/modules/registry');
    expect(MODULES.map((m) => m.kind)).toEqual(['writer', 'calc', 'impress', 'pdf']);
    for (const m of MODULES) {
      expect(getModule(m.kind)).toBe(m);
      expect(moduleFor(m.kind)).toBe(m);
    }
    expect(allModules()).toHaveLength(4);
  });

  it('defines the lazily loaded PDF module with the same members as the PDF module itself', async () => {
    const { pdfModule } = await import('../../../src/renderer/modules/pdfLazy');
    const { flushPdf, pdfActions } = await import('../../../src/renderer/modules/pdf/actions');
    const { pdfRibbon } = await import('../../../src/renderer/modules/pdf/ribbon');
    const { PdfStatusBar } = await import('../../../src/renderer/modules/pdf/components/StatusBar');
    expect(pdfModule.kind).toBe('pdf');
    expect(pdfModule.ribbon).toBe(pdfRibbon);
    expect(pdfModule.actions).toBe(pdfActions);
    expect(pdfModule.StatusBar).toBe(PdfStatusBar);
    // Pending annotation/form edits are pushed before a close and on the main process' flush requests.
    expect(pdfModule.flush).toBe(flushPdf);
    // src/renderer/modules/pdf/index.ts is the PDF module's own definition (it imports pdf.js statically):
    // compare its member names so a member added there is not forgotten here.
    const source = readFileSync(join(REPO_ROOT, 'src/renderer/modules/pdf/index.ts'), 'utf8');
    const literal = /export const pdfModule: ModuleDefinition = \{([\s\S]*?)\};/.exec(source)?.[1] ?? '';
    const members = [...literal.matchAll(/^\s*([A-Za-z]+)\s*:/gm)].map((m) => m[1]).sort();
    expect(members).toEqual(Object.keys(pdfModule).sort());
    expect(source).toContain('startCommandBridge()');
  });

  it('never imports pdf.js from the main bundle (only the workspace chunk does)', () => {
    const files = ['modules/pdfLazy.tsx', 'modules/pdf/ribbon.ts', 'modules/pdf/actions.ts', 'modules/pdf/components/StatusBar.tsx', 'modules/pdf/components/RibbonControls.tsx', 'modules/pdf/state/commandBridge.ts', 'modules/pdf/state/store.ts'];
    for (const file of files) {
      const text = readFileSync(join(REPO_ROOT, 'src/renderer', file), 'utf8');
      const staticImports = [...text.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]!);
      expect(staticImports.filter((i) => i.startsWith('pdfjs-dist') && !i.endsWith('.css')), file).toEqual([]);
      expect(staticImports.filter((i) => /controller\/controller$|components\/Workspace$|pdfjs\/lib$/.test(i)), file).toEqual([]);
    }
  });
});

describe('lazy PDF workspace', () => {
  async function renderWorkspace(active = true) {
    const { pdfModule } = (await import('../../../src/renderer/modules/pdfLazy')) as { pdfModule: ModuleDefinition };
    const Workspace = pdfModule.Workspace;
    return render(<Workspace doc={descriptor('p1', 'pdf', { title: 'Sözleşme.pdf' })} active={active} />);
  }

  it('shows a loading state until the chunk is there, then the workspace', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.doMock(WORKSPACE, async () => {
      await gate;
      return { PdfWorkspace: ({ doc }: { doc: { title: string } }) => <div role="main">Çalışma alanı: {doc.title}</div> };
    });
    await renderWorkspace();
    expect(screen.getByRole('status').textContent).toContain('Sözleşme.pdf açılıyor…');
    await act(async () => {
      release();
      await flush();
    });
    expect(screen.getByRole('main').textContent).toBe('Çalışma alanı: Sözleşme.pdf');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows nothing while loading in a background tab', async () => {
    vi.doMock(WORKSPACE, () => new Promise(() => undefined));
    const view = await renderWorkspace(false);
    expect(view.container.textContent).toBe('');
  });

  it('reports a chunk that cannot be loaded instead of an empty area', async () => {
    vi.doMock(WORKSPACE, () => {
      throw new Error('chunk missing');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderWorkspace();
    await act(flush);
    expect(screen.getByRole('alert').textContent).toContain('Bu belge türünü gösteren bileşen yüklenemedi');
    expect(screen.getByRole('button', { name: 'Belgeyi kapat' })).toBeTruthy();
    error.mockRestore();
  });
});
