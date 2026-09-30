import { renameSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSafeWriter, SafeWriteError, siblingName, STALE_SIBLING, type SafeWriteFs } from '../../../src/main/files/safeWrite';
import { WIN32, type NativeReplace } from '../../../src/main/files/win32Replace';
import { makeTempDir, removeDir } from './helpers/tmp';

const ORIGINAL = Buffer.from('original bytes — do not lose');

let dir: string;
let target: string;

beforeEach(async () => {
  dir = await makeTempDir('safewrite');
  target = join(dir, 'Rapor.docx');
  await writeFile(target, ORIGINAL);
});

afterEach(async () => {
  await removeDir(dir);
});

async function leftovers(): Promise<string[]> {
  return (await readdir(dir)).filter((n) => n !== 'Rapor.docx');
}

async function expectOriginalIntact(): Promise<void> {
  expect(Buffer.compare(await readFile(target), ORIGINAL)).toBe(0);
  expect(await leftovers()).toEqual([]);
}

const writeNew = (content = 'new content') => async (tmp: string) => {
  await writeFile(tmp, content);
};

describe('SafeWriter', () => {
  it('replaces the target and leaves no temp files', async () => {
    const safeWrite = createSafeWriter();
    await safeWrite(target, writeNew());
    expect(await readFile(target, 'utf8')).toBe('new content');
    expect(await leftovers()).toEqual([]);
  });

  it('writes a new file when the target does not exist yet', async () => {
    const safeWrite = createSafeWriter();
    const fresh = join(dir, 'Yeni Belge.xlsx');
    await safeWrite(fresh, writeNew('fresh'));
    expect(await readFile(fresh, 'utf8')).toBe('fresh');
    expect((await readdir(dir)).sort()).toEqual(['Rapor.docx', 'Yeni Belge.xlsx']);
  });

  it('uses a hidden temp sibling in the same folder', async () => {
    const safeWrite = createSafeWriter();
    let seen = '';
    await safeWrite(target, async (tmp) => {
      seen = tmp;
      await writeFile(tmp, 'x');
    });
    expect(seen.startsWith(dir)).toBe(true);
    expect(STALE_SIBLING.test(seen.slice(dir.length + 1))).toBe(true);
    expect(siblingName(target, 'abcdefabcdef', 'tmp')).toBe(join(dir, '.~simpaper-abcdefabcdef-Rapor.docx.tmp'));
    // Leftovers of development builds from before the rename are cleaned up too; nothing else is.
    expect(STALE_SIBLING.test('.~varak-abcdefabcdef-Rapor.docx.bak')).toBe(true);
    expect(STALE_SIBLING.test('.~varak-abcdef-Rapor.docx.bak')).toBe(false);
    expect(STALE_SIBLING.test('~simpaper-abcdefabcdef-Rapor.docx.tmp')).toBe(false);
    expect(STALE_SIBLING.test('.~simpaper-abcdefabcdef-Rapor.docx')).toBe(false);
  });

  it('fault: write step fails → original unchanged, temp removed', async () => {
    const safeWrite = createSafeWriter();
    const err = await safeWrite(target, async (tmp) => {
      await writeFile(tmp, 'partial');
      throw new Error('engine crashed while storing');
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SafeWriteError);
    expect((err as SafeWriteError).stage).toBe('write');
    await expectOriginalIntact();
  });

  it('fault: writer produces no file → write error', async () => {
    const safeWrite = createSafeWriter();
    const err = (await safeWrite(target, async () => undefined).catch((e: unknown) => e)) as SafeWriteError;
    expect(err.stage).toBe('write');
    await expectOriginalIntact();
  });

  it('fault: fsync fails → original unchanged, temp removed', async () => {
    const fs: Partial<SafeWriteFs> = {
      open: async (p, flags) => {
        const fsp = await import('node:fs/promises');
        const handle = await fsp.open(p, flags);
        if (flags === 'r+') {
          return {
            sync: async () => {
              throw Object.assign(new Error('EIO'), { code: 'EIO' });
            },
            close: () => handle.close(),
          };
        }
        return handle;
      },
    };
    const safeWrite = createSafeWriter({ fs });
    const err = (await safeWrite(target, writeNew()).catch((e: unknown) => e)) as SafeWriteError;
    expect(err.stage).toBe('flush');
    expect(err.code).toBe('EIO');
    await expectOriginalIntact();
  });

  it('fault: verification fails → original unchanged, temp removed', async () => {
    const safeWrite = createSafeWriter();
    const err = (await safeWrite(target, writeNew('corrupt'), {
      verify: async (tmp) => {
        expect(await readFile(tmp, 'utf8')).toBe('corrupt');
        throw new Error('zip central directory missing');
      },
    }).catch((e: unknown) => e)) as SafeWriteError;
    expect(err.stage).toBe('verify');
    await expectOriginalIntact();
  });

  it('fault: replace fails permanently → original unchanged, temp removed', async () => {
    const native: NativeReplace = { replace: () => ({ ok: false, win32Error: 1234 }) };
    const safeWrite = createSafeWriter({ nativeReplace: native });
    const err = (await safeWrite(target, writeNew()).catch((e: unknown) => e)) as SafeWriteError;
    expect(err.stage).toBe('replace');
    expect(err.code).toBe('WIN32_1234');
    await expectOriginalIntact();
  });

  it('fault: rename fallback fails → original unchanged, temp removed', async () => {
    const safeWrite = createSafeWriter({
      nativeReplace: null,
      retry: { attempts: 3, baseDelayMs: 1 },
      fs: {
        rename: async () => {
          throw Object.assign(new Error('denied'), { code: 'EACCES' });
        },
      },
    });
    const err = (await safeWrite(target, writeNew()).catch((e: unknown) => e)) as SafeWriteError;
    expect(err.stage).toBe('replace');
    expect(err.code).toBe('EACCES');
    await expectOriginalIntact();
  });

  it('retries transient sharing violations with backoff, then succeeds', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const native: NativeReplace = {
      replace: (t, r, b) => {
        attempts++;
        if (attempts < 3) return { ok: false, win32Error: WIN32.SHARING_VIOLATION };
        // Emulate ReplaceFileW: original → backup, replacement → target.
        renameSync(t, b);
        renameSync(r, t);
        return { ok: true, win32Error: 0 };
      },
    };
    const safeWrite = createSafeWriter({ nativeReplace: native, sleep: async (ms) => void delays.push(ms), retry: { attempts: 5, baseDelayMs: 10, maxDelayMs: 1000 } });
    await safeWrite(target, writeNew('after retry'));
    expect(attempts).toBe(3);
    expect(delays).toEqual([10, 20]);
    expect(await readFile(target, 'utf8')).toBe('after retry');
    expect(await leftovers()).toEqual([]);
  });

  it('puts the original back when ReplaceFileW moved it to the backup but could not finish', async () => {
    const native: NativeReplace = {
      replace: (t, _r, b) => {
        renameSync(t, b);
        return { ok: false, win32Error: WIN32.UNABLE_TO_MOVE_REPLACEMENT_2 };
      },
    };
    const safeWrite = createSafeWriter({ nativeReplace: native, retry: { attempts: 1 } });
    const err = (await safeWrite(target, writeNew()).catch((e: unknown) => e)) as SafeWriteError;
    expect(err.stage).toBe('replace');
    expect(err.code).toBe('EBUSY');
    await expectOriginalIntact();
  });

  it('keeps <name>.bak when asked', async () => {
    const safeWrite = createSafeWriter();
    await safeWrite(target, writeNew('v2'), { keepBackup: true });
    expect(await readFile(target, 'utf8')).toBe('v2');
    expect(Buffer.compare(await readFile(`${target}.bak`), ORIGINAL)).toBe(0);
  });

  it('reports an unwritable folder at the prepare stage', async () => {
    const safeWrite = createSafeWriter();
    const err = (await safeWrite(join(dir, 'missing-folder', 'x.docx'), writeNew()).catch((e: unknown) => e)) as SafeWriteError;
    expect(err.stage).toBe('prepare');
    expect(err.code).toBe('ENOENT');
    await expectOriginalIntact();
  });

  it.runIf(process.platform === 'win32')('replaces through the real ReplaceFileW (koffi)', async () => {
    const { loadNativeReplace } = await import('../../../src/main/files/win32Replace');
    expect(loadNativeReplace()).not.toBeNull();
    const safeWrite = createSafeWriter();
    for (let i = 0; i < 3; i++) await safeWrite(target, writeNew(`round ${i}`));
    expect(await readFile(target, 'utf8')).toBe('round 2');
    expect(await leftovers()).toEqual([]);
  });
});
