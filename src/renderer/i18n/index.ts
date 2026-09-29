/**
 * i18next setup. Keys are always written as `<namespace>.<path>` (e.g. `shell.backstage.save`,
 * `formats.docx`, `errors.saveFailed`): with `nsSeparator === keySeparator === '.'` i18next treats the
 * first segment as a namespace only when it is one of NAMESPACES, so keys coming from the main process
 * (CompatFinding.messageKey, SaveResult.errorKey ...) resolve without any mapping.
 */
import i18next, { type i18n as I18n, type TOptions } from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { UiLanguage } from '@shared/api/app';
import { NAMESPACES, RESOURCES, type Namespace } from './resources';

export { NAMESPACES, type Namespace };
export const LANGUAGES: readonly UiLanguage[] = ['tr', 'en'];

export const i18n: I18n = i18next.createInstance();

let initialised = false;

export function initI18n(language: UiLanguage): I18n {
  if (initialised) {
    void setLanguage(language);
    return i18n;
  }
  initialised = true;
  void i18n.use(initReactI18next).init({
    resources: RESOURCES,
    lng: language,
    fallbackLng: 'en',
    supportedLngs: [...LANGUAGES],
    ns: [...NAMESPACES],
    defaultNS: 'common',
    nsSeparator: '.',
    keySeparator: '.',
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  });
  applyDocumentLanguage(language);
  return i18n;
}

export async function setLanguage(language: UiLanguage): Promise<void> {
  if (i18n.language !== language) await i18n.changeLanguage(language);
  applyDocumentLanguage(language);
}

export function currentLanguage(): UiLanguage {
  return i18n.language === 'en' ? 'en' : 'tr';
}

function applyDocumentLanguage(language: UiLanguage): void {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

function lookup(language: UiLanguage, key: string): unknown {
  const [ns, ...path] = key.split('.');
  if (!ns || !(NAMESPACES as readonly string[]).includes(ns) || path.length === 0) return undefined;
  let node: unknown = RESOURCES[language][ns as Namespace];
  for (const part of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** True when `key` resolves to a string in the bundled resources of `language` (plural keys count via `_one`/`_other`). */
export function hasTranslation(language: UiLanguage, key: string): boolean {
  const value = lookup(language, key);
  if (typeof value === 'string') return true;
  return typeof lookup(language, `${key}_other`) === 'string';
}

/**
 * Translates a key that came from outside the renderer (main-process error/notice/compat keys).
 * Falls back to `fallbackKey`, then to the raw key, so an unknown key never renders as nothing.
 */
export function translateExternal(key: string, options?: TOptions, fallbackKey?: string): string {
  if (i18n.exists(key)) return i18n.t(key, options) as string;
  if (fallbackKey && i18n.exists(fallbackKey)) return i18n.t(fallbackKey, { ...options, key }) as string;
  return key;
}
