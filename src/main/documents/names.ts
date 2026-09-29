/** Names the main process gives to documents: untitled titles and "save a copy" defaults (tr/en). */
import type { UiLanguage } from '@shared/api/app';
import type { OfficeKind } from '@shared/modules';

const UNTITLED: Record<OfficeKind, Record<UiLanguage, string>> = {
  writer: { tr: 'Belge', en: 'Document' },
  calc: { tr: 'Tablo', en: 'Spreadsheet' },
  impress: { tr: 'Sunu', en: 'Presentation' },
};

const COPY_SUFFIX: Record<UiLanguage, string> = { tr: ' (kopya)', en: ' (copy)' };

export function copySuffix(lang: UiLanguage): string {
  return COPY_SUFFIX[lang];
}

/** "Belge 1", "Belge 2" … per kind for the lifetime of the app (like Office's Document1, Document2). */
export class UntitledNamer {
  private readonly counters: Record<OfficeKind, number> = { writer: 0, calc: 0, impress: 0 };

  next(kind: OfficeKind, lang: UiLanguage): string {
    this.counters[kind] += 1;
    return `${UNTITLED[kind][lang]} ${this.counters[kind]}`;
  }
}
