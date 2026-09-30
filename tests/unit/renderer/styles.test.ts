/**
 * Stylesheet rules that jsdom cannot evaluate; scripts/gui/checks/themecheck.mjs measures the result in the real
 * renderer. A custom property resolves var() on the element that declares it, so the accent-derived tokens have to
 * be declared where a module sets --accent (declared on :root alone they resolved to nothing: Options page of the
 * installed app, 2026-09-30).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../tools/paths';

interface Rule {
  selectors: string[];
  body: string;
}

/** The style rules of a stylesheet, also those inside at-rules (whose heads are skipped). */
function rules(file: string): Rule[] {
  const css = readFileSync(join(REPO_ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1]!.split(',').map((s) => s.trim()), body: m[2]! }));
}
const declares = (rule: Rule, prop: string) => new RegExp(`(?:^|[;\\s])${prop}\\s*:`).test(rule.body);

describe('theme tokens', () => {
  const tokens = rules('src/renderer/theme/tokens.css');

  it('declares the accent-derived tokens on the elements that carry the module accent', () => {
    for (const token of ['--accent-text', '--accent-soft', '--accent-softer']) {
      const declaring = tokens.filter((r) => declares(r, token));
      expect(declaring.length, token).toBeGreaterThan(0);
      for (const r of declaring) expect(r.selectors.some((s) => s.includes('[data-module]')), `${token} in ${r.selectors.join(', ')}`).toBe(true);
    }
  });

  it('gives :root an accent as well, for what renders before the shell sets a module', () => {
    for (const token of ['--accent', '--accent-text', '--accent-soft', '--accent-softer']) {
      expect(tokens.some((r) => r.selectors.includes(':root') && declares(r, token)), token).toBe(true);
    }
  });
});

describe('checkbox fields', () => {
  it('keep the box beside the label although .vr-field stacks its children', () => {
    const popups = rules('src/renderer/styles/popups.css');
    expect(popups.find((r) => r.selectors.includes('.vr-field'))?.body).toMatch(/flex-direction:\s*column/);
    expect(popups.find((r) => r.selectors.includes('.vr-field.vr-checkbox'))?.body).toMatch(/flex-direction:\s*row/);
  });
});
