/**
 * The `.uno:` allow-list (src/shared/commands.ts) against LibreOffice's UI command registry.
 *
 * Command descriptions live in org.openoffice.Office.UI.*Commands: GenericCommands and DrawImpressCommands in
 * share/registry/main.xcd, WriterCommands in writer.xcd, CalcCommands in calc.xcd. A command is verified for a
 * module when it is a generic command or one of that module's own commands. The registry is read directly (no
 * engine start); the check is skipped when the engine image (vendor/libreoffice) is absent.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAllowedUnoCommand, isSubscribableUnoCommand, unoBaseCommand, UNO_COMMANDS, UNO_STATUS_COMMANDS } from '@shared/commands';
import { INTERCEPTED_COMMANDS } from '@shared/engine-protocol';
import { OFFICE_KINDS, type OfficeKind } from '@shared/modules';
import { unoCommand } from '../../../src/main/ipc/validate';

const ROOT = resolve(process.cwd());
/** SIMPAPER_ENGINE_DIR is a LibreOffice program directory; the registry is next to it. */
const ENGINE_ROOT = process.env['SIMPAPER_ENGINE_DIR'] ? resolve(process.env['SIMPAPER_ENGINE_DIR'], '..') : join(ROOT, 'vendor/libreoffice');
const REGISTRY = join(ENGINE_ROOT, 'share/registry');
const FILES = ['main.xcd', 'writer.xcd', 'calc.xcd'] as const;
const hasRegistry = FILES.every((f) => existsSync(join(REGISTRY, f)));

type Component = 'GenericCommands' | 'WriterCommands' | 'CalcCommands' | 'DrawImpressCommands';
const MODULE_COMPONENT: Record<OfficeKind, Component> = { writer: 'WriterCommands', calc: 'CalcCommands', impress: 'DrawImpressCommands' };

/** `.uno:` node names per *Commands component, and the registry file each component was found in. */
function readRegistry(): { commands: Map<Component, Set<string>>; fileOf: Map<Component, string> } {
  const commands = new Map<Component, Set<string>>();
  const fileOf = new Map<Component, string>();
  for (const file of FILES) {
    const xml = readFileSync(join(REGISTRY, file), 'utf8');
    for (const m of xml.matchAll(/<oor:component-data[^>]*oor:name="(GenericCommands|WriterCommands|CalcCommands|DrawImpressCommands)"[^>]*>([\s\S]*?)<\/oor:component-data>/g)) {
      const component = m[1] as Component;
      const set = commands.get(component) ?? new Set<string>();
      for (const n of m[2]!.matchAll(/oor:name="(\.uno:[^"]+)"/g)) set.add(n[1]!);
      commands.set(component, set);
      fileOf.set(component, file);
    }
  }
  return { commands, fileOf };
}

