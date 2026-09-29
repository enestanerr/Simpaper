/**
 * Engine user profiles ("UserInstallation" directories), one per concurrently running instance.
 *
 * Slots (`doc-0`, `doc-1`, …, `conversion`) are reused across runs so that LibreOffice's slow first
 * start (profile creation, extension registration) happens once. Before every start the slot's
 * user/registrymodifications.xcu is rewritten from engine/profile/registrymodifications.xcu.template,
 * so every instance starts from the same known configuration (UI language, locale, theme, security
 * settings, Office-like accelerators from accelerators.json).
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface ProfileSettings {
  uiLanguage: 'tr' | 'en';
  /** BCP 47 locale for documents, number formats and CSV/number input (e.g. `tr-TR`). */
  documentLocale: string;
  appearance: 'system' | 'light' | 'dark';
}

export type AcceleratorScope = 'global' | 'writer' | 'calc' | 'impress';

export interface AcceleratorSet {
  module: AcceleratorScope;
  /** LibreOffice accelerator key name, e.g. `F12_SHIFT_MOD1` (MOD1 = Ctrl, MOD2 = Alt). */
  key: string;
  command: string;
  /** Only for this UI language (e.g. Turkish-Q specific keys); default: all languages. */
  lang?: string;
  office?: string;
  default?: string | null;
}

export interface AcceleratorRemoval {
  module: AcceleratorScope;
  key: string;
  default?: string;
  reason?: string;
}

export interface AcceleratorTable {
  set: AcceleratorSet[];
  remove: AcceleratorRemoval[];
}

export const TEMPLATE_FILE = 'registrymodifications.xcu.template';
export const ACCELERATORS_FILE = 'accelerators.json';

const MODULE_SERVICE: Record<Exclude<AcceleratorScope, 'global'>, string> = {
  writer: 'com.sun.star.text.TextDocument',
  calc: 'com.sun.star.sheet.SpreadsheetDocument',
  impress: 'com.sun.star.presentation.PresentationDocument',
};

const APPEARANCE: Record<ProfileSettings['appearance'], number> = { system: 0, light: 1, dark: 2 };
const LOCALE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const KEY_RE = /^[A-Z0-9]+(_[A-Z0-9]+)*$/;
const COMMAND_RE = /^\.uno:[A-Za-z][A-Za-z0-9_.]*(\?[^<>]*)?$/;

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** LibreOffice's UI language code (Setup/L10N/ooLocale). */
export function uiLocale(language: ProfileSettings['uiLanguage']): string {
  return language === 'tr' ? 'tr' : 'en-US';
}

function acceleratorPath(scope: AcceleratorScope): string {
  const base = '/org.openoffice.Office.Accelerators/PrimaryKeys';
  return scope === 'global' ? `${base}/Global` : `${base}/Modules/org.openoffice.Office.Accelerators:Module['${MODULE_SERVICE[scope]}']`;
}

function checkScope(scope: string): asserts scope is AcceleratorScope {
  if (scope !== 'global' && !(scope in MODULE_SERVICE)) throw new Error(`accelerators: unknown module ${scope}`);
}

/** Registry items for accelerators.json, in the format configmgr writes (verified against LibreOffice 26.8). */
export function renderAccelerators(table: AcceleratorTable): string {
  const items: string[] = [];
  for (const entry of table.set) {
    checkScope(entry.module);
    if (!KEY_RE.test(entry.key)) throw new Error(`accelerators: invalid key ${entry.key}`);
    if (!COMMAND_RE.test(entry.command)) throw new Error(`accelerators: invalid command ${entry.command}`);
    const lang = entry.lang ?? 'en-US';
    if (!LOCALE_RE.test(lang)) throw new Error(`accelerators: invalid lang ${lang}`);
    // oor:op="replace" drops LibreOffice's values for all languages of this key; with an en-US value
    // only, every UI language falls back to it.
    items.push(
      `<item oor:path="${acceleratorPath(entry.module)}"><node oor:name="${entry.key}" oor:op="replace">` +
        `<prop oor:name="Command" oor:op="fuse"><value xml:lang="${lang}">${escapeXml(entry.command)}</value></prop></node></item>`,
    );
  }
  for (const entry of table.remove) {
    checkScope(entry.module);
    if (!KEY_RE.test(entry.key)) throw new Error(`accelerators: invalid key ${entry.key}`);
    items.push(`<item oor:path="${acceleratorPath(entry.module)}"><node oor:name="${entry.key}" oor:op="remove"/></item>`);
  }
  return items.join('\n');
}

