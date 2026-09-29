/** Building blocks shared by the ribbon control views. */
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { MenuItemView } from '../../ui/Menu';
import { splitLabel, type GroupLevel } from '../layout';
import { runRibbonAction, useControlRuntime } from '../runtime';
import type { IconComponent, MenuItem, RibbonControl } from '../types';
import type { ScreenTipContent } from '../../ui/ScreenTip';

export interface ControlViewProps<C extends RibbonControl = RibbonControl> {
  control: C;
  level: GroupLevel;
  layout: 'columns' | 'rows';
  /** KeyTip scope the control registers in (`tab:<id>` or `popup:<id>`). */
  scope: string;
}

export function KeyTipBadge({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <span className="rb-keytip" aria-hidden="true">
      {text}
    </span>
  );
}

export function useScreenTipContent(control: { labelKey: string; tipKey?: string; shortcut?: string }): ScreenTipContent {
  const { t } = useTranslation();
  return {
    title: t(control.labelKey),
    description: control.tipKey ? t(control.tipKey) : undefined,
    shortcut: control.shortcut,
  };
}

/** Accessible description: tooltip text + shortcut (screen readers get what the ScreenTip shows). */
export function describe(tip: ScreenTipContent): string | undefined {
  const parts = [tip.description, tip.shortcut].filter(Boolean);
  return parts.length ? parts.join(' — ') : undefined;
}

export function ButtonFace({
  icon: Icon,
  label,
  large,
  showLabel,
  dropdown,
}: {
  icon?: IconComponent;
  label: string;
  large: boolean;
  showLabel: boolean;
  dropdown?: boolean;
}): ReactNode {
  if (large) {
    const [a, b] = splitLabel(label);
    return (
      <>
        <span className="rb-ctl__icon rb-ctl__icon--large" aria-hidden="true">
          {Icon ? <Icon size={30} stroke={1.35} /> : null}
        </span>
        <span className="rb-ctl__label rb-ctl__label--large">
          <span>{a}</span>
          <span>
            {b}
            {dropdown && <IconChevronDown className="rb-ctl__chev" size={11} stroke={2} aria-hidden="true" />}
          </span>
        </span>
      </>
    );
  }
  return (
    <>
      <span className="rb-ctl__icon" aria-hidden="true">
        {Icon ? <Icon size={16} stroke={1.75} /> : null}
      </span>
      {showLabel && <span className="rb-ctl__label">{label}</span>}
      {dropdown && <IconChevronDown className="rb-ctl__chev" size={11} stroke={2} aria-hidden="true" />}
    </>
  );
}

/** A menu entry of a ribbon split/menu control, bound to engine state. */
export function RibbonMenuItem({ item, onDone }: { item: MenuItem; onDone: () => void }) {
  const { t } = useTranslation();
  const rt = useControlRuntime(item.action, item.state);
  // Items with an explicit state binding reflect a checked state (e.g. "Freeze first row").
  const checkable = item.state !== undefined;
  return (
    <MenuItemView
      label={t(item.labelKey)}
      icon={item.icon}
      shortcut={item.shortcut}
      checked={checkable ? rt.pressed : undefined}
      disabled={!rt.enabled}
      separatorBefore={item.separatorBefore}
      onSelect={() => {
        onDone();
        runRibbonAction(item.action);
      }}
    />
  );
}

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
