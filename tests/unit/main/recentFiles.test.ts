import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecentFilesStore } from '../../../src/main/documents/recentFiles';
import { createSafeWriter } from '../../../src/main/files/safeWrite';
import { makeTempDir, removeDir } from './helpers/tmp';

let dir: string;
let file: string;
const safeWrite = createSafeWriter();

beforeEach(async () => {
  dir = await makeTempDir('recent');
  file = join(dir, 'recent.json');
});
afterEach(async () => {
  await removeDir(dir);
});

describe('RecentFilesStore', () => {
  it('keeps the most recent first, deduplicated and bounded', async () => {
    let limit = 3;
    let t = 0;
    const store = new RecentFilesStore({ file, safeWrite, limit: () => limit, now: () => new Date(Date.UTC(2026, 8, 29, 10, 0, t++)) });
    for (const n of ['a', 'b', 'c', 'd']) await store.add(join(dir, `${n}.docx`), 'writer', 'docx');
    await store.add(join(dir, 'b.docx'), 'writer', 'docx');
    const list = await store.list();
    expect(list.map((r) => r.title)).toEqual(['b.docx', 'd.docx', 'c.docx']);
    limit = 2;
    await store.trim();
    expect((await store.list()).map((r) => r.title)).toEqual(['b.docx', 'd.docx']);
  });

  it.runIf(process.platform === 'win32')('treats paths case-insensitively on Windows', async () => {
    const store = new RecentFilesStore({ file, safeWrite, limit: () => 10 });
    await store.add(join(dir, 'Rapor.DOCX'), 'writer', 'docx');
    await store.add(join(dir, 'rapor.docx'), 'writer', 'docx');
    expect(await store.list()).toHaveLength(1);
  });

  it('checks existence on every listing', async () => {
    const existing = join(dir, 'var.xlsx');
    await writeFile(existing, 'x');
    const store = new RecentFilesStore({ file, safeWrite, limit: () => 10 });
    await store.add(existing, 'calc', 'xlsx');
    await store.add(join(dir, 'yok.pptx'), 'impress', 'pptx');
    const list = await store.list();
    expect(list.find((r) => r.format === 'xlsx')?.exists).toBe(true);
    expect(list.find((r) => r.format === 'pptx')?.exists).toBe(false);
  });

  it('counts an unanswered existence check (offline share) as existing', async () => {
    const store = new RecentFilesStore({ file, safeWrite, limit: () => 10, exists: () => new Promise(() => undefined), existsTimeoutMs: 20 });
    await store.add(join(dir, 'net.docx'), 'writer', 'docx');
    expect((await store.list())[0]?.exists).toBe(true);
  });

  it('persists and reloads, dropping invalid entries', async () => {
    const store = new RecentFilesStore({ file, safeWrite, limit: () => 10 });
    await store.add(join(dir, 'a.pdf'), 'pdf', 'pdf');
    const raw = JSON.parse(await readFile(file, 'utf8'));
    raw.items.push({ path: 'relative.docx', title: 'x', kind: 'writer', format: 'docx', openedAt: new Date().toISOString() });
    raw.items.push({ path: join(dir, 'b.docx'), title: 'x', kind: 'writer', format: 'exe', openedAt: new Date().toISOString() });
    await writeFile(file, JSON.stringify(raw));
    const reloaded = new RecentFilesStore({ file, safeWrite, limit: () => 10 });
    const list = await reloaded.list();
    expect(list.map((r) => r.format)).toEqual(['pdf']);
  });

  it('ignores an unreadable list', async () => {
    await writeFile(file, 'garbage');
    const store = new RecentFilesStore({ file, safeWrite, limit: () => 10 });
    expect(await store.list()).toEqual([]);
  });
});
