/** Every errors.* / compat.* key the main process emits must exist in both Turkish and English. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CompatFinding } from '@shared/api/documents';
import { FORMATS } from '@shared/formats';
import { FINDING_RULES } from '../../../src/main/compat/findings';

const root = resolve(process.cwd());
const load = (lang: string, ns: string) => JSON.parse(readFileSync(join(root, 'src/renderer/i18n/locales', lang, `${ns}.json`), 'utf8')) as Record<string, unknown>;

function lookup(tree: Record<string, unknown>, path: string[]): unknown {
  let node: unknown = tree;
  for (const p of path) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[p];
  }
  return node;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const OWN_DIRS = ['app', 'compat', 'documents', 'files', 'ipc', 'pdf', 'recovery', 'settings'].map((d) => join(root, 'src/main', d));

function keysUsedInCode(): Set<string> {
  const keys = new Set<string>();
  for (const file of OWN_DIRS.flatMap(sourceFiles)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/'((?:errors|compat)\.[A-Za-z0-9.]+)'/g)) if (m[1]) keys.add(m[1]);
  }
  for (const id of Object.keys(FINDING_RULES) as CompatFinding['id'][]) keys.add(`compat.finding.${id}`);
  for (const f of FORMATS) for (const k of f.knownLosses ?? []) keys.add(k);
  return keys;
}

describe('main-process i18n keys', () => {
  const keys = [...keysUsedInCode()].sort();

  it('finds the keys', () => {
    expect(keys.length).toBeGreaterThan(60);
  });

  for (const lang of ['tr', 'en']) {
    it(`all keys exist in ${lang}`, () => {
      const missing = keys.filter((k) => {
        const [ns, ...path] = k.split('.');
        return typeof lookup(load(lang, ns as string), path) !== 'string';
      });
      expect(missing).toEqual([]);
    });
  }

  it('Turkish and English files have the same structure', () => {
    const flatten = (tree: unknown, prefix = ''): string[] =>
      tree && typeof tree === 'object' ? Object.entries(tree as Record<string, unknown>).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)) : [prefix];
    for (const ns of ['compat', 'errors']) expect(flatten(load('tr', ns)).sort()).toEqual(flatten(load('en', ns)).sort());
  });
});
