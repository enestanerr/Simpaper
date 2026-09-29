/**
 * Statically bundled translations (no runtime loading, no network).
 * Namespace owners: common/shell/writer/calc/impress/formats = shell UI, pdf = PDF module,
 * compat/errors = main-process services (keys they emit).
 */
import type { UiLanguage } from '@shared/api/app';
import enCalc from './locales/en/calc.json';
import enCommon from './locales/en/common.json';
import enCompat from './locales/en/compat.json';
import enErrors from './locales/en/errors.json';
import enFormats from './locales/en/formats.json';
import enImpress from './locales/en/impress.json';
import enPdf from './locales/en/pdf.json';
import enShell from './locales/en/shell.json';
import enWriter from './locales/en/writer.json';
import trCalc from './locales/tr/calc.json';
import trCommon from './locales/tr/common.json';
import trCompat from './locales/tr/compat.json';
import trErrors from './locales/tr/errors.json';
import trFormats from './locales/tr/formats.json';
import trImpress from './locales/tr/impress.json';
import trPdf from './locales/tr/pdf.json';
import trShell from './locales/tr/shell.json';
import trWriter from './locales/tr/writer.json';

export const NAMESPACES = ['common', 'shell', 'writer', 'calc', 'impress', 'formats', 'pdf', 'compat', 'errors'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export type TranslationTree = { [key: string]: string | TranslationTree };

export const RESOURCES: Record<UiLanguage, Record<Namespace, TranslationTree>> = {
  tr: {
    common: trCommon,
    shell: trShell,
    writer: trWriter,
    calc: trCalc,
    impress: trImpress,
    formats: trFormats,
    pdf: trPdf as TranslationTree,
    compat: trCompat as TranslationTree,
    errors: trErrors as TranslationTree,
  },
  en: {
    common: enCommon,
    shell: enShell,
    writer: enWriter,
    calc: enCalc,
    impress: enImpress,
    formats: enFormats,
    pdf: enPdf as TranslationTree,
    compat: enCompat as TranslationTree,
    errors: enErrors as TranslationTree,
  },
};
