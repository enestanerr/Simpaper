/**
 * The engine profile (engine/profile) as LibreOffice actually sees it, read back through UNO:
 *  - every keyboard shortcut override of engine/profile/accelerators.json (engine/profile/ACCELERATORS.md)
 *    is active in its module, every removed key no longer runs LibreOffice's default, and every target
 *    command has a dispatch in a document of that module;
 *  - the security, save, recovery, locale and recalculation settings of registrymodifications.xcu.template
 *    under a Turkish and an English profile.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OfficeKind } from '@shared/modules';
import type { AcceleratorTable } from '../../src/main/engine/profiles';
import type { EngineInstance, EngineManager } from '../../src/main/engine/types';
import { engineAvailable, located, makeManager } from './helpers';

const table = (): AcceleratorTable =>
  located.ok ? (JSON.parse(readFileSync(join(located.paths.profileTemplateDir, 'accelerators.json'), 'utf8')) as AcceleratorTable) : { set: [], remove: [] };

describe.skipIf(!engineAvailable)('engine profile read back through UNO', () => {
  const managers = new Map<'tr' | 'en', EngineManager>();
  const instances = new Map<'tr' | 'en', EngineInstance>();

  beforeAll(async () => {
    managers.set('tr', makeManager('profile-tr'));
    managers.set('en', makeManager('profile-en', { uiLanguage: 'en', documentLocale: 'en-US', appearance: 'dark' }));
    for (const [lang, manager] of managers) instances.set(lang, await manager.acquireDocumentInstance(`profile-${lang}`));
  });

  afterAll(async () => {
    await Promise.allSettled([...managers.values()].map((m) => m.dispose()));
  });

  for (const kind of ['writer', 'calc', 'impress'] as const) {
    it(`${kind}: the Office-like shortcuts are active, removed keys are gone, targets are dispatchable`, async () => {
      const { set, remove } = table();
      const i = instances.get('tr')!;
      const mine = set.filter((e) => e.module === kind);
      const removed = remove.filter((e) => e.module === kind || e.module === 'global');
      const keys = [...new Set([...mine.map((e) => e.key), ...removed.map((e) => e.key)])];
      const { bindings } = await i.call('engine.shortcuts', { kind, keys });
      for (const entry of mine) expect(bindings[entry.key], `${kind} ${entry.key}`).toBe(entry.command);
      console.log(`${kind}: removed keys now resolve to ${JSON.stringify(Object.fromEntries(removed.map((e) => [e.key, bindings[e.key] ?? null])))}`);
      for (const entry of removed) {
        if (mine.some((e) => e.key === entry.key)) continue; // replaced in this module, checked above
        if (entry.default) expect(bindings[entry.key], `${kind} ${entry.key} must not run ${entry.default}`).not.toBe(entry.default);
      }
      // Every target command is known to the module (queryDispatch), independent of its current state.
      const docId = `acc-${kind}`;
      await i.call('doc.new', { docId, kind: kind as OfficeKind, view: { mode: 'hidden' } });
      const commands = [...new Set(mine.map((e) => e.command))];
      const { available } = await i.call('cmd.available', { docId, commands });
      const missing = commands.filter((c) => !available[c]);
      expect(missing, `commands without a dispatch in ${kind}`).toEqual([]);
      await i.call('doc.close', { docId });
    });
  }

  it('applies the Turkish-keyboard specific shortcuts only to the Turkish UI', async () => {
    const trOnly = table().set.filter((e) => e.lang === 'tr');
    expect(trOnly.length).toBeGreaterThan(0);
    for (const lang of ['tr', 'en'] as const) {
      const { bindings } = await instances.get(lang)!.call('engine.shortcuts', { kind: 'calc', keys: trOnly.map((e) => e.key) });
      console.log(`Turkish-keyboard shortcuts under the ${lang} UI: ${JSON.stringify(bindings)}`);
      for (const entry of trOnly) {
        if (lang === 'tr') expect(bindings[entry.key], entry.key).toBe(entry.command);
        else expect(bindings[entry.key], entry.key).not.toBe(entry.command);
      }
    }
  });

  it('carries the security, save, recovery and recalculation settings', async () => {
    for (const lang of ['tr', 'en'] as const) {
      const i = instances.get(lang)!;
      const read = async (nodepath: string, names: string[]) => (await i.call('engine.config', { nodepath, names })).values;
      expect(await read('/org.openoffice.Office.Common/Security/Scripting', ['DisableMacrosExecution', 'MacroSecurityLevel'])).toEqual({ DisableMacrosExecution: true, MacroSecurityLevel: 3 });
      expect(await read('/org.openoffice.Office.Common/Misc', ['UseOpenCL', 'CrashReport', 'UseLocking', 'FirstRun', 'ShowTipOfTheDay'])).toEqual({
        UseOpenCL: false,
        CrashReport: false,
        UseLocking: false,
        FirstRun: false,
        ShowTipOfTheDay: false,
      });
      expect(await read('/org.openoffice.Office.Calc/Formula/Load', ['OOXMLRecalcMode', 'ODFRecalcMode'])).toEqual({ OOXMLRecalcMode: 0, ODFRecalcMode: 0 });
      expect(await read('/org.openoffice.Office.Recovery/RecoveryInfo', ['Enabled'])).toEqual({ Enabled: false });
      expect(await read('/org.openoffice.Office.Recovery/AutoSave', ['Enabled'])).toEqual({ Enabled: false });
      expect(await read('/org.openoffice.Office.Common/Save/Document', ['WarnAlienFormat', 'CreateBackup'])).toEqual({ WarnAlienFormat: false, CreateBackup: false });
      expect(await read('/org.openoffice.Office.Common/History', ['PickListSize'])).toEqual({ PickListSize: 0 });
      expect(await read('/org.openoffice.Office.Update/Update', ['Enabled'])).toEqual({ Enabled: false });
      expect(await read("/org.openoffice.Office.Jobs/Jobs/org.openoffice.Office.Jobs:Job['UpdateCheck']/Arguments", ['AutoCheckEnabled'])).toEqual({ AutoCheckEnabled: false });
      const locale = lang === 'tr' ? { ui: 'tr', doc: 'tr-TR' } : { ui: 'en-US', doc: 'en-US' };
      expect(await read('/org.openoffice.Setup/L10N', ['ooLocale', 'ooSetupSystemLocale'])).toEqual({ ooLocale: locale.ui, ooSetupSystemLocale: locale.doc });
      expect(await read('/org.openoffice.Office.Linguistic/General', ['DefaultLocale', 'UILocale'])).toEqual({ DefaultLocale: locale.doc, UILocale: locale.ui });
      expect(await read('/org.openoffice.Office.Common/Appearance', ['ApplicationAppearance'])).toEqual({ ApplicationAppearance: lang === 'tr' ? 1 : 2 });
    }
  });
});
