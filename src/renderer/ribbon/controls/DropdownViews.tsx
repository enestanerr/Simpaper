/** Split buttons (action + menu) and menu buttons. */
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MenuPopup } from '../../ui/Menu';
import { useScreenTip } from '../../ui/ScreenTip';
import { isLarge, showsLabel } from '../layout';
import { useKeyTip } from '../keytipStore';
import { runRibbonAction, useControlRuntime } from '../runtime';
import type { MenuControl, SplitButtonControl } from '../types';
import { ButtonFace, cls, describe, KeyTipBadge, RibbonMenuItem, useScreenTipContent, type ControlViewProps } from './shared';

function isMenuOpenKey(e: KeyboardEvent): boolean {
  return e.key === 'ArrowDown' || e.key === 'F4' || (e.altKey && e.key === 'ArrowDown');
}

export function SplitView({ control, level, layout, scope }: ControlViewProps<SplitButtonControl>) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const rt = useControlRuntime(control.action, control.state);
  const label = t(control.labelKey);
  const tipContent = useScreenTipContent(control);
  const tip = useScreenTip(tipContent);
  const large = isLarge(control, level);
  const labelled = showsLabel(control, level, layout);

  const badge = useKeyTip(scope, control.id, control.keytip, () => {
    setOpen(true);
    return null;
  });

  return (
    <span ref={wrapRef} className={cls('rb-slot', 'rb-split', large ? 'rb-split--large' : 'rb-split--small')} {...tip.props}>
      <button
        type="button"
        data-rb-item=""
        data-control-id={control.id}
        className={cls('rb-ctl', 'rb-split__main', large ? 'rb-ctl--large' : 'rb-ctl--small', !labelled && !large && 'rb-ctl--icon', rt.pressed && control.state && 'rb-ctl--checked')}
        aria-label={labelled || large ? undefined : label}
        aria-disabled={!rt.enabled || undefined}
        aria-description={describe(tipContent)}
        aria-keyshortcuts={control.shortcut}
        tabIndex={-1}
        onClick={() => rt.enabled && runRibbonAction(control.action)}
        onKeyDown={(e) => {
          if (isMenuOpenKey(e)) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {large ? (
          <span className="rb-ctl__icon rb-ctl__icon--large" aria-hidden="true">
            {control.icon ? <control.icon size={30} stroke={1.35} /> : null}
          </span>
        ) : (
          <ButtonFace icon={control.icon} label={label} large={false} showLabel={labelled} />
        )}
      </button>
      <button
        type="button"
        className={cls('rb-ctl', 'rb-split__arrow', large && 'rb-split__arrow--large')}
        aria-label={t('shell.ribbon.moreOptions', { name: label })}
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={-1}
        onClick={() => setOpen((o) => !o)}
      >
        {large ? <ButtonFace label={label} large={false} showLabel dropdown /> : <ButtonFace label="" large={false} showLabel={false} dropdown />}
      </button>
      <KeyTipBadge text={badge} />
      {tip.element}
      <MenuPopup anchor={wrapRef.current} open={open} onClose={() => setOpen(false)} label={label}>
        {control.items.map((item) => (
          <RibbonMenuItem key={item.id} item={item} onDone={() => setOpen(false)} />
        ))}
      </MenuPopup>
    </span>
  );
}

export function MenuButtonView({ control, level, layout, scope }: ControlViewProps<MenuControl>) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = t(control.labelKey);
  const tipContent = useScreenTipContent(control);
  const tip = useScreenTip(tipContent);
  const large = isLarge(control, level);
  const labelled = showsLabel(control, level, layout);
  const rt = useControlRuntime(undefined, control.state);

  const badge = useKeyTip(scope, control.id, control.keytip, () => {
    setOpen(true);
    return null;
  });

  return (
    <span className="rb-slot">
      <button
        ref={ref}
        type="button"
        data-rb-item=""
        data-control-id={control.id}
        className={cls('rb-ctl', large ? 'rb-ctl--large' : 'rb-ctl--small', !labelled && !large && 'rb-ctl--icon', open && 'rb-ctl--open')}
        aria-label={labelled || large ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={(control.state && !rt.enabled) || undefined}
        aria-description={describe(tipContent)}
        tabIndex={-1}
        {...tip.props}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          tip.hide();
          if (isMenuOpenKey(e)) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ButtonFace icon={control.icon} label={label} large={large} showLabel={labelled} dropdown />
      </button>
      <KeyTipBadge text={badge} />
      {tip.element}
      <MenuPopup anchor={ref.current} open={open} onClose={() => setOpen(false)} label={label}>
        {control.items.map((item) => (
          <RibbonMenuItem key={item.id} item={item} onDone={() => setOpen(false)} />
        ))}
      </MenuPopup>
    </span>
  );
}
