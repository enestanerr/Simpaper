/**
 * File backstage: full-window view below the title bar. Opening it hides the native document view
 * (DocumentSurface reacts to backstage.open), so no freeze-frame is needed here.
 */
import { useEffect, useRef, type ComponentType, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft } from '@tabler/icons-react';
import { isOfficeKind } from '@shared/modules';
import type { DocumentDescriptor } from '@shared/api/documents';
import { closeBackstage, selectActiveDocument, setBackstagePage, useApp, type BackstagePage } from '../../state/appStore';
import { holdKeyboard } from '../../services/keyboardFocus';
import { runShellAction } from '../../services/shellActions';
import { AboutPage } from './AboutPage';
import { ExportPdfPage } from './ExportPdfPage';
import { InfoPage } from './InfoPage';
import { NewPage, OpenPage } from './NewOpenPages';
import { OptionsPage } from './OptionsPage';
import { PrintPage } from './PrintPage';
import { RecoverPage } from './RecoverPage';
import { SaveAsPage } from './SaveAsPage';

interface NavEntry {
  id: BackstagePage | 'save' | 'close';
  labelKey: string;
  available: (doc: DocumentDescriptor | null) => boolean;
  separatorBefore?: boolean;
}

const NAV: NavEntry[] = [
  { id: 'info', labelKey: 'shell.backstage.info', available: (d) => !!d },
  { id: 'new', labelKey: 'shell.backstage.new', available: () => true },
  { id: 'open', labelKey: 'shell.backstage.open', available: () => true },
  { id: 'save', labelKey: 'shell.backstage.save', available: (d) => !!d, separatorBefore: true },
  { id: 'saveAs', labelKey: 'shell.backstage.saveAs', available: (d) => !!d },
  { id: 'exportPdf', labelKey: 'shell.backstage.exportPdf', available: (d) => !!d && isOfficeKind(d.kind) },
  { id: 'print', labelKey: 'shell.backstage.print', available: (d) => !!d },
  { id: 'close', labelKey: 'shell.backstage.close', available: (d) => !!d },
  { id: 'recover', labelKey: 'shell.backstage.recover', available: () => true, separatorBefore: true },
  { id: 'options', labelKey: 'shell.backstage.options', available: () => true },
  { id: 'about', labelKey: 'shell.backstage.about', available: () => true },
];

const PAGES: Record<BackstagePage, ComponentType<{ doc: DocumentDescriptor | null }>> = {
  info: InfoPage,
  new: NewPage,
  open: OpenPage,
  saveAs: SaveAsPage,
  exportPdf: ExportPdfPage,
  print: PrintPage,
  recover: RecoverPage,
  options: OptionsPage,
  about: AboutPage,
};

export function Backstage() {
  const { t } = useTranslation();
  const doc = useApp(selectActiveDocument);
  const page = useApp((s) => s.backstage.page);
  const navRef = useRef<HTMLElement>(null);
  const entries = NAV.filter((n) => n.available(doc));
  const current: BackstagePage = entries.some((e) => e.id === page) ? page : doc ? 'info' : 'new';
  const Page = PAGES[current];

  // The keyboard belongs to the backstage while it is open (Esc, arrows, its fields), then to the document again.
  useEffect(() => holdKeyboard('always'), []);

  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    // Focus once when the backstage opens.
  }, []);

  const onNavKey = (e: KeyboardEvent<HTMLElement>) => {
    const items = [...(navRef.current?.querySelectorAll<HTMLElement>('.vr-bs-nav__item') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -2;
    if (next === -2) return;
    e.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };

  const activate = (entry: NavEntry) => {
    if (entry.id === 'save') {
      closeBackstage();
      void runShellAction('file.save');
    } else if (entry.id === 'close') {
      closeBackstage();
      void runShellAction('file.close');
    } else setBackstagePage(entry.id);
  };

  return (
    <div
      className="vr-backstage"
      role="dialog"
      aria-modal="false"
      aria-label={t('shell.backstage.label')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closeBackstage();
        }
      }}
    >
      <nav ref={navRef} className="vr-bs-nav" aria-label={t('shell.backstage.nav')} onKeyDown={onNavKey}>
        <button type="button" className="vr-bs-nav__back" onClick={closeBackstage} aria-label={t('shell.backstage.back')} title={`${t('shell.backstage.back')} (Esc)`}>
          <IconArrowLeft size={20} stroke={1.75} aria-hidden="true" />
        </button>
        <ul>
          {entries.map((entry) => (
            <li key={entry.id}>
              {entry.separatorBefore && <hr className="vr-bs-nav__sep" />}
              <button
                type="button"
                className="vr-bs-nav__item"
                aria-current={entry.id === current ? 'page' : undefined}
                onClick={() => activate(entry)}
              >
                {t(entry.labelKey)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className="vr-bs-page" aria-label={t(NAV.find((n) => n.id === current)?.labelKey ?? '')}>
        <Page doc={doc} />
      </section>
    </div>
  );
}
