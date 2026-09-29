import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SAMPLES, SOURCES, renderDocs, verify } from '../../../scripts/corpus/third-party.mjs';
import { CORPUS_OUTPUT, THIRD_PARTY_DIR } from '../../tools/paths';

// Offline provenance checks of the vendored corpus (tests/corpus/third_party): no network access.

describe('vendored third-party corpus', () => {
  it('matches the pinned SHA-256 of every sample and licence file, has no unpinned file and up-to-date docs', () => {
    expect(verify()).toEqual([]);
  });

  it('pins every sample to a commit URL, a licence and what it exercises; every source ships its licence files', () => {
    const { attributions } = renderDocs();
    for (const [key, source] of Object.entries(SOURCES)) {
      expect(source.base, key).toMatch(new RegExp(`^https://raw\\.githubusercontent\\.com/.+/${source.commit}/$`));
      expect(source.license, key).toMatch(/^(Apache-2\.0|MIT|CC0-1\.0|CC-BY-4\.0|BSD-[23]-Clause)$/);
      expect(source.legal.length, `${key} licence files`).toBeGreaterThan(0);
    }
    for (const s of SAMPLES) {
      const source = SOURCES[s.source];
      expect(source, s.id).toBeDefined();
      expect(s.sha256, s.id).toMatch(/^[0-9a-f]{64}$/);
      expect(s.exercises.length, `${s.id} exercises`).toBeGreaterThan(10);
      // The attribution row carries the pinned URL and the licence.
      const row = attributions[s.source]!.split('\n').find((l) => l.startsWith(`| \`${s.file}\` |`));
      expect(row, `${s.id} row in ${s.source}/ATTRIBUTION.md`).toBeDefined();
      expect(row).toContain(`(${source!.base}${s.path})`);
      expect(row).toContain(`| ${source!.license} |`);
    }
    expect(new Set(SAMPLES.map((s) => s.id)).size).toBe(SAMPLES.length);
  });

  describe('verify() reports problems', () => {
    mkdirSync(CORPUS_OUTPUT, { recursive: true });
    const tmp = mkdtempSync(join(CORPUS_OUTPUT, 'unit-third-party-'));
    afterAll(() => rmSync(tmp, { recursive: true, force: true }));

    it('for unpinned files, unknown folders, changed samples and stale docs', () => {
      const copy = join(tmp, 'third_party');
      cpSync(THIRD_PARTY_DIR, copy, { recursive: true });
      expect(verify(copy)).toEqual([]);
      const first = SAMPLES[0]!;
      writeFileSync(join(copy, first.source, 'extra.docx'), 'x');
      mkdirSync(join(copy, 'somewhere-else'));
      writeFileSync(join(copy, first.source, first.file), 'changed');
      writeFileSync(join(copy, first.source, 'ATTRIBUTION.md'), '# edited by hand\n');
      const problems = verify(copy);
      expect(problems).toEqual(
        expect.arrayContaining([
          `unpinned file ${first.source}/extra.docx (add it to SAMPLES with its URL, SHA-256 and what it exercises)`,
          expect.stringMatching(/^unknown source folder somewhere-else/),
          `hash mismatch ${first.source}/${first.file}`,
          expect.stringMatching(new RegExp(`^${first.source}/ATTRIBUTION\\.md is out of date`)),
        ]),
      );
      expect(problems).toHaveLength(4);
    });
  });
});
