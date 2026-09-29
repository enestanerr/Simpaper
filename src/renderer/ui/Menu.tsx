/** Accessible menu (APG menu pattern) rendered in a Popup. Items are plain children with menuitem roles. */
import type { KeyboardEvent, ReactNode } from 'react';
import type { IconComponent } from '../ribbon/types';
import { currentLanguage } from '../i18n';
import { fold } from '../i18n/turkish';
import { Popup, type PopupCloseReason } from './Popup';

export interface MenuPopupProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: (reason: PopupCloseReason) => void;
  label: string;
  children: ReactNode;
  placement?: 'below' | 'right' | 'above';
  className?: string;
}

function menuItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')];
}

export function handleMenuKeyDown(e: KeyboardEvent<HTMLElement>): void {
  const menu = e.currentTarget;
  const items = menuItems(menu);
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus();
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      focusAt(current + 1);
      return;
    case 'ArrowUp':
      e.preventDefault();
      focusAt(current < 0 ? items.length - 1 : current - 1);
      return;
    case 'Home':
      e.preventDefault();
      focusAt(0);
      return;
    case 'End':
      e.preventDefault();
      focusAt(items.length - 1);
      return;
    default:
      break;
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const lang = currentLanguage();
    const ch = fold(e.key, lang);
    for (let k = 1; k <= items.length; k++) {
      const item = items[(current + k) % items.length];
      const text = fold(item?.dataset['label'] ?? item?.textContent ?? '', lang);
      if (item && text.startsWith(ch)) {
        item.focus();
        break;
      }
    }
  }
}

export function MenuPopup({ anchor, open, onClose, label, children, placement, className }: MenuPopupProps) {
  return (
    <Popup anchor={anchor} open={open} onClose={onClose} placement={placement} className={`vr-menu${className ? ` ${className}` : ''}`}>
      <div role="menu" aria-label={label} onKeyDown={handleMenuKeyDown}>
        {children}
      </div>
    </Popup>
  );
}

export interface MenuItemViewProps {
  label: string;
  icon?: IconComponent;
  shortcut?: string;
  /** Renders a menuitemcheckbox when defined. */
  checked?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  description?: string;
  onSelect: () => void;
}

export function MenuItemView({ label, icon: Icon, shortcut, checked, disabled, separatorBefore, description, onSelect }: MenuItemViewProps) {
  const activate = () => {
    if (!disabled) onSelect();
  };
  return (
    <>
      {separatorBefore && <div role="separator" className="vr-menu__sep" />}
      <div
        role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={checked === undefined ? undefined : checked}
        aria-disabled={disabled || undefined}
        aria-keyshortcuts={shortcut}
        aria-description={description}
        data-label={label}
        tabIndex={-1}
        className="vr-menu__item"
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        }}
      >
        <span className="vr-menu__icon" aria-hidden="true">
          {Icon ? <Icon size={16} stroke={1.75} /> : checked ? <span className="vr-menu__check">✓</span> : null}
        </span>
        <span className="vr-menu__label">{label}</span>
        {shortcut && <span className="vr-menu__shortcut">{shortcut}</span>}
      </div>
    </>
  );
}
