/**
 * Every `.uno:` action the shell sends must pass the main process's dispatch checks (engine:dispatch): the
 * command allow-list and the argument allow-list of src/shared/commands.ts (UNO_COMMAND_ARGS). Covered: every
 * ribbon control of the three office modules (buttons, toggles, split and menu items, galleries, dialog
 * launchers, combos with their values, colour pickers, the table grid), the status bar view buttons, the zoom
 * slider and every other `dispatchUno` call with arguments in the renderer sources.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAllowedUnoArgs, isAllowedUnoCommand, UNO_COMMAND_ARGS } from '@shared/commands';
import type { UnoArg } from '@shared/engine-protocol';
import { OFFICE_KINDS, type OfficeKind } from '@shared/modules';

// Loaded at run time on purpose: the node typecheck (tsconfig.node.json covers tests/**/*.ts) must not follow
// the renderer's .tsx modules; the renderer projects typecheck those.
const load = (spec: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ spec);

type Action = { type: 'uno'; command: string; args?: Record<string, UnoArg> } | { type: 'shell'; id: string; payload?: unknown };
interface Control {
  id: string;
  type: string;
  action?: Action;
  items?: Array<{ action: Action }>;
  options?: Array<{ value: string }> | 'fonts' | 'fontSizes';
  toAction?: (value: never) => Action;
}
interface Tab {
  id: string;
  groups: Array<{ id: string; launcher?: Action; controls: Control[] }>;
}
interface ModuleLike {
  kind: string;
  ribbon: { tabs: Tab[] };
  statusViews?: Array<{ id: string; action: Action }>;
}

const MODULE_EXPORTS: Record<OfficeKind, [string, string]> = {
  writer: ['../../../src/renderer/modules/writer/index.ts', 'writerModule'],
  calc: ['../../../src/renderer/modules/calc/index.ts', 'calcModule'],
  impress: ['../../../src/renderer/modules/impress/index.ts', 'impressModule'],
};

async function moduleOf(kind: OfficeKind): Promise<ModuleLike> {
  const [spec, name] = MODULE_EXPORTS[kind];
  return (await load(spec))[name] as ModuleLike;
}

/** Every action a control can produce, including those built from values (combos, colours). */
function actionsOf(control: Control): Action[] {
  const out: Action[] = [];
  if (control.action) out.push(control.action);
  for (const item of control.items ?? []) out.push(item.action);
  if (control.toAction && control.type === 'combo') {
    const values = Array.isArray(control.options) ? control.options.map((o) => o.value) : control.options === 'fonts' ? ['Carlito', 'Liberation Sans'] : ['11', '10.5', '72'];
    for (const v of values) out.push((control.toAction as (value: string) => Action)(v));
  }
  if (control.toAction && control.type === 'color') {
    const toAction = control.toAction as (value: number | null) => Action;
    out.push(toAction(null), toAction(0xc0303f), toAction(0xffffff));
  }
  return out;
}

function unoActions(module: ModuleLike): Array<{ where: string; action: Extract<Action, { type: 'uno' }> }> {
  const out: Array<{ where: string; action: Extract<Action, { type: 'uno' }> }> = [];
  const add = (where: string, a: Action) => {
    if (a.type === 'uno') out.push({ where, action: a });
  };
  for (const tab of module.ribbon.tabs) {
    for (const group of tab.groups) {
      if (group.launcher) add(`${tab.id}/${group.id}/launcher`, group.launcher);
      for (const control of group.controls) for (const a of actionsOf(control)) add(`${tab.id}/${group.id}/${control.id}`, a);
    }
  }
  for (const view of module.statusViews ?? []) add(`status/${view.id}`, view.action);
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'pdf' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('dispatch arguments of the shell', () => {
  it.each(OFFICE_KINDS)('every ribbon and status bar action of %s passes the engine:dispatch checks', async (kind) => {
    const actions = unoActions(await moduleOf(kind));
    expect(actions.length).toBeGreaterThan(50);
    const refused = actions.filter(({ action }) => !isAllowedUnoCommand(kind, action.command) || !isAllowedUnoArgs(action.command, action.args)).map(({ where, action }) => `${where}: ${action.command} ${JSON.stringify(action.args ?? {})}`);
    expect(refused).toEqual([]);
    // The ribbon really sends arguments (colours, fonts, styles ...): the list is exercised, not bypassed.
    expect(actions.filter(({ action }) => action.args && Object.keys(action.args).length > 0).length).toBeGreaterThan(3);
  });

  it('the table grid and the zoom slider send only allow-listed arguments', async () => {
    const grid = await load('../../../src/renderer/modules/common/TableGridControl.tsx');
    const insertTableAction = grid['insertTableAction'] as (columns: number, rows: number) => Extract<Action, { type: 'uno' }>;
    for (const [c, r] of [
      [1, 1],
      [10, 8],
    ] as const) {
      const a = insertTableAction(c, r);
      expect(isAllowedUnoArgs(a.command, a.args), `${c}x${r}`).toBe(true);
    }
    const zoom = await load('../../../src/renderer/services/zoom.ts');
    const clampZoom = zoom['clampZoom'] as (value: number) => number;
    for (const value of [5, 100, 137.4, 999]) expect(isAllowedUnoArgs('.uno:Zoom', { 'Zoom.Value': clampZoom(value) })).toBe(true);
  });

  it('every dispatchUno call with arguments in the renderer uses a command of the argument allow-list', () => {
    const root = resolve('src', 'renderer');
    const calls: string[] = [];
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/dispatchUno\(\s*[^,]+,\s*'(\.uno:[^']+)'\s*,\s*([^,)\s][^,)]*)/g)) {
        if (m[2]?.trim() !== 'undefined') calls.push(m[1]!);
      }
    }
    expect(calls).toContain('.uno:Zoom');
    expect(calls.filter((c) => !Object.hasOwn(UNO_COMMAND_ARGS, c))).toEqual([]);
  });

  it('file- and URL-taking commands get no arguments at all', () => {
    for (const command of ['.uno:InsertGraphic', '.uno:InsertExternalDataSource', '.uno:ImportFromFile', '.uno:CompareDocuments', '.uno:MergeDocuments', '.uno:InsertAVMedia', '.uno:InsertObject', '.uno:HyperlinkDialog']) {
      expect(Object.hasOwn(UNO_COMMAND_ARGS, command), command).toBe(false);
      expect(isAllowedUnoArgs(command, { FileName: 'file:///C:/x' }), command).toBe(false);
      expect(isAllowedUnoArgs(command, undefined), command).toBe(true);
    }
  });
});
