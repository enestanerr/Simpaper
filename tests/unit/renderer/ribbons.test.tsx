/**
 * Ribbon definitions of the four modules (Documents, Spreadsheets, Presentations, PDF) are data; these tests
 * check that every control can work: unique ids, usable KeyTips (unique and prefix-free per scope, ASCII
 * without I), every `.uno:` command on the module's allow-list, every `shell` action implemented by the
 * module or the shell, every state binding subscribable (or published by the module), and every label and
 * tip translated in Turkish and English.
 */
import { describe, expect, it } from 'vitest';
import { isAllowedUnoCommand, isSubscribableUnoCommand } from '@shared/commands';
import { isOfficeKind, type ModuleKind } from '@shared/modules';
import { hasTranslation } from '../../../src/renderer/i18n';
import { calcModule } from '../../../src/renderer/modules/calc';
import { impressModule } from '../../../src/renderer/modules/impress';
import { writerModule } from '../../../src/renderer/modules/writer';
import { pdfActions } from '../../../src/renderer/modules/pdf/actions';
import { pdfRibbon } from '../../../src/renderer/modules/pdf/ribbon';
import { PDF_STATE } from '../../../src/renderer/modules/pdf/state/commandBridge';
import type { ModuleDefinition, StatusViewButton } from '../../../src/renderer/modules/types';
import { findKeyTipConflicts, isValidKeyTip } from '../../../src/renderer/ribbon/keytips';
import { actionsOfTab, menuItemsOf, stateCommandsOfTab } from '../../../src/renderer/ribbon/model';
import type { ModuleRibbon, RibbonAction, RibbonControl, RibbonTab } from '../../../src/renderer/ribbon/types';
import { isBuiltinShellAction } from '../../../src/renderer/services/shellActions';
import { QAT_COMMANDS } from '../../../src/renderer/shell/qat';

/** The PDF module definition without its workspace (which loads pdf.js): ribbon and actions are what matter here. */
const pdfModuleLike = { kind: 'pdf', ribbon: pdfRibbon, actions: pdfActions } as unknown as ModuleDefinition;
const MODULES: readonly ModuleDefinition[] = [writerModule, calcModule, impressModule, pdfModuleLike];
const LANGS = ['tr', 'en'] as const;
const PDF_STATES = new Set<string>(Object.values(PDF_STATE));

/** Every action a control can produce, including the ones built from values (combo, colour). */
function actionsOfControl(control: RibbonControl): RibbonAction[] {
  switch (control.type) {
    case 'button':
    case 'toggle':
      return [control.action];
    case 'split':
      return [control.action, ...control.items.map((i) => i.action)];
    case 'menu':
      return control.items.map((i) => i.action);
    case 'gallery':
      return control.items.map((i) => i.action);
    case 'combo': {
      const values = Array.isArray(control.options) ? control.options.map((o) => o.value) : control.options === 'fonts' ? ['Liberation Sans', 'Arial'] : ['11', '10.5'];
      return values.map((v) => control.toAction(v));
    }
    case 'color':
      return [control.toAction(0xc0303f), control.toAction(null)];
    case 'custom':
      return [];
  }
}

function allActions(tab: RibbonTab): RibbonAction[] {
  return [...actionsOfTab(tab), ...tab.groups.flatMap((g) => g.controls.flatMap((c) => (c.type === 'combo' || c.type === 'color' ? actionsOfControl(c) : [])))];
}

