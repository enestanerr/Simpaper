/**
 * The Win32 association query with scripted shlwapi/advapi32 functions (no registry access): how answers, missing
 * associations and failures are turned into handlers, and where the registered-app lookup looks.
 */
import { describe, expect, it } from 'vitest';
import { createAssociationQuery, type AssociationApi } from '../../../src/main/platform/win32/associations';

const ASSOCSTR_EXECUTABLE = 2;
const ASSOCSTR_PROGID = 20;
const HKCU = 0xffff_ffff_8000_0001n;
const HKLM = 0xffff_ffff_8000_0002n;

/** `.async` variants call back like koffi's worker-thread calls. */
function asyncFn<A extends unknown[]>(impl: (...args: A) => number) {
  return Object.assign(impl, {
    async: (...args: unknown[]) => {
      const done = args.pop() as (err: unknown, result: number) => void;
      setTimeout(() => {
        try {
          done(null, impl(...(args as A)));
        } catch (err) {
          done(err, 0);
        }
      }, 0);
    },
  });
}

function fakeApi(answers: Record<string, Partial<Record<number, string | number>>>, registry: { hive: bigint; name: string }[] = []) {
  const regCalls: string[] = [];
  const api = {
    shlwapi: {
      AssocQueryStringW: asyncFn((_flags: number, str: number, assoc: string, _extra: string | null, out: Uint16Array, chars: number[]) => {
        const a = answers[assoc]?.[str];
        if (a === undefined) return 0x80070483 | 0; // HRESULT_FROM_WIN32(ERROR_NO_ASSOCIATION)
        if (typeof a === 'number') return a;
        if (a === 'throw') throw new Error('ffi failure');
        for (let i = 0; i < a.length; i++) out[i] = a.charCodeAt(i);
        out[a.length] = 0;
        chars[0] = a.length + 1;
        return 0;
      }),
    },
    advapi32: {
      RegGetValueW: asyncFn((hive: bigint, key: string, name: string) => {
        regCalls.push(`${hive === HKCU ? 'HKCU' : hive === HKLM ? 'HKLM' : String(hive)}\\${key}\\${name}`);
        return registry.some((r) => r.hive === hive && r.name === name) ? 0 : 2;
      }),
    },
  } as unknown as AssociationApi;
  return { api, regCalls };
}

describe('Win32 association query', () => {
  it('returns the program and ProgID Windows uses, or nulls where there is none', async () => {
    const exe = 'C:\\Users\\Çağrı\\AppData\\Local\\Programs\\Simpaper\\Simpaper.exe';
    const { api } = fakeApi({
      '.docx': { [ASSOCSTR_EXECUTABLE]: exe, [ASSOCSTR_PROGID]: 'Simpaper.docx' },
      // An app package: no executable, only its ProgID
      '.pptx': { [ASSOCSTR_PROGID]: 'AppXxeytm64t4nfhcrtsxdzn61qc2fqm9c2w' },
      '.odt': { [ASSOCSTR_EXECUTABLE]: 0x80004003 | 0, [ASSOCSTR_PROGID]: 'throw' },
    });
    const q = createAssociationQuery(api);
    expect(await q.handler('.docx')).toEqual({ executable: exe, progId: 'Simpaper.docx' });
    expect(await q.handler('.pptx')).toEqual({ executable: null, progId: 'AppXxeytm64t4nfhcrtsxdzn61qc2fqm9c2w' });
    expect(await q.handler('.odt')).toEqual({ executable: null, progId: null });
    expect(await q.handler('.xyz')).toEqual({ executable: null, progId: null });
  });

  it('finds the Default apps registration for the current user first, then for all users', async () => {
    const user = fakeApi({}, [{ hive: HKCU, name: 'Simpaper' }]);
    expect(await createAssociationQuery(user.api).registeredApp('Simpaper')).toBe('user');
    expect(user.regCalls).toEqual(['HKCU\\Software\\RegisteredApplications\\Simpaper']);

    const machine = fakeApi({}, [{ hive: HKLM, name: 'Simpaper' }]);
    expect(await createAssociationQuery(machine.api).registeredApp('Simpaper')).toBe('machine');
    expect(machine.regCalls).toEqual(['HKCU\\Software\\RegisteredApplications\\Simpaper', 'HKLM\\Software\\RegisteredApplications\\Simpaper']);

    expect(await createAssociationQuery(fakeApi({}).api).registeredApp('Simpaper')).toBeNull();
  });
});
