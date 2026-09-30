#!/usr/bin/env node
/**
 * Checks the registry work of build/installer.nsh (file types, file-type icons, Default apps registration) without
 * touching the real file associations of this computer:
 *
 *  1. compiles a small installer around the include's install and uninstall macros with electron-builder's makensis,
 *     the way electron-builder compiles the include (-WX, UTF-8 input, APP_EXECUTABLE_FILENAME defined only after
 *     the include), with every registry location moved below HKCU\Software\SimpaperInstallerCheck;
 *  2. runs silently: install in Turkish, an update's uninstall (--updated), install in English as a switch to
 *     "all users" (the per-user clean-up path; the registry root stays the current user here), and the real
 *     uninstall. After each run it compares every value with the table in build/installer.nsh (which
 *     tests/unit/main/fileAssociations.test.ts keeps in step with src/shared/fileAssociations.ts) and the complete
 *     list of keys and values below the scratch key with the expected one;
 *  3. removes the scratch key and the temporary files.
 *
 * Not covered here: the finish page and the machine-wide (HKLM) root, which only the real build compiles
 * (`npm run dist:win`) and a real installation exercises. Only the choice "take the extension's default or not"
 * depends on this computer: it reads the real HKCR, as the installer does. Nothing is shown on screen.
 *
 * Usage: node scripts/installer/check-associations.mjs
 * Needs makensis from electron-builder's cache (run `npm run dist:win` once) or SIMPAPER_MAKENSIS=<makensis.exe>.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const includeFile = path.join(repoRoot, 'build', 'installer.nsh');
const SCRATCH = 'Software\\SimpaperInstallerCheck';
const HKCR = 0xffff_ffff_8000_0000n;
const HKCU = 0xffff_ffff_8000_0001n;
const REG_NONE = 0;
const REG_SZ = 1;

/** appId and productName from electron-builder.yml (the unit tests compare them with src/shared/brand.ts). */
function builderIdentity() {
  const yml = readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf8');
  const field = (name) => {
    const m = new RegExp(`^${name}:\\s*(\\S+)\\s*$`, 'm').exec(yml);
    if (!m) throw new Error(`electron-builder.yml: ${name} not found`);
    return m[1];
  };
  return { appId: field('appId'), exe: `${field('productName')}.exe` };
}

/** The SP_FILE_TYPES table: ProgID, extension, icon, claim, English and Turkish type names. */
export function parseFileTypes(nsh) {
  const rows = [];
  for (const line of nsh.split(/\r?\n/)) {
    const m = /^\s*!insertmacro \$\{OP\}\s+(\S+)\s+(\S+)\s+(\S+)\s+([01])\s+"([^"]*)"\s+"([^"]*)"\s*$/.exec(line);
    if (m) rows.push({ progId: m[1], ext: m[2], icon: m[3], claim: m[4] === '1', en: m[5], tr: m[6] });
  }
  return rows;
}

