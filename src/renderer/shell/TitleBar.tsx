/**
 * Custom title bar (window uses titleBarStyle 'hidden' + titleBarOverlay; the native caption buttons
 * occupy the right end, see --caption-reserve). Drag regions: the bar is draggable, controls are not.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@tabler/icons-react';
import { BRAND } from '@shared/brand';
import { MenuItemView, MenuPopup } from '../ui/Menu';
import { useScreenTip } from '../ui/ScreenTip';
import { KeyTipBadge } from '../ribbon/controls/shared';
import { qatKeyTip } from '../ribbon/keytips';
import { useKeyTip } from '../ribbon/keytipStore';
import { useDocBlocked } from '../ribbon/runtime';
import { selectActiveDocument, openBackstage, useApp } from '../state/appStore';
import { useCommands } from '../state/commandStore';
import { isShellActionEnabled, runShellAction } from '../services/shellActions';
import { updateSettings } from '../services/settings';
import { useAppActive } from '../services/windowActivity';
import { LOGO_SMALL_URL } from './brand';
import { normalizeQat, QAT_COMMANDS, qatCommand, toggleQatItem, type QatCommand } from './qat';

export function windowTitle(title: string | null, modified: boolean, product = BRAND.productName): string {
  if (!title) return product;
  return `${modified ? '• ' : ''}${title} — ${product}`;
}

export function TitleBar() {
  const { t } = useTranslation();
  const doc = useApp(selectActiveDocument);
  const active = useAppActive();

  useEffect(() => {
    document.title = windowTitle(doc?.title ?? null, doc?.modified ?? false);
  }, [doc?.title, doc?.modified]);

  return (
    <header className={active ? 'vr-titlebar' : 'vr-titlebar vr-titlebar--inactive'} data-active={active}>
      <img className="vr-titlebar__logo" src={LOGO_SMALL_URL} width={20} height={20} alt={BRAND.productName} draggable={false} />
      <QuickAccessToolbar />
      <div className="vr-titlebar__title" aria-live="polite">
        {doc ? (
          <>
            <span className="vr-titlebar__doc">{doc.title}</span>
            {doc.modified && (
              <span className="vr-titlebar__modified" title={t('shell.title.modified')}>
                <span aria-hidden="true">•</span>
                <span className="vr-visually-hidden">{t('shell.title.modified')}</span>
              </span>
            )}
            {doc.readOnly && <span className="vr-titlebar__badge">{t('shell.title.readOnly')}</span>}
            <span className="vr-titlebar__sep" aria-hidden="true">
              —
            </span>
            <span className="vr-titlebar__product">{BRAND.productName}</span>
          </>
        ) : (
          <span className="vr-titlebar__product">{BRAND.productName}</span>
        )}
      </div>
      <div className="vr-titlebar__caption-space" aria-hidden="true" />
    </header>
  );
}

function QuickAccessToolbar() {
  const { t } = useTranslation();
  const stored = useApp((s) => s.settings.ui.quickAccess);
  const ids = useMemo(() => normalizeQat(stored), [stored]);
  const doc = useApp(selectActiveDocument);
  // While LibreOffice shows a modal dialog for the document, nothing may reach it (like the ribbon).
  const blocked = useDocBlocked(doc?.docId ?? null);
  // Re-render when the engine state changes (undo/redo availability).
  useCommands((s) => (doc ? s.revision[doc.docId] : 0));
  const items = ids.map(qatCommand).filter((c): c is QatCommand => !!c);
  return (
    <div role="toolbar" aria-label={t('shell.qat.label')} className="vr-qat">
      {items.map((c, i) => (
        <QatButton key={c.id} command={c} index={i} enabled={!blocked && isShellActionEnabled(c.id, doc)} />
      ))}
      <QatCustomize ids={ids} />
    </div>
  );
}

function QatButton({ command, index, enabled }: { command: QatCommand; index: number; enabled: boolean }) {
  const { t } = useTranslation();
  const label = t(command.labelKey);
  const tip = useScreenTip({ title: label, shortcut: command.shortcut });
  const run = () => {
    if (enabled) void runShellAction(command.id);
  };
  const badge = useKeyTip('root', `qat:${command.id}`, qatKeyTip(index) || undefined, () => {
    run();
    return null;
  });
  const Icon = command.icon;
  return (
    <span className="rb-slot">
      <button
        type="button"
        className="vr-qat__btn"
        aria-label={label}
        aria-keyshortcuts={command.shortcut}
        aria-disabled={!enabled || undefined}
        onClick={run}
        {...tip.props}
      >
        <Icon size={16} stroke={1.75} aria-hidden="true" />
      </button>
      <KeyTipBadge text={badge} />
      {tip.element}
    </span>
  );
}

function QatCustomize({ ids }: { ids: string[] }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const setIds = (next: string[]) => {
    const ui = useApp.getState().settings.ui;
    void updateSettings({ ui: { ...ui, quickAccess: next } });
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="vr-qat__btn vr-qat__more"
        aria-label={t('shell.qat.customize')}
        title={t('shell.qat.customize')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <IconChevronDown size={12} stroke={2} aria-hidden="true" />
      </button>
      <MenuPopup anchor={ref.current} open={open} onClose={() => setOpen(false)} label={t('shell.qat.customize')}>
        {QAT_COMMANDS.map((c) => (
          <MenuItemView key={c.id} label={t(c.labelKey)} checked={ids.includes(c.id)} onSelect={() => setIds(toggleQatItem(ids, c.id))} />
        ))}
        <MenuItemView
          label={t('shell.qat.moreOptions')}
          separatorBefore
          onSelect={() => {
            setOpen(false);
            openBackstage('options');
          }}
        />
      </MenuPopup>
    </>
  );
}