/** Every i18n key a tab shows: tab, groups, launchers, controls, tips, menu/gallery items, combo options. */
function keysOfTab(tab: RibbonTab): string[] {
  const keys = [tab.labelKey];
  for (const g of tab.groups) {
    keys.push(g.labelKey);
    if (g.launcherLabelKey) keys.push(g.launcherLabelKey);
    for (const c of g.controls) {
      keys.push(c.labelKey);
      if (c.tipKey) keys.push(c.tipKey);
      for (const item of menuItemsOf(c)) keys.push(item.labelKey);
      if (c.type === 'gallery') for (const item of c.items) if (item.labelKey) keys.push(item.labelKey);
      if (c.type === 'combo' && Array.isArray(c.options)) for (const o of c.options) if (o.labelKey) keys.push(o.labelKey);
      if (c.type === 'color' && c.noneLabelKey) keys.push(c.noneLabelKey);
    }
  }
  return keys;
}

function stateCommandsOf(tab: RibbonTab): string[] {
  const out: string[] = [];
  for (const g of tab.groups) {
    for (const c of g.controls) {
      if (c.state) out.push(c.state.command);
      if (c.type === 'custom') out.push(...(c.stateCommands ?? []));
      for (const item of menuItemsOf(c)) if (item.state) out.push(item.state.command);
    }
  }
  return out;
}

function checkAction(kind: ModuleKind, module: ModuleDefinition, action: RibbonAction): string | null {
  if (action.type === 'uno') {
    if (!isOfficeKind(kind)) return `${action.command}: .uno: command in a non-office module`;
    return isAllowedUnoCommand(kind, action.command) ? null : `${action.command} is not on the ${kind} allow-list`;
  }
  const implemented = typeof module.actions?.[action.id] === 'function' || isBuiltinShellAction(action.id);
  return implemented ? null : `shell action ${action.id} is not implemented`;
}

function checkStateCommand(kind: ModuleKind, command: string): string | null {
  if (!isOfficeKind(kind)) return PDF_STATES.has(command) ? null : `${command} is not published by the PDF module`;
  return isSubscribableUnoCommand(kind, command) ? null : `${command} cannot be subscribed in ${kind}`;
}

