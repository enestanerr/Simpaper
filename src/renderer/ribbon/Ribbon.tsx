/**
 * The ribbon: File tab, tab list (APG tabs, automatic activation), contextual tabs, adaptive panel,
 * collapse (Ctrl+F1 / double-click a tab), temporary "peek" while collapsed, KeyTips and roving focus.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronUp, IconPinned } from '@tabler/icons-react';
import type { DocumentDescriptor } from '@shared/api/documents';
import { isOfficeKind } from '@shared/modules';
import type { ModuleDefinition } from '../modules/types';
import { openBackstage, setRibbonPeek, setRibbonTab, useApp } from '../state/appStore';
import { useDocContext } from '../state/commandStore';
import { ensureSubscribed, focusView } from '../services/engine';
import { acquireOverlay, overlayPending, whenOverlayReady } from '../services/overlay';
import { updateSettings } from '../services/settings';
import { GroupView } from './GroupView';
import { assignGroupKeyTips } from './keytips';
import { useKeyTip } from './keytipStore';
import { computeGroupLevels, groupWidth, nextCorrection, type GroupLevel } from './layout';
import { measureUiText } from './measure';
import { useActiveDocument, useDocBlocked } from './runtime';
import { allControls, stateCommandsOfTab, visibleTabs } from './model';
import type { RibbonTab } from './types';
import { cls, KeyTipBadge } from './controls/shared';

export interface RibbonProps {
  module: ModuleDefinition;
  doc: DocumentDescriptor;
  /** Extra commands to keep subscribed (QAT gates, status bar). */
  extraCommands?: readonly string[];
}

