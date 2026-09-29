/** In-ribbon gallery (e.g. paragraph styles, slide layouts) with a "more" popup showing all items. */
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@tabler/icons-react';
import { Popup } from '../../ui/Popup';
import { useScreenTip } from '../../ui/ScreenTip';
import { galleryInline, type GroupLevel } from '../layout';
import { useKeyTip } from '../keytipStore';
import { runRibbonAction, useControlRuntime } from '../runtime';
import type { GalleryControl, GalleryItem } from '../types';
import { ButtonFace, cls, describe, KeyTipBadge, useScreenTipContent, type ControlViewProps } from './shared';

function useItemLabel() {
  const { t } = useTranslation();
  return (item: GalleryItem) => item.label ?? (item.labelKey ? t(item.labelKey) : item.id);
}

export function GalleryView({ control, level, scope }: ControlViewProps<GalleryControl>) {
  const { t } = useTranslation();
  const itemLabel = useItemLabel();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const firstAction = control.items[0]?.action;
  const rt = useControlRuntime(firstAction, control.state);
  const current = control.state?.display ? control.state.display(rt.value ?? null) : undefined;
  const label = t(control.labelKey);
  const tipContent = useScreenTipContent(control);
  const tip = useScreenTip(tipContent);
  const inline = galleryInline(control, level as GroupLevel);

  const pick = (item: GalleryItem) => {
    setOpen(false);
    runRibbonAction(item.action);
  };

  const badge = useKeyTip(scope, control.id, control.keytip, () => {
    setOpen(true);
    return null;
  });

  const popup = (
    <Popup anchor={anchorRef.current} open={open} onClose={() => setOpen(false)} className="rb-gallerypop">
      <div role="listbox" aria-label={label} className="rb-gallery__grid" onKeyDown={galleryKeys}>
        {control.items.map((item, i) => (
          <GalleryOption key={item.id} item={item} label={itemLabel(item)} selected={item.id === current} disabled={!rt.enabled} onPick={pick} autoFocus={i === 0} />
        ))}
      </div>
    </Popup>
  );

  if (inline === 0) {
    return (
      <span ref={anchorRef} className="rb-slot" {...tip.props}>
        <button
          type="button"
          data-rb-item=""
          data-control-id={control.id}
          className={cls('rb-ctl rb-ctl--large', open && 'rb-ctl--open')}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-disabled={!rt.enabled || undefined}
          aria-description={describe(tipContent)}
          tabIndex={-1}
          onClick={() => setOpen((o) => !o)}
        >
          <ButtonFace icon={control.icon} label={label} large showLabel dropdown />
        </button>
        <KeyTipBadge text={badge} />
        {tip.element}
        {popup}
      </span>
    );
  }

  return (
    <span ref={anchorRef} className="rb-slot rb-gallery" {...tip.props}>
      <span role="listbox" aria-label={label} aria-orientation="horizontal" className="rb-gallery__inline">
        {control.items.slice(0, inline).map((item) => (
          <GalleryOption key={item.id} item={item} label={itemLabel(item)} selected={item.id === current} disabled={!rt.enabled} onPick={pick} rovingItem />
        ))}
      </span>
      <button
        type="button"
        className="rb-gallery__more"
        aria-label={t('shell.ribbon.moreItems', { name: label })}
        aria-haspopup="listbox"
        aria-expanded={open}
        tabIndex={-1}
        data-rb-item=""
        onClick={() => setOpen((o) => !o)}
      >
        <IconChevronDown size={12} stroke={2} aria-hidden="true" />
      </button>
      <KeyTipBadge text={badge} />
      {tip.element}
      {popup}
    </span>
  );
}

function galleryKeys(e: KeyboardEvent<HTMLDivElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (delta === undefined || i < 0) return;
  e.preventDefault();
  items[Math.max(0, Math.min(items.length - 1, i + delta))]?.focus();
}

function GalleryOption({
  item,
  label,
  selected,
  disabled,
  onPick,
  rovingItem,
  autoFocus,
}: {
  item: GalleryItem;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPick: (item: GalleryItem) => void;
  rovingItem?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <span
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      data-rb-item={rovingItem ? '' : undefined}
      data-autofocus={autoFocus || undefined}
      className={cls('rb-gallery__item', selected && 'rb-gallery__item--selected')}
      onClick={() => !disabled && onPick(item)}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault();
          onPick(item);
        }
      }}
    >
      <span className="rb-gallery__preview" style={item.previewStyle}>
        {label}
      </span>
    </span>
  );
}