function findMakensis() {
  if (process.env.SIMPAPER_MAKENSIS) return process.env.SIMPAPER_MAKENSIS;
  const cache = process.env.ELECTRON_BUILDER_CACHE ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'electron-builder', 'Cache');
  if (!existsSync(cache)) return null;
  for (const dir of readdirSync(cache).filter((d) => /^nsis-\d/.test(d))) {
    for (const sub of readdirSync(path.join(cache, dir))) {
      const exe = path.join(cache, dir, sub, 'makensis.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

/** Registry reads (Unicode-safe, unlike reg.exe's console output) and the scratch-key clean-up, through koffi. */
export function registry() {
  const koffi = createRequire(import.meta.url)('koffi');
  const advapi32 = koffi.load('advapi32.dll');
  const P = 'void *';
  const u32 = koffi.inout(koffi.pointer('uint32'));
  const RegGetValueW = advapi32.func('__stdcall', 'RegGetValueW', 'int32', [P, 'str16', 'str16', 'uint32', koffi.out(koffi.pointer('uint32')), P, u32]);
  const RegOpenKeyExW = advapi32.func('__stdcall', 'RegOpenKeyExW', 'int32', [P, 'str16', 'uint32', 'uint32', koffi.out(koffi.pointer(P))]);
  const RegEnumKeyExW = advapi32.func('__stdcall', 'RegEnumKeyExW', 'int32', [P, 'uint32', P, u32, P, P, P, P]);
  const RegEnumValueW = advapi32.func('__stdcall', 'RegEnumValueW', 'int32', [P, 'uint32', P, u32, P, P, P, P]);
  const RegCloseKey = advapi32.func('__stdcall', 'RegCloseKey', 'int32', [P]);
  const RegDeleteTreeW = advapi32.func('__stdcall', 'RegDeleteTreeW', 'int32', [P, 'str16']);
  const KEY_READ = 0x20019;
  const ERROR_NO_MORE_ITEMS = 259;
  const open = (hive, key) => {
    const handle = [null];
    return RegOpenKeyExW(hive, key, 0, KEY_READ, handle) === 0 ? handle[0] : null;
  };
  /** Subkey or value names of an open key (enumerate = RegEnumKeyExW or RegEnumValueW). */
  const names = (handle, enumerate) => {
    const out = [];
    const buf = new Uint16Array(16384);
    for (let i = 0; ; i++) {
      const chars = [buf.length];
      const rc = enumerate(handle, i, buf, chars, null, null, null, null);
      if (rc === ERROR_NO_MORE_ITEMS) return out;
      if (rc !== 0) throw new Error(`registry enumeration failed: ${rc}`);
      out.push(String.fromCharCode(...buf.subarray(0, chars[0])));
    }
  };
  return {
    /** { type, text } of a value ('' = the default value), or null when the key or value is missing. */
    value(hive, key, name) {
      const type = [0];
      const buf = new Uint16Array(4096);
      const bytes = [buf.byteLength];
      const rc = RegGetValueW(hive, key, name, 0x0000ffff, type, buf, bytes);
      if (rc !== 0) return null;
      const chars = Math.max(0, Math.floor(bytes[0] / 2) - (type[0] === REG_SZ ? 1 : 0));
      return { type: type[0], text: type[0] === REG_SZ ? String.fromCharCode(...buf.subarray(0, chars)) : '' };
    },
    keyExists(hive, key) {
      const handle = open(hive, key);
      if (handle === null) return false;
      RegCloseKey(handle);
      return true;
    },
    /** Every key below `key` (relative path, '' = `key` itself) with the sorted names of its values. */
    tree(hive, key) {
      const result = new Map();
      const walk = (rel) => {
        const handle = open(hive, rel ? `${key}\\${rel}` : key);
        if (handle === null) return;
        try {
          result.set(rel, names(handle, RegEnumValueW).sort());
          for (const sub of names(handle, RegEnumKeyExW)) walk(rel ? `${rel}\\${sub}` : sub);
        } finally {
          RegCloseKey(handle);
        }
      };
      walk('');
      return result;
    },
    deleteTree(hive, key) {
      const rc = RegDeleteTreeW(hive, key);
      if (rc !== 0 && rc !== 2) throw new Error(`RegDeleteTreeW ${key}: ${rc}`);
    },
  };
}

function harness({ appId, exe, installDir, outFile }) {
  return `Unicode true
!include FileFunc.nsh
!include LogicLib.nsh
; electron-builder passes APP_ID on the command line and defines APP_EXECUTABLE_FILENAME only after the include.
!define APP_ID "${appId}"
!define SP_CLASSES "${SCRATCH}\\Classes"
!define SP_REGISTERED_APPS "${SCRATCH}\\RegisteredApplications"
!define SP_APP_KEY "${SCRATCH}\\Simpaper"
; electron-builder's isUpdated: the --updated switch of an update's uninstaller run.
!macro _isUpdated _a _b _t _f
  \${GetParameters} $R9
  ClearErrors
  \${GetOptions} $R9 "--updated" $R8
  IfErrors \`\${_f}\` \`\${_t}\`
!macroend
!define isUpdated \`"" isUpdated ""\`
; multiUser.nsh's install mode ("all" or "CurrentUser").
Var installMode
!include "${includeFile}"
!define APP_EXECUTABLE_FILENAME "${exe}"
LoadLanguageFile "\${NSISDIR}\\Contrib\\Language files\\English.nlf"
LoadLanguageFile "\${NSISDIR}\\Contrib\\Language files\\Turkish.nlf"
Name "Simpaper association check"
OutFile "${outFile}"
InstallDir "${installDir}"
RequestExecutionLevel user
SilentInstall silent
Function .onInit
  SetShellVarContext current
  StrCpy $installMode "CurrentUser"
  \${GetParameters} $R9
  ClearErrors
  \${GetOptions} $R9 "--lang=" $R8
  \${IfNot} \${Errors}
    StrCpy $LANGUAGE $R8
  \${EndIf}
  ClearErrors
  \${GetOptions} $R9 "--mode=" $R8
  \${IfNot} \${Errors}
    StrCpy $installMode $R8
  \${EndIf}
FunctionEnd
Section
  \${GetParameters} $R9
  ClearErrors
  \${GetOptions} $R9 "--uninstall" $R8
  \${If} \${Errors}
    !insertmacro customInstall
  \${Else}
    !insertmacro customUnInstall
  \${EndIf}
SectionEnd
`;
}

/** Differences between two key trees (relative key path -> value names). */
function treeDiff(actual, expected) {
  const out = [];
  for (const [key, values] of expected) {
    if (!actual.has(key)) out.push(`missing key ${key || '(scratch root)'}`);
    else if (actual.get(key).join('|') !== values.join('|')) out.push(`values of ${key || '(scratch root)'}: [${actual.get(key).join(', ')}], expected [${values.join(', ')}]`);
  }
  for (const key of actual.keys()) if (!expected.has(key)) out.push(`unexpected key ${key}`);
  return out;
}

function main() {
  if (process.platform !== 'win32') {
    console.log('skipped: the installer check runs on Windows only');
    return;
  }
  const makensis = findMakensis();
  if (!makensis) throw new Error('makensis not found: run `npm run dist:win` once (electron-builder downloads NSIS) or set SIMPAPER_MAKENSIS');
  const rows = parseFileTypes(readFileSync(includeFile, 'utf8'));
  if (rows.length === 0) throw new Error('no file types found in build/installer.nsh');
  const { appId, exe } = builderIdentity();
  const reg = registry();
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'simpaper-assoc-'));
  const installDir = path.join(tmp, 'Program Files with spaces', 'Simpaper');
  const outFile = path.join(tmp, 'assoc-check.exe');
  const nsi = path.join(tmp, 'assoc-check.nsi');
  const failures = [];
  const check = (ok, message) => {
    if (!ok) failures.push(message);
  };
  const classes = `${SCRATCH}\\Classes`;
  const caps = `${SCRATCH}\\Simpaper\\Capabilities`;

  /**
   * What the installer decides for a claimed type: take the default unless a registered app owns it (the default in
   * HKCR names an existing ProgID). The value it would overwrite below the scratch key is always empty or ours here.
   */
  const takesDefault = (row) => {
    const current = reg.value(HKCR, `.${row.ext}`, '')?.text ?? '';
    return current === '' || current === row.progId || !reg.keyExists(HKCR, current);
  };
  const expectedTree = (installed) => {
    const tree = new Map();
    const add = (key, ...values) => tree.set(key, [...new Set([...(tree.get(key) ?? []), ...values])].sort());
    add('');
    add('Classes');
    add('RegisteredApplications');
    for (const row of rows) {
      add(`Classes\\.${row.ext}`);
      add(`Classes\\.${row.ext}\\OpenWithProgids`);
      if (!installed) continue;
      add(`Classes\\${row.progId}`, '', 'AppUserModelID', ...(row.claim ? [] : ['AllowSilentDefaultTakeOver']));
      add(`Classes\\${row.progId}\\DefaultIcon`, '');
      add(`Classes\\${row.progId}\\shell`, '');
      add(`Classes\\${row.progId}\\shell\\open`);
      add(`Classes\\${row.progId}\\shell\\open\\command`, '');
      if (row.claim && takesDefault(row)) add(`Classes\\.${row.ext}`, '');
      add(`Classes\\.${row.ext}\\OpenWithProgids`, row.progId);
    }
    if (installed) {
      add('RegisteredApplications', 'Simpaper');
      add('Simpaper');
      add('Simpaper\\Capabilities', 'ApplicationName', 'ApplicationDescription', 'ApplicationIcon');
      add('Simpaper\\Capabilities\\FileAssociations', ...rows.map((r) => `.${r.ext}`));
    }
    return tree;
  };
  const expectInstalled = (lang, step) => {
    const progIds = new Set();
    for (const row of rows) {
      const name = lang === 'tr' ? row.tr : row.en;
      if (!progIds.has(row.progId)) {
        progIds.add(row.progId);
        check(reg.value(HKCU, `${classes}\\${row.progId}`, '')?.text === name, `${step}: ${row.progId}: type name is not "${name}"`);
        check(reg.value(HKCU, `${classes}\\${row.progId}`, 'AppUserModelID')?.text === appId, `${step}: ${row.progId}: AppUserModelID`);
        const icon = `"${installDir}\\resources\\fileicons\\${row.icon}.ico",0`;
        check(reg.value(HKCU, `${classes}\\${row.progId}\\DefaultIcon`, '')?.text === icon, `${step}: ${row.progId}: DefaultIcon is not ${icon}`);
        check(reg.value(HKCU, `${classes}\\${row.progId}\\shell`, '')?.text === 'open', `${step}: ${row.progId}: default verb is not "open"`);
        const command = `"${installDir}\\${exe}" "%1"`;
        check(reg.value(HKCU, `${classes}\\${row.progId}\\shell\\open\\command`, '')?.text === command, `${step}: ${row.progId}: command is not ${command}`);
        const soft = reg.value(HKCU, `${classes}\\${row.progId}`, 'AllowSilentDefaultTakeOver');
        check(row.claim ? soft === null : soft?.type === REG_NONE, `${step}: ${row.progId}: AllowSilentDefaultTakeOver ${row.claim ? 'set' : 'missing'}`);
      }
      check(reg.value(HKCU, `${classes}\\.${row.ext}\\OpenWithProgids`, row.progId)?.type === REG_NONE, `${step}: .${row.ext}: OpenWithProgids entry missing`);
      check(reg.value(HKCU, `${caps}\\FileAssociations`, `.${row.ext}`)?.text === row.progId, `${step}: .${row.ext}: Capabilities entry missing`);
      const def = reg.value(HKCU, `${classes}\\.${row.ext}`, '')?.text ?? null;
      const expected = row.claim && takesDefault(row) ? row.progId : null;
      check(def === expected, `${step}: .${row.ext}: default is ${def ?? '(none)'}, expected ${expected ?? '(none)'}`);
    }
    check(reg.value(HKCU, caps, 'ApplicationName')?.text === 'Simpaper', `${step}: Capabilities: ApplicationName`);
    const description = reg.value(HKCU, caps, 'ApplicationDescription')?.text ?? '';
    check(lang === 'tr' ? description.startsWith('Belgeler, hesap tabloları') : description.startsWith('Office suite'), `${step}: Capabilities: ApplicationDescription "${description}"`);
    check(reg.value(HKCU, caps, 'ApplicationIcon')?.text === `"${installDir}\\${exe}",0`, `${step}: Capabilities: ApplicationIcon`);
    check(reg.value(HKCU, `${SCRATCH}\\RegisteredApplications`, 'Simpaper')?.text === caps, `${step}: RegisteredApplications: Simpaper`);
    for (const d of treeDiff(reg.tree(HKCU, SCRATCH), expectedTree(true))) failures.push(`${step}: ${d}`);
    return progIds.size;
  };
  const expectRemoved = (step) => {
    // Only the extension keys stay, empty (other apps' values may live in them on a real system).
    for (const d of treeDiff(reg.tree(HKCU, SCRATCH), expectedTree(false))) failures.push(`${step}: ${d}`);
  };
  const run = (...args) => {
    const r = spawnSync(outFile, args, { stdio: 'inherit', windowsHide: true });
    if (r.status !== 0) throw new Error(`assoc-check.exe ${args.join(' ')} exited with ${r.status}`);
  };

  try {
    reg.deleteTree(HKCU, SCRATCH);
    writeFileSync(nsi, harness({ appId, exe, installDir, outFile }), 'utf8');
    const compiled = spawnSync(makensis, ['-WX', '-INPUTCHARSET', 'UTF8', '-V2', nsi], { encoding: 'utf8', windowsHide: true });
    if (compiled.status !== 0) throw new Error(`makensis failed:\n${compiled.stdout}\n${compiled.stderr}`);

    run('--lang=1055');
    const progIds = expectInstalled('tr', 'install (tr)');
    run('--uninstall', '--updated');
    expectInstalled('tr', 'update uninstall'); // an update keeps the registration
    run('--lang=1033', '--mode=all');
    expectInstalled('en', 'install (en, switch to all users)');
    run('--uninstall');
    expectRemoved('uninstall');
    const claimed = rows.filter((r) => r.claim);
    console.log(`${rows.length} extensions, ${progIds} ProgIDs; ${claimed.filter(takesDefault).length} of ${claimed.length} claimed types would become the default on this computer`);
  } finally {
    reg.deleteTree(HKCU, SCRATCH);
    rmSync(tmp, { recursive: true, force: true });
  }
  if (failures.length) {
    console.error(`FAILED (${failures.length}):\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log('OK: install, update and uninstall wrote and removed exactly the expected registry keys and values');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message ?? error);
    process.exitCode = 1;
  }
}
