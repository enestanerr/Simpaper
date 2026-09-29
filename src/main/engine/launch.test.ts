import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseBootstrapIni, resolveLaunchOptions, servicesWithoutPython } from './launch';
import { locateEngine } from './locate';

// URE_MORE_SERVICES exactly as in LibreOffice 26.8.0.3's program/fundamental.ini.
const UPSTREAM =
  '${${$ORIGIN/louno.ini:PKG_UserUnoFile}:UNO_SERVICES} ${${$ORIGIN/louno.ini:PKG_SharedUnoFile}:UNO_SERVICES} ' +
  '${${$ORIGIN/louno.ini:PKG_BundledUnoFile}:UNO_SERVICES} <$ORIGIN/services>*';
const SERVICES = ['postgresql-sdbc.rdb', 'pyuno.rdb', 'scriptproviderforbeanshell.rdb', 'scriptproviderforjavascript.rdb', 'scriptproviderforpython.rdb', 'services.rdb'];

describe('parseBootstrapIni', () => {
  it('reads only the [Bootstrap] section and keeps values verbatim', () => {
    const ini = '[Other]\r\nA=1\r\n[Bootstrap]\r\n; comment\r\nURE_MORE_SERVICES=x y <$ORIGIN/services>*\r\nB = two = parts \r\n';
    const values = parseBootstrapIni(ini);
    expect(values.get('A')).toBeUndefined();
    expect(values.get('URE_MORE_SERVICES')).toBe('x y <$ORIGIN/services>*');
    expect(values.get('B')).toBe('two = parts');
  });
});

describe('servicesWithoutPython', () => {
  it('replaces the services wildcard by every registry except the Python ones', () => {
    const out = servicesWithoutPython(UPSTREAM, SERVICES);
    expect(out).toBe(
      '${${$ORIGIN/louno.ini:PKG_UserUnoFile}:UNO_SERVICES} ${${$ORIGIN/louno.ini:PKG_SharedUnoFile}:UNO_SERVICES} ' +
        '${${$ORIGIN/louno.ini:PKG_BundledUnoFile}:UNO_SERVICES} ' +
        '$ORIGIN/services/postgresql-sdbc.rdb $ORIGIN/services/scriptproviderforbeanshell.rdb ' +
        '$ORIGIN/services/scriptproviderforjavascript.rdb $ORIGIN/services/services.rdb',
    );
  });

  it('keeps the optional marker of an optional wildcard', () => {
    expect(servicesWithoutPython('?<$ORIGIN/services>*', ['a.rdb', 'pyuno.rdb'])).toBe('?$ORIGIN/services/a.rdb');
  });

  it('drops explicitly listed Python registries and ignores non-registry files', () => {
    expect(servicesWithoutPython('$ORIGIN/services/services.rdb $ORIGIN/services/PyUno.rdb', [])).toBe('$ORIGIN/services/services.rdb');
    expect(servicesWithoutPython('<$ORIGIN/services>*', ['readme.txt', 'pyuno.rdb', 'b.rdb', 'a.rdb'])).toBe('$ORIGIN/services/a.rdb $ORIGIN/services/b.rdb');
  });

  it('returns null when nothing has to change or the layout is unknown', () => {
    expect(servicesWithoutPython(UPSTREAM, ['services.rdb'])).toBeNull();
    expect(servicesWithoutPython('', SERVICES)).toBeNull();
    expect(servicesWithoutPython('<$ORIGIN/services>*', ['pyuno.rdb', 'with space.rdb'])).toBeNull();
    // A macro that merely mentions a Python registry is not a registry entry of its own.
    expect(servicesWithoutPython('${$ORIGIN/x.ini:pyuno.rdb}', [])).toBeNull();
  });
});

describe('resolveLaunchOptions', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function fakeEngine(ini: string | null, files: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'varak-launch-'));
    dirs.push(dir);
    if (ini !== null) writeFileSync(join(dir, 'fundamental.ini'), ini);
    mkdirSync(join(dir, 'services'));
    for (const file of files) writeFileSync(join(dir, 'services', file), '<components/>');
    return dir;
  }

  it('disables in-process Python and OpenCL', () => {
    const dir = fakeEngine(`[Bootstrap]\nURE_MORE_SERVICES=${UPSTREAM}\n`, SERVICES);
    const options = resolveLaunchOptions(dir, {});
    expect(options.env).toEqual({ SAL_DISABLE_OPENCL: '1' });
    expect(options.args).toHaveLength(1);
    expect(options.args[0]).toMatch(/^-env:URE_MORE_SERVICES=\$\{/);
    expect(options.args[0]).not.toMatch(/pyuno|scriptproviderforpython/);
    expect(options.args[0]).toContain('$ORIGIN/services/services.rdb');
  });

  it('leaves the engine untouched when its layout is unknown or the diagnostics switch is set', () => {
    expect(resolveLaunchOptions(fakeEngine(null, SERVICES), {}).args).toEqual([]);
    expect(resolveLaunchOptions(fakeEngine('[Bootstrap]\nOTHER=1\n', SERVICES), {}).args).toEqual([]);
    const keep = resolveLaunchOptions(fakeEngine(`[Bootstrap]\nURE_MORE_SERVICES=${UPSTREAM}\n`, SERVICES), { VARAK_ENGINE_KEEP_PYTHON: '1' });
    expect(keep.args).toEqual([]);
    expect(keep.notes.join(' ')).toMatch(/VARAK_ENGINE_KEEP_PYTHON/);
  });

  // The pruned image that electron-builder packages (scripts/engine/prepare-engine.mjs), when present.
  const packaged = resolve(import.meta.dirname, '..', '..', '..', 'vendor', 'engine-dist', 'program');
  it.skipIf(!existsSync(join(packaged, 'fundamental.ini')))('produces the override for the packaged engine image', () => {
    const options = resolveLaunchOptions(packaged, {});
    expect(options.args).toHaveLength(1);
    expect(options.args[0]).not.toContain('pyuno.rdb');
  });

  const located = locateEngine();
  it.skipIf(!located.ok)('produces the override for the bundled engine', () => {
    if (!located.ok) return;
    const options = resolveLaunchOptions(located.paths.programDir, {});
    expect(options.args).toHaveLength(1);
    expect(options.args[0]).toContain('$ORIGIN/services/services.rdb');
    expect(options.args[0]).not.toContain('pyuno.rdb');
  });
});
