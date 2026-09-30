import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRotatingFileSink, formatLogLine, serializeMeta } from '../../../src/main/log';
import { makeTempDir, removeDir } from './helpers/tmp';

let dir: string;
beforeEach(async () => {
  dir = await makeTempDir('log');
});
afterEach(async () => {
  await removeDir(dir);
});

describe('log', () => {
  it('never serialises binary payloads, truncates long strings and cuts cycles', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    const out = JSON.parse(serializeMeta({ bytes: new Uint8Array(12345), text: 'x'.repeat(2000), cyclic, big: 10n }));
    expect(out.bytes).toBe('[12345 bytes]');
    expect(out.text.length).toBeLessThan(600);
    expect(out.cyclic.self).toBe('[Circular]');
    expect(out.big).toBe('10');
  });

  it('keeps error name, code and message', () => {
    const err = Object.assign(new Error('boom'), { code: 'EBUSY' });
    const out = JSON.parse(serializeMeta({ error: err }));
    expect(out.error).toMatchObject({ name: 'Error', message: 'boom', code: 'EBUSY' });
  });

  it('formats one line per record', () => {
    const line = formatLogLine('warn', 'main/documents', 'save failed', { docId: 'd1' }, new Date('2026-09-29T00:00:00Z'));
    expect(line).toBe('2026-09-29T00:00:00.000Z WARN  main/documents: save failed {"docId":"d1"}\n');
  });

  it('rotates by size and keeps a bounded number of files', async () => {
    const sink = createRotatingFileSink({ dir, maxBytes: 4096, maxFiles: 3, minLevel: 'debug' });
    for (let i = 0; i < 400; i++) sink.sink('info', 'test', `message ${i} ${'y'.repeat(40)}`);
    sink.close();
    const files = (await readdir(dir)).sort();
    expect(files).toEqual(['simpaper.1.log', 'simpaper.2.log', 'simpaper.log']);
    const current = await readFile(join(dir, 'simpaper.log'), 'utf8');
    expect(current).toContain('message 399');
    expect(Buffer.byteLength(current)).toBeLessThanOrEqual(4096);
  });

  it('filters by level', async () => {
    const sink = createRotatingFileSink({ dir, minLevel: 'warn' });
    sink.sink('info', 's', 'hidden');
    sink.sink('error', 's', 'shown');
    sink.close();
    const text = await readFile(sink.path, 'utf8');
    expect(text).not.toContain('hidden');
    expect(text).toContain('shown');
  });
});
