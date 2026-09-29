/**
 * The bundled pdf.js resource loader (import.meta.glob data: URLs) through Vite's transform pipeline.
 * (.tsx: tests importing renderer modules stay out of tsconfig.node.json, whose composite project cannot include
 * src/renderer; they are type-checked with tests/unit/pdf/tsconfig.renderer-tests.json.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANNOTATION_ICONS, BundledBinaryDataFactory, dataUrlToBytes } from '../../../src/renderer/modules/pdf/pdfjs/resources';
import { REPO_ROOT } from './helpers';

const PDFJS = join(REPO_ROOT, 'node_modules/pdfjs-dist');

describe('bundled pdf.js resources', () => {
  const factory = new BundledBinaryDataFactory({});

  it('serves CMaps, standard fonts and WASM decoders byte-identical to pdfjs-dist', async () => {
    for (const [kind, dir, filename] of [
      ['cMapUrl', 'cmaps', 'UniJIS-UTF16-H.bcmap'],
      ['cMapUrl', 'cmaps', '78-EUC-H.bcmap'],
      ['standardFontDataUrl', 'standard_fonts', 'FoxitSymbol.pfb'],
      ['standardFontDataUrl', 'standard_fonts', 'LiberationSans-Regular.ttf'],
      ['wasmUrl', 'wasm', 'jbig2.wasm'],
      ['wasmUrl', 'wasm', 'openjpeg.wasm'],
    ] as const) {
      const bytes = await factory.fetch({ kind, filename });
      expect(Buffer.from(bytes).equals(readFileSync(join(PDFJS, dir, filename))), filename).toBe(true);
    }
  });

  it('rejects resources that are not bundled', async () => {
    await expect(factory.fetch({ kind: 'wasmUrl', filename: 'quickjs-eval.wasm' })).rejects.toThrow('not bundled');
    await expect(factory.fetch({ kind: 'cMapUrl', filename: '../../secret' })).rejects.toThrow('not bundled');
  });

  it('knows the annotation icons and decodes data URLs', () => {
    expect(ANNOTATION_ICONS.has('annotation-note.svg')).toBe(true);
    expect(ANNOTATION_ICONS.has('annotation-comment.svg')).toBe(true);
    expect([...dataUrlToBytes('data:application/octet-stream;base64,AAEC/w==')]).toEqual([0, 1, 2, 255]);
    expect(new TextDecoder().decode(dataUrlToBytes('data:text/plain,a%20b'))).toBe('a b');
  });
});