describe.each(MODULES.map((m) => [m.kind, m] as const))('%s ribbon', (kind, module) => {
  const ribbon: ModuleRibbon = module.ribbon;

  it('belongs to its module and has regular and (office) contextual tabs', () => {
    expect(ribbon.module).toBe(kind);
    expect(ribbon.tabs.filter((t) => !t.contexts).length).toBeGreaterThanOrEqual(4);
    if (isOfficeKind(kind)) expect(ribbon.tabs.some((t) => t.contexts?.length)).toBe(true);
  });

  it('has unique tab, group and control ids', () => {
    const tabIds = ribbon.tabs.map((t) => t.id);
    expect(new Set(tabIds).size).toBe(tabIds.length);
    for (const tab of ribbon.tabs) {
      const groupIds = tab.groups.map((g) => g.id);
      expect(new Set(groupIds).size, `${tab.id} groups`).toBe(groupIds.length);
      const controlIds = tab.groups.flatMap((g) => g.controls.map((c) => c.id));
      expect(new Set(controlIds).size, `${tab.id} controls`).toBe(controlIds.length);
      for (const c of tab.groups.flatMap((g) => g.controls)) {
        const itemIds = menuItemsOf(c).map((i) => i.id);
        expect(new Set(itemIds).size, `${tab.id}/${c.id} items`).toBe(itemIds.length);
      }
    }
  });

  it('uses valid, unique and prefix-free KeyTips for the tabs (with File and the Quick Access Toolbar)', () => {
    const qat = QAT_COMMANDS.map((_, i) => String(i + 1)).slice(0, 9);
    const root = ['F', ...ribbon.tabs.map((t) => t.keytip), ...qat];
    expect(findKeyTipConflicts(root)).toEqual([]);
    for (const t of ribbon.tabs) expect(isValidKeyTip(t.keytip), `${t.id}: ${t.keytip}`).toBe(true);
  });

  it('uses valid, unique and prefix-free KeyTips within every tab', () => {
    for (const tab of ribbon.tabs) {
      const tips = tab.groups.flatMap((g) => g.controls.map((c) => c.keytip)).filter((k): k is string => k !== undefined);
      for (const tip of tips) expect(isValidKeyTip(tip), `${tab.id}: ${tip}`).toBe(true);
      expect(findKeyTipConflicts(tips), tab.id).toEqual([]);
    }
  });

  it('keeps the single letter Z free for collapsed groups (office modules)', () => {
    if (!isOfficeKind(kind)) return; // the PDF ribbon uses Z; its collapsed groups fall back to Y?
    const withZ = ribbon.tabs.flatMap((tab) => tab.groups.flatMap((g) => g.controls.filter((c) => c.keytip === 'Z').map((c) => `${tab.id}/${c.id}`)));
    expect(withZ).toEqual([]);
  });

  it('gives every control a KeyTip', () => {
    const missing = ribbon.tabs.flatMap((tab) => tab.groups.flatMap((g) => g.controls.filter((c) => !c.keytip).map((c) => `${tab.id}/${c.id}`)));
    expect(missing).toEqual([]);
  });

  it('only uses allowed commands and implemented actions', () => {
    const problems: string[] = [];
    for (const tab of ribbon.tabs) {
      for (const action of allActions(tab)) {
        const p = checkAction(kind, module, action);
        if (p) problems.push(`${tab.id}: ${p}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('binds state only to commands the module can observe', () => {
    const problems: string[] = [];
    for (const tab of ribbon.tabs) {
      for (const command of stateCommandsOf(tab)) {
        const p = checkStateCommand(kind, command);
        if (p) problems.push(`${tab.id}: ${p}`);
      }
      // What the shell subscribes for a tab must pass the main process' subscription filter.
      if (isOfficeKind(kind)) for (const c of stateCommandsOfTab(tab)) if (!isSubscribableUnoCommand(kind, c)) problems.push(`${tab.id}: subscribes ${c}`);
    }
    expect(problems).toEqual([]);
  });

  it('renders custom controls with a component', () => {
    for (const c of ribbon.tabs.flatMap((t) => t.groups.flatMap((g) => g.controls))) {
      if (c.type === 'custom') expect(typeof c.render, c.id).toBe('function');
    }
  });

  it.each(LANGS)('translates every label and tip (%s)', (lang) => {
    const missing = ribbon.tabs.flatMap(keysOfTab).filter((key) => !hasTranslation(lang, key));
    expect(missing).toEqual([]);
  });

  it('has working status bar view buttons', () => {
    const views: StatusViewButton[] = module.statusViews ?? [];
    for (const v of views) {
      for (const lang of LANGS) expect(hasTranslation(lang, v.labelKey), `${lang} ${v.labelKey}`).toBe(true);
      expect(checkAction(kind, module, v.action), v.id).toBeNull();
      if (v.state) expect(checkStateCommand(kind, v.state.command), v.id).toBeNull();
    }
    if (isOfficeKind(kind)) expect(views.length).toBeGreaterThan(0);
  });
});

describe('module ribbons (Office tab names)', () => {
  it('names the regular tabs like the familiar Turkish ribbons', async () => {
    const { i18n, initI18n } = await import('../../../src/renderer/i18n');
    initI18n('tr');
    const names = (m: ModuleDefinition) => m.ribbon.tabs.filter((t) => !t.contexts).map((t) => i18n.t(t.labelKey, { lng: 'tr' }));
    expect(names(writerModule)).toEqual(['Giriş', 'Ekle', 'Düzen', 'Başvurular', 'Gözden Geçir', 'Görünüm']);
    expect(names(calcModule)).toEqual(['Giriş', 'Ekle', 'Sayfa Düzeni', 'Formüller', 'Veri', 'Gözden Geçir', 'Görünüm']);
    expect(names(impressModule)).toEqual(['Giriş', 'Ekle', 'Tasarım', 'Geçişler', 'Animasyonlar', 'Slayt Gösterisi', 'Gözden Geçir', 'Görünüm']);
  });
});