export function renderRegistryModifications(template: string, accelerators: AcceleratorTable, settings: ProfileSettings): string {
  if (!LOCALE_RE.test(settings.documentLocale)) throw new Error(`invalid document locale ${settings.documentLocale}`);
  const values: Record<string, string> = {
    UI_LOCALE: uiLocale(settings.uiLanguage),
    LOCALE: settings.documentLocale,
    DOCUMENT_LOCALE: settings.documentLocale,
    APPEARANCE: String(APPEARANCE[settings.appearance] ?? 0),
    ACCELERATORS: renderAccelerators(accelerators),
  };
  // Comments are for humans; configmgr gets exactly the item format it writes itself.
  const withoutComments = template.replace(/<!--[\s\S]*?-->\s*/g, '');
  return withoutComments.replace(/\{\{([A-Z_]+)\}\}/g, (match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`unknown placeholder ${match} in the profile template`);
    return value;
  });
}

/** file:/// URL of a profile directory, as expected by -env:UserInstallation. */
export function profileUrl(dir: string): string {
  return pathToFileURL(dir).href;
}

export interface ProfileSlot {
  readonly name: string;
  readonly dir: string;
  release(): void;
}

export class ProfileStore {
  private template: Promise<{ xcu: string; accelerators: AcceleratorTable }> | null = null;
  private readonly used = new Set<string>();
  private readonly retired = new Set<string>();

  constructor(
    readonly root: string,
    private readonly templateDir: string,
  ) {}

  /** Reserves a slot: `conversion`, or the lowest free `doc-N`. */
  acquire(kind: 'document' | 'conversion'): ProfileSlot {
    let name = 'conversion';
    if (kind === 'conversion') {
      for (let i = 1; this.used.has(name) || this.retired.has(name); i++) name = `conversion-${i}`;
    } else {
      let i = 0;
      while (this.used.has(`doc-${i}`) || this.retired.has(`doc-${i}`)) i++;
      name = `doc-${i}`;
    }
    this.used.add(name);
    let released = false;
    return {
      name,
      dir: join(this.root, name),
      release: () => {
        if (!released) this.used.delete(name);
        released = true;
      },
    };
  }

  /** Never hand out this slot again in this session (e.g. an orphaned soffice still holds it). */
  retire(name: string): void {
    this.retired.add(name);
  }

  /** Creates the slot directory if needed and writes the configuration for this start. */
  async prepare(slot: ProfileSlot, settings: ProfileSettings): Promise<void> {
    const { xcu, accelerators } = await this.loadTemplate();
    const userDir = join(slot.dir, 'user');
    await mkdir(userDir, { recursive: true });
    await writeFile(join(userDir, 'registrymodifications.xcu'), renderRegistryModifications(xcu, accelerators, settings), 'utf8');
    await rm(join(slot.dir, 'soffice.pid'), { force: true });
    // Crash dumps of earlier runs (LibreOffice's crash handler writes them to <profile>/crash): they are
    // never uploaded, may contain document memory and would pile up in reused slots.
    await rm(join(slot.dir, 'crash'), { recursive: true, force: true }).catch(() => undefined);
  }

  private loadTemplate(): Promise<{ xcu: string; accelerators: AcceleratorTable }> {
    this.template ??= (async () => {
      const [xcu, json] = await Promise.all([
        readFile(join(this.templateDir, TEMPLATE_FILE), 'utf8'),
        readFile(join(this.templateDir, ACCELERATORS_FILE), 'utf8'),
      ]);
      const parsed = JSON.parse(json) as Partial<AcceleratorTable>;
      return { xcu, accelerators: { set: parsed.set ?? [], remove: parsed.remove ?? [] } };
    })();
    this.template.catch(() => {
      this.template = null;
    });
    return this.template;
  }
}