describe('allow-list rules (no engine needed)', () => {
  it('keeps shell-owned flows (save, open, quit, macros, options, help) off the allow-list', () => {
    for (const kind of OFFICE_KINDS) {
      for (const command of INTERCEPTED_COMMANDS) expect(isAllowedUnoCommand(kind, command), `${kind} ${command}`).toBe(false);
    }
  });

  it('matches commands by their base name, never by prefix', () => {
    expect(unoBaseCommand('.uno:StyleApply?Style:string=Heading 1')).toBe('.uno:StyleApply');
    expect(isAllowedUnoCommand('writer', '.uno:StyleApply?Style:string=Heading 1')).toBe(true);
    expect(isAllowedUnoCommand('writer', '.uno:BasicShapes.rectangle')).toBe(true);
    expect(isAllowedUnoCommand('writer', '.uno:Bol')).toBe(false);
    expect(isAllowedUnoCommand('writer', '.uno:BoldX')).toBe(false);
    expect(isAllowedUnoCommand('calc', '.uno:InsertMultiIndex')).toBe(false);
    expect(isAllowedUnoCommand('writer', 'macro:///Standard.Module1.Main')).toBe(false);
  });

  it('allows status items only as subscriptions', () => {
    expect(isSubscribableUnoCommand('writer', '.uno:StatePageNumber')).toBe(true);
    expect(isAllowedUnoCommand('writer', '.uno:StatePageNumber')).toBe(false);
    expect(isSubscribableUnoCommand('calc', '.uno:StatePageNumber')).toBe(false);
  });

  it('allows every .uno: command the renderer code uses (intercepted commands only arrive as events)', () => {
    const intercepted = new Set<string>(INTERCEPTED_COMMANDS);
    const dir = join(ROOT, 'src/renderer');
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((name) => {
        const p = join(d, name);
        return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
      });
    const problems: string[] = [];
    for (const file of walk(dir)) {
      const rel = file.slice(dir.length + 1).replace(/\\/g, '/');
      const kinds: readonly OfficeKind[] = rel.startsWith('modules/writer/')
        ? ['writer']
        : rel.startsWith('modules/calc/')
          ? ['calc']
          : rel.startsWith('modules/impress/')
            ? ['impress']
            : OFFICE_KINDS;
      for (const m of readFileSync(file, 'utf8').matchAll(/'(\.uno:[A-Za-z0-9.\-_]+)'/g)) {
        const command = m[1]!;
        if (intercepted.has(command)) {
          // Handled when the engine reports it (services/bootstrap.ts handleIntercept); never dispatched.
          if (!rel.startsWith('services/bootstrap.ts')) problems.push(`${rel}: intercepted command ${command}`);
          continue;
        }
        if (!kinds.some((k) => isSubscribableUnoCommand(k, command))) problems.push(`${rel}: ${command}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('allow-list against the main-process IPC validator', () => {
  const all = OFFICE_KINDS.flatMap((k) => [...UNO_COMMANDS[k]]);
  const rejectedByIpc = () =>
    [...new Set(all)].filter((c) => {
      try {
        unoCommand(c, 'command');
        return false;
      } catch {
        return true;
      }
    });

  it('the validator accepts all names without a hyphen', () => {
    expect(rejectedByIpc().filter((c) => !c.includes('-'))).toEqual([]);
  });

  // Shape commands contain hyphens (.uno:BasicShapes.round-rectangle, .uno:ArrowShapes.left-right-arrow …).
  it('the validator accepts every allowed command (hyphenated shape names)', () => {
    expect(rejectedByIpc()).toEqual([]);
  });
});

describe.skipIf(!hasRegistry)('allow-list against the LibreOffice 26.8 command registry', () => {
  const { commands, fileOf } = hasRegistry ? readRegistry() : { commands: new Map<Component, Set<string>>(), fileOf: new Map<Component, string>() };

  it('finds the command components in main.xcd, writer.xcd and calc.xcd', () => {
    expect(fileOf.get('GenericCommands')).toBe('main.xcd');
    expect(fileOf.get('DrawImpressCommands')).toBe('main.xcd');
    expect(fileOf.get('WriterCommands')).toBe('writer.xcd');
    expect(fileOf.get('CalcCommands')).toBe('calc.xcd');
    expect(commands.get('GenericCommands')?.size).toBeGreaterThan(500);
  });

  it.each(OFFICE_KINDS)('every allowed %s command exists in the registry', (kind) => {
    const generic = commands.get('GenericCommands') ?? new Set<string>();
    const own = commands.get(MODULE_COMPONENT[kind]) ?? new Set<string>();
    const all = [...UNO_COMMANDS[kind], ...UNO_STATUS_COMMANDS[kind]];
    const rejected = all.filter((c) => !generic.has(c) && !own.has(c));
    const inGeneric = all.filter((c) => generic.has(c)).length;
    const component = MODULE_COMPONENT[kind];
    console.info(
      `[commands] ${kind}: ${all.length - rejected.length}/${all.length} verified ` +
        `(${inGeneric} GenericCommands in main.xcd, ${all.length - rejected.length - inGeneric} ${component} in ${fileOf.get(component)}), ` +
        `rejected: ${rejected.length}${rejected.length ? ` ${rejected.join(' ')}` : ''}`,
    );
    expect(rejected).toEqual([]);
  });
});
