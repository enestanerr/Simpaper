/** Pure helpers over the declarative ribbon model. */
import type { MenuItem, ModuleRibbon, RibbonAction, RibbonControl, RibbonGroup, RibbonTab } from './types';

export function controlsOf(group: RibbonGroup): RibbonControl[] {
  return group.controls;
}

export function allControls(tab: RibbonTab): RibbonControl[] {
  return tab.groups.flatMap((g) => g.controls);
}

export function menuItemsOf(control: RibbonControl): MenuItem[] {
  return control.type === 'split' || control.type === 'menu' ? control.items : [];
}

/** The `.uno:` command a control's state follows: explicit binding, else the command it executes. */
export function stateCommandOf(control: { state?: { command: string } | undefined; action?: RibbonAction }): string | undefined {
  if (control.state) return control.state.command;
  if (control.action?.type === 'uno') return control.action.command;
  return undefined;
}

/** Every `.uno:` command whose state the given tab needs (controls, menu items, launchers). */
export function stateCommandsOfTab(tab: RibbonTab): Set<string> {
  const out = new Set<string>();
  const add = (c: string | undefined) => {
    if (c && c.startsWith('.uno:')) out.add(c);
  };
  for (const group of tab.groups) {
    if (group.launcher?.type === 'uno') add(group.launcher.command);
    for (const control of group.controls) {
      if (control.type === 'button' || control.type === 'toggle' || control.type === 'split') add(stateCommandOf(control));
      else if (control.type === 'custom') control.stateCommands?.forEach(add);
      else add(control.state?.command);
      for (const item of menuItemsOf(control)) add(stateCommandOf(item));
      if (control.type === 'gallery') for (const item of control.items) add(item.action.type === 'uno' ? item.action.command : undefined);
    }
  }
  return out;
}

/** Every action a tab can trigger (tests: allow-list validation). */
export function actionsOfTab(tab: RibbonTab): RibbonAction[] {
  const out: RibbonAction[] = [];
  for (const group of tab.groups) {
    if (group.launcher) out.push(group.launcher);
    for (const control of group.controls) {
      if (control.type === 'button' || control.type === 'toggle' || control.type === 'split') out.push(control.action);
      for (const item of menuItemsOf(control)) out.push(item.action);
      if (control.type === 'gallery') for (const item of control.items) out.push(item.action);
    }
  }
  return out;
}

/** Tabs shown for the current LibreOffice context: all regular tabs plus matching contextual tabs. */
export function visibleTabs(ribbon: ModuleRibbon, context: string | undefined): RibbonTab[] {
  return ribbon.tabs.filter((t) => !t.contexts || (context !== undefined && t.contexts.includes(context)));
}

export function findTab(ribbon: ModuleRibbon, tabId: string | undefined): RibbonTab | undefined {
  return tabId ? ribbon.tabs.find((t) => t.id === tabId) : undefined;
}
