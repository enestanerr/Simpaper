/**
 * PDF ribbon and strings: every control runs a real module action, keytips are usable, and every
 * i18n key the module (renderer and main process) uses exists in Turkish and English.
 * (.tsx: tests importing renderer modules stay out of tsconfig.node.json, whose composite project cannot include
 * src/renderer; they are type-checked with tests/unit/pdf/tsconfig.renderer-tests.json.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RibbonAction, RibbonControl } from '../../../src/renderer/ribbon/types';
import { pdfActions } from '../../../src/renderer/modules/pdf/actions';
import { pdfRibbon } from '../../../src/renderer/modules/pdf/ribbon';
import { REPO_ROOT } from './helpers';

type Tree = { [key: string]: string | Tree };

const locales = {
  tr: JSON.parse(readFileSync(join(REPO_ROOT, 'src/renderer/i18n/locales/tr/pdf.json'), 'utf8')) as Tree,
  en: JSON.parse(readFileSync(join(REPO_ROOT, 'src/renderer/i18n/locales/en/pdf.json'), 'utf8')) as Tree,
};

/** Resolves `pdf.a.b` in a locale; plural keys count when `_one`/`_other` exist. */
function has(tree: Tree, key: string): boolean {
  const path = key.replace(/^pdf\./, '').split('.');
  let node: string | Tree | undefined = tree;
  for (let i = 0; i < path.length; i++) {
    if (node === undefined || typeof node === 'string') return false;
    const part: string = path[i]!;
    const next: string | Tree | undefined = node[part];
    if (next === undefined && i === path.length - 1) return typeof node[`${part}_other`] === 'string' && typeof node[`${part}_one`] === 'string';
    node = next;
  }
  return typeof node === 'string';
}

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)));
}

function actionsOf(control: RibbonControl): RibbonAction[] {
  switch (control.type) {
    case 'button':
    case 'toggle':
      return [control.action];
    case 'split':
      return [control.action, ...control.items.map((i) => i.action)];
    case 'menu':
      return control.items.map((i) => i.action);
    case 'combo':
      return [control.toAction('1')];
    case 'color':
      return [control.toAction(0xff0000), control.toAction(null)];
    case 'gallery':
      return control.items.map((i) => i.action);
    case 'custom':
      return [];
  }
}

const controls = pdfRibbon.tabs.flatMap((tab) => tab.groups.flatMap((g) => g.controls.map((c) => ({ tab, c }))));

describe('PDF ribbon', () => {
  it('has the Home, Annotate, Pages, Forms and View tabs', () => {
    expect(pdfRibbon.module).toBe('pdf');
    expect(pdfRibbon.tabs.map((t) => t.id)).toEqual(['home', 'annotate', 'pages', 'forms', 'view']);
  });

  it('wires every control to an implemented shell action', () => {
    for (const { c } of controls) {
      for (const action of actionsOf(c)) {
        expect(action.type, c.id).toBe('shell');
        if (action.type === 'shell') expect(typeof pdfActions[action.id], `${c.id} → ${action.id}`).toBe('function');
      }
      if (c.type === 'custom') expect(typeof c.render, c.id).toBe('function');
    }
  });

  it('uses unique, prefix-free ASCII keytips without I per tab', () => {
    const tabTips = pdfRibbon.tabs.map((t) => t.keytip);
    expect(new Set(tabTips).size).toBe(tabTips.length);
    for (const tab of pdfRibbon.tabs) {
      const tips = tab.groups.flatMap((g) => g.controls.map((c) => c.keytip)).filter((k): k is string => !!k);
      expect(new Set(tips).size, tab.id).toBe(tips.length);
      for (const tip of tips) {
        expect(tip, tab.id).toMatch(/^[A-HJ-Z0-9]{1,2}$/);
        expect(tips.some((other) => other !== tip && other.startsWith(tip)), `${tab.id}: ${tip} is a prefix`).toBe(false);
      }
    }
  });

  it('has unique control ids per tab and translated labels and tips', () => {
    for (const tab of pdfRibbon.tabs) {
      const ids = tab.groups.flatMap((g) => g.controls.map((c) => c.id));
      expect(new Set(ids).size, tab.id).toBe(ids.length);
      for (const lang of ['tr', 'en'] as const) {
        expect(has(locales[lang], tab.labelKey), `${lang} ${tab.labelKey}`).toBe(true);
        for (const g of tab.groups) {
          expect(has(locales[lang], g.labelKey), `${lang} ${g.labelKey}`).toBe(true);
          for (const c of g.controls) {
            expect(has(locales[lang], c.labelKey), `${lang} ${c.labelKey}`).toBe(true);
            if (c.tipKey) expect(has(locales[lang], c.tipKey), `${lang} ${c.tipKey}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('PDF strings', () => {
  it('has the same keys in Turkish and English', () => {
    expect(flatten(locales.tr).sort()).toEqual(flatten(locales.en).sort());
  });

  it('defines every key used by the module and every main-process error key', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(join(REPO_ROOT, 'src/renderer/modules/pdf'));
    walk(join(REPO_ROOT, 'src/main/pdf'));
    const i18nRoots = /^pdf\.(ribbon|zoom|units|colors|status|find|thumbnails|workspace|hints|busy|dialogs|notices|errors)\./;
    const used = new Set<string>();
    for (const file of files) {
      for (const m of readFileSync(file, 'utf8').matchAll(/['"`](pdf\.[A-Za-z0-9_.-]+)['"`]/g)) {
        if (i18nRoots.test(m[1]!)) used.add(m[1]!);
      }
    }
    // Keys built from template literals.
    for (const tool of ['highlight', 'freetext', 'ink', 'stamp']) used.add(`pdf.status.tool.${tool}`);
    for (const tool of ['addText', 'addImage']) {
      used.add(`pdf.status.content.${tool}`);
      used.add(`pdf.hints.${tool}`);
    }
    for (const mode of ['page-width', 'page-fit', 'page-actual', 'auto']) used.add(`pdf.zoom.${mode}`);
    for (const color of ['000000', '1d2b53', 'c0303f', '1e6b3a', '1d4f91', '8a5a00']) used.add(`pdf.colors.${color}`);
    expect(used.size).toBeGreaterThan(80);
    for (const key of used) {
      expect(has(locales.tr, key), `tr ${key}`).toBe(true);
      expect(has(locales.en, key), `en ${key}`).toBe(true);
    }
  });

  it('translates the pdf.js ids the viewer components use', () => {
    const pdfjs = locales.tr['pdfjs'] as Tree;
    for (const id of ['pdfjs-free-text2', 'pdfjs-page-landmark', 'pdfjs-editor-resizer-top-left', 'pdfjs-editor-remove-stamp-button', 'pdfjs-annotation-date-time-string']) {
      expect(pdfjs[id], id).toBeTypeOf('object');
    }
    expect((pdfjs['pdfjs-free-text2'] as Tree)['default-content']).toBe('Yazmaya başlayın…');
  });
});