export function Ribbon({ module, doc, extraCommands }: RibbonProps) {
  const { t } = useTranslation();
  const context = useDocContext(doc.docId);
  const tabs = useMemo(() => visibleTabs(module.ribbon, context), [module.ribbon, context]);
  const chosen = useApp((s) => s.ribbonTab[module.kind]);
  const selected = tabs.find((tab) => tab.id === chosen) ?? tabs.find((tab) => !tab.contexts) ?? tabs[0];
  const collapsedSetting = useApp((s) => s.settings.ui.ribbonCollapsed);
  const peek = useApp((s) => s.ribbonPeek);
  const showPanel = !collapsedSetting || peek;
  const baseId = useId();
  const tabListRef = useRef<HTMLDivElement>(null);
  const ribbonRef = useRef<HTMLDivElement>(null);

  // Stream the state of every command the visible tab (and the QAT/status bar) needs.
  useEffect(() => {
    if (!selected || !isOfficeKind(doc.kind)) return;
    const commands = stateCommandsOfTab(selected);
    for (const c of extraCommands ?? []) commands.add(c);
    ensureSubscribed(doc.docId, commands);
  }, [selected, doc.docId, doc.kind, doc.state, extraCommands]);

  // Close the peeking panel when clicking elsewhere.
  useEffect(() => {
    if (!peek) return;
    const onDown = (e: PointerEvent) => {
      if (!ribbonRef.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.vr-popup')) setRibbonPeek(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [peek]);

  const selectTab = (tab: RibbonTab) => {
    setRibbonTab(module.kind, tab.id);
    if (collapsedSetting) setRibbonPeek(true);
  };

  const toggleCollapsed = () => {
    setRibbonPeek(false);
    void updateSettings({ ui: { ribbonCollapsed: !collapsedSetting } });
  };

  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(tabListRef.current?.querySelectorAll<HTMLElement>('[data-tab-item]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showPanel) setRibbonPeek(true);
      requestAnimationFrame(() => ribbonRef.current?.querySelector<HTMLElement>('.rb-panel [data-rb-item][tabindex="0"], .rb-panel [data-rb-item]')?.focus());
      return;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      void focusView(doc.docId);
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    const el = items[next];
    el?.focus();
    const tabId = el?.dataset['tabId'];
    const tab = tabs.find((x) => x.id === tabId);
    if (tab) setRibbonTab(module.kind, tab.id);
  };

  const panelId = `${baseId}-panel`;
  return (
    <div ref={ribbonRef} className={cls('rb-ribbon', !showPanel && 'rb-ribbon--collapsed', peek && collapsedSetting && 'rb-ribbon--peek')}>
      <div ref={tabListRef} className="rb-tabs" onKeyDown={onTabKeyDown}>
        <FileTab onOpen={() => openBackstage('info')} />
        <div role="tablist" aria-label={t('shell.ribbon.tabsLabel')} className="rb-tablist">
          {tabs.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              selected={tab.id === selected?.id}
              panelId={panelId}
              tabDomId={`${baseId}-tab-${tab.id}`}
              expanded={showPanel}
              onSelect={() => selectTab(tab)}
              onToggleCollapse={toggleCollapsed}
            />
          ))}
        </div>
        <div className="rb-tabs__spacer" />
        <button
          type="button"
          className="rb-collapse"
          aria-label={collapsedSetting ? t('shell.ribbon.pin') : t('shell.ribbon.collapse')}
          title={`${collapsedSetting ? t('shell.ribbon.pin') : t('shell.ribbon.collapse')} (Ctrl+F1)`}
          aria-pressed={!collapsedSetting}
          onClick={toggleCollapsed}
        >
          {collapsedSetting ? <IconPinned size={14} stroke={1.75} aria-hidden="true" /> : <IconChevronUp size={14} stroke={1.75} aria-hidden="true" />}
        </button>
      </div>
      {showPanel && selected && (
        <PanelFrame peek={peek && collapsedSetting}>
          <div role="tabpanel" id={panelId} aria-labelledby={`${baseId}-tab-${selected.id}`} className="rb-panel">
            <RibbonPanel key={selected.id} tab={selected} label={t(selected.labelKey)} />
          </div>
        </PanelFrame>
      )}
    </div>
  );
}

/** Wraps the panel; while peeking over the document it floats and holds the airspace overlay. */
function PanelFrame({ peek, children }: { peek: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(true);
  useLayoutEffect(() => {
    if (!peek || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const release = acquireOverlay({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    if (!overlayPending()) return release;
    // Painted once the document view is frozen (see Popup).
    setRevealed(false);
    let alive = true;
    void whenOverlayReady().then(() => {
      if (alive) setRevealed(true);
    });
    return () => {
      alive = false;
      setRevealed(true);
      release();
    };
  }, [peek]);
  return (
    <div ref={ref} className={cls('rb-panel-frame', peek && 'rb-panel-frame--peek')} style={revealed ? undefined : { opacity: 0 }}>
      {children}
    </div>
  );
}

function FileTab({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  // Not while LibreOffice shows a modal dialog for the document (save, close … would run inside it).
  const blocked = useDocBlocked(useActiveDocument()?.docId ?? null);
  const open = () => {
    if (!blocked) onOpen();
  };
  const badge = useKeyTip('root', 'file', 'F', () => {
    open();
    return null;
  });
  return (
    <span className="rb-slot">
      <button type="button" className="rb-filetab" data-tab-item="" onClick={open} aria-haspopup="dialog" aria-disabled={blocked || undefined}>
        {t('shell.ribbon.file')}
      </button>
      <KeyTipBadge text={badge} />
    </span>
  );
}

function TabButton({
  tab,
  selected,
  panelId,
  tabDomId,
  expanded,
  onSelect,
  onToggleCollapse,
}: {
  tab: RibbonTab;
  selected: boolean;
  panelId: string;
  tabDomId: string;
  expanded: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
}) {
  const { t } = useTranslation();
  const badge = useKeyTip('root', `tab:${tab.id}`, tab.keytip, () => {
    onSelect();
    return `tab:${tab.id}`;
  });
  return (
    <span className="rb-slot">
      <button
        type="button"
        role="tab"
        id={tabDomId}
        data-tab-item=""
        data-tab-id={tab.id}
        aria-selected={selected}
        aria-controls={selected && expanded ? panelId : undefined}
        tabIndex={selected ? 0 : -1}
        className={cls('rb-tab', selected && 'rb-tab--selected', tab.contexts && 'rb-tab--contextual', tab.contextualColor && `rb-tab--ctx-${tab.contextualColor}`)}
        onClick={onSelect}
        onDoubleClick={onToggleCollapse}
      >
        {t(tab.labelKey)}
      </button>
      <KeyTipBadge text={badge} />
    </span>
  );
}

function RibbonPanel({ tab, label }: { tab: RibbonTab; label: string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  /** Extra width taken off `width` when the estimated layout still overflows (measured after render). */
  const [correction, setCorrection] = useState(0);
  const widthRef = useRef(0);
  const lastFocused = useRef<number>(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    widthRef.current = el.clientWidth;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (w > widthRef.current + 1) setCorrection(0);
        widthRef.current = w;
        setWidth(w);
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  // Width of every group at every level. `t` is a new function whenever the language changes, so the
  // labels (and with them the widths) are recomputed then.
  const widths = useMemo(
    () =>
      tab.groups.map((g) =>
        ([0, 1, 2, 3] as GroupLevel[]).map((lvl) => groupWidth(g, lvl, (c) => t(c.labelKey), measureUiText, t(g.labelKey))),
      ),
    [tab, t],
  );
  const levels = useMemo(
    () => (width > 0 ? computeGroupLevels(widths, width - correction) : tab.groups.map(() => 0 as GroupLevel)),
    [widths, width, correction, tab.groups],
  );
  const levelsKey = levels.join(',');

  // Estimates can be optimistic: if the rendered content still overflows, reduce further. Runs only
  // when the layout inputs change; `correction` grows monotonically and is bounded by `width`, so this
  // settles after a few renders (it is reset when the ribbon grows).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || width === 0) return;
    const next = nextCorrection(el.scrollWidth, el.clientWidth, width, correction);
    if (next !== correction) setCorrection(next);
  }, [width, correction, levelsKey, widths]);

  const collapsedKeyTips = useMemo(() => {
    const taken = new Set(allControls(tab).map((c) => c.keytip).filter((k): k is string => !!k));
    return assignGroupKeyTips(
      tab.groups.filter((_, i) => levels[i] === 3).map((g) => g.id),
      taken,
    );
  }, [tab, levels]);

  // Roving tabindex over [data-rb-item] elements: one tab stop for the whole panel.
  useLayoutEffect(() => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[data-rb-item]') ?? [])];
    const current = Math.min(lastFocused.current, items.length - 1);
    items.forEach((el, i) => {
      el.tabIndex = i === current ? 0 : -1;
    });
  });

  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[data-rb-item]') ?? [])];
    const i = items.findIndex((el) => el === e.target || el.contains(e.target as Node));
    if (i >= 0 && i !== lastFocused.current) {
      items[lastFocused.current]?.setAttribute('tabindex', '-1');
      lastFocused.current = i;
      items[i]?.setAttribute('tabindex', '0');
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    const inInput = target.tagName === 'INPUT';
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[data-rb-item]') ?? [])];
    const i = items.findIndex((el) => el === target || el.contains(target));
    if (i < 0) return;
    const groupOf = (el: HTMLElement | undefined) => el?.closest('[data-group-id]')?.getAttribute('data-group-id');
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
        if (inInput) return;
        next = e.ctrlKey ? items.findIndex((el, k) => k > i && groupOf(el) !== groupOf(items[i])) : i + 1;
        break;
      case 'ArrowLeft':
        if (inInput) return;
        if (e.ctrlKey) {
          const g = groupOf(items[i]);
          const prevGroupLast = items.slice(0, i).reverse().find((el) => groupOf(el) !== g);
          const pg = groupOf(prevGroupLast);
          next = items.findIndex((el) => groupOf(el) === pg);
        } else next = i - 1;
        break;
      case 'Home':
        if (inInput) return;
        next = 0;
        break;
      case 'End':
        if (inInput) return;
        next = items.length - 1;
        break;
      case 'ArrowUp':
        if (inInput) return;
        next = i - 1;
        break;
      case 'ArrowDown':
        if (inInput) return;
        next = i + 1;
        break;
      default:
        return;
    }
    if (next < 0 || next >= items.length) return;
    e.preventDefault();
    items[next]?.focus();
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      className="rb-groups"
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      {tab.groups.map((g, i) => (
        <GroupView key={g.id} group={g} level={levels[i] ?? 0} scope={`tab:${tab.id}`} collapsedKeyTip={collapsedKeyTips.get(g.id)} />
      ))}
    </div>
  );
}
