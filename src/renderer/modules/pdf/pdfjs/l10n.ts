/**
 * Localisation service for pdf.js' own UI (editor labels, "Start typing…", resize handles, page
 * landmarks). pdf.js marks elements with `data-l10n-id` / `data-l10n-args` and expects a Fluent-like
 * service to translate them; this implementation reads the strings from our i18next `pdf` namespace
 * (`pdf.pdfjs.<id>.<attribute>`), so they follow the app language and live in pdf.json.
 */
import type { i18n as I18n } from 'i18next';

/** Attributes pdf.js localises; `value` is the element's text. */
const ATTRIBUTES = ['value', 'aria-label', 'aria-description', 'title', 'placeholder', 'alt', 'default-content'] as const;

type Args = Record<string, unknown>;

const OBSERVE: MutationObserverInit = { childList: true, subtree: true, attributes: true, attributeFilter: ['data-l10n-id', 'data-l10n-args'] };

export class PdfjsL10n {
  readonly #i18n: I18n;
  readonly #roots = new Set<Element>();
  #mutations: MutationObserver | null = null;
  #paused = false;

  constructor(i18n: I18n) {
    this.#i18n = i18n;
  }

  getLanguage(): string {
    return this.#i18n.language === 'en' ? 'en-us' : this.#i18n.language || 'tr';
  }

  getDirection(): 'ltr' | 'rtl' {
    return 'ltr';
  }

  async get(ids: string | string[], args: Args | null = null, fallback?: string): Promise<string | string[] | undefined> {
    if (Array.isArray(ids)) return ids.map((id) => this.#message(id, 'value', null) ?? '');
    return this.#message(ids, 'value', args) ?? fallback;
  }

  async translate(element: Element): Promise<void> {
    if (this.#roots.has(element)) return;
    this.#roots.add(element);
    this.#translateTree(element);
    if (!this.#paused) this.#observer().observe(element, OBSERVE);
  }

  async translateOnce(element: Element): Promise<void> {
    this.#translateTree(element);
  }

  async destroy(): Promise<void> {
    this.#roots.clear();
    this.#mutations?.disconnect();
    this.#mutations = null;
  }

  /** pdf.js pauses while it appends large layers (text layer) that need no translation. */
  pause(): void {
    if (this.#paused) return;
    this.#paused = true;
    if (this.#mutations) {
      this.#process(this.#mutations.takeRecords());
      this.#mutations.disconnect();
    }
  }

  resume(): void {
    if (!this.#paused) return;
    this.#paused = false;
    for (const root of this.#roots) this.#observer().observe(root, OBSERVE);
  }

  /** Re-translates everything after a language change. */
  refresh(): void {
    for (const root of this.#roots) this.#translateTree(root);
  }

  #message(id: string, attribute: string, args: Args | null): string | undefined {
    const key = `pdf.pdfjs.${id}.${attribute}`;
    if (!this.#i18n.exists(key)) return undefined;
    return this.#i18n.t(key, this.#interpolation(args)) as string;
  }

  #interpolation(args: Args | null): Args {
    if (!args) return {};
    const out: Args = { ...args };
    // pdf.js passes dates as epoch milliseconds (Fluent DATETIME in the original strings).
    if (typeof args['dateObj'] === 'number') {
      out['dateObj'] = new Intl.DateTimeFormat(this.#i18n.language === 'en' ? 'en-US' : 'tr-TR', { dateStyle: 'short', timeStyle: 'medium' }).format(
        new Date(args['dateObj']),
      );
    }
    return out;
  }

  #translateElement(el: Element): void {
    const id = el.getAttribute('data-l10n-id');
    if (!id) return;
    let args: Args | null = null;
    const rawArgs = el.getAttribute('data-l10n-args');
    if (rawArgs) {
      try {
        args = JSON.parse(rawArgs) as Args;
      } catch {
        args = null;
      }
    }
    for (const attribute of ATTRIBUTES) {
      const text = this.#message(id, attribute, args);
      if (text === undefined) continue;
      if (attribute === 'value') {
        // Only leaf elements get text content; containers keep their children (as Fluent does).
        if (el.childElementCount === 0 && el.textContent !== text) el.textContent = text;
      } else if (el.getAttribute(attribute) !== text) {
        el.setAttribute(attribute, text);
      }
    }
  }

  #translateTree(root: Element): void {
    if (root.hasAttribute('data-l10n-id')) this.#translateElement(root);
    for (const el of root.querySelectorAll('[data-l10n-id]')) this.#translateElement(el);
  }

  #process(records: MutationRecord[]): void {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) this.#translateElement(record.target);
      for (const node of record.addedNodes) {
        if (node instanceof Element) this.#translateTree(node);
      }
    }
  }

  #observer(): MutationObserver {
    this.#mutations ??= new MutationObserver((records) => this.#process(records));
    return this.#mutations;
  }
}
