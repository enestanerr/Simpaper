/**
 * Read-only queries of Windows' file associations: which program opens a file type (AssocQueryStringW, which honours
 * the user's choice) and whether the installer registered Simpaper for Settings › Apps › Default apps. Nothing here
 * writes to the registry: only Windows' own UI may change a default app (docs/adr/0010-file-associations.md).
 * Every call runs on a koffi worker thread.
 */
import type { AssociationHandler, AssociationQuery } from '../types';
import { callAsync, type Win32Api } from './ffi';

export type AssociationApi = { shlwapi: Win32Api['shlwapi']; advapi32: Win32Api['advapi32'] };

const ASSOCF_NONE = 0;
const ASSOCSTR_EXECUTABLE = 2;
const ASSOCSTR_PROGID = 20;
/** Predefined registry keys (sign-extended handle values of winreg.h). */
const HKEY_CURRENT_USER = 0xffff_ffff_8000_0001n;
const HKEY_LOCAL_MACHINE = 0xffff_ffff_8000_0002n;
const RRF_RT_ANY = 0x0000_ffff;
const ERROR_SUCCESS = 0;
/** Characters for one answer; longer answers (paths beyond 32 K do not exist here) count as none. */
const BUFFER_CHARS = 2048;
const REGISTERED_APPLICATIONS = 'Software\\RegisteredApplications';

export function createAssociationQuery(api: AssociationApi): AssociationQuery {
  const query = async (str: number, assoc: string): Promise<string | null> => {
    try {
      const out = new Uint16Array(BUFFER_CHARS);
      const chars = [BUFFER_CHARS];
      const hr = await callAsync(api.shlwapi.AssocQueryStringW, ASSOCF_NONE, str, assoc, null, out, chars);
      if (hr !== 0) return null; // S_FALSE (no buffer), ERROR_NO_ASSOCIATION, E_POINTER (too long) …
      const length = Math.max(0, Math.min(BUFFER_CHARS, chars[0] ?? 0) - 1); // the count includes the terminator
      const text = String.fromCharCode(...out.subarray(0, length)).replace(/\0.*$/s, '');
      return text === '' ? null : text;
    } catch {
      return null;
    }
  };
  const hasValue = async (hive: bigint, name: string): Promise<boolean> => {
    try {
      const bytes = [0];
      return (await callAsync(api.advapi32.RegGetValueW, hive, REGISTERED_APPLICATIONS, name, RRF_RT_ANY, null, null, bytes)) === ERROR_SUCCESS;
    } catch {
      return false;
    }
  };
  return {
    async handler(assoc: string): Promise<AssociationHandler> {
      const [executable, progId] = await Promise.all([query(ASSOCSTR_EXECUTABLE, assoc), query(ASSOCSTR_PROGID, assoc)]);
      return { executable, progId };
    },
    async registeredApp(name: string) {
      if (await hasValue(HKEY_CURRENT_USER, name)) return 'user';
      if (await hasValue(HKEY_LOCAL_MACHINE, name)) return 'machine';
      return null;
    },
  };
}
