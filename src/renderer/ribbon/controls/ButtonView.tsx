/** Button and toggle controls. */
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { isLarge, showsLabel } from '../layout';
import { useKeyTip } from '../keytipStore';
import { runRibbonAction, useControlRuntime } from '../runtime';
import type { ButtonControl, ToggleControl } from '../types';
import { useScreenTip } from '../../ui/ScreenTip';
import { ButtonFace, cls, describe, KeyTipBadge, useScreenTipContent, type ControlViewProps } from './shared';

export function ButtonView({ control, level, layout, scope }: ControlViewProps<ButtonControl | ToggleControl>) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const rt = useControlRuntime(control.action, control.state);
  const label = t(control.labelKey);
  const tipContent = useScreenTipContent(control);
  const tip = useScreenTip(tipContent);
  const large = isLarge(control, level);
  const labelled = showsLabel(control, level, layout);
  const isToggle = control.type === 'toggle';

  const activate = () => {
    if (!rt.enabled) return;
    if (control.type === 'toggle' && control.exclusive && rt.pressed) return;
    runRibbonAction(control.action);
  };
  const badge = useKeyTip(scope, control.id, control.keytip, () => {
    activate();
    return null;
  });

  return (
    <span className="rb-slot">
      <button
        ref={ref}
        type="button"
        data-rb-item=""
        data-control-id={control.id}
        className={cls('rb-ctl', large ? 'rb-ctl--large' : 'rb-ctl--small', !labelled && !large && 'rb-ctl--icon', isToggle && rt.pressed && 'rb-ctl--checked')}
        aria-label={labelled || large ? undefined : label}
        aria-pressed={isToggle ? rt.pressed : undefined}
        aria-disabled={!rt.enabled || undefined}
        aria-description={describe(tipContent)}
        aria-keyshortcuts={control.shortcut}
        tabIndex={-1}
        onClick={activate}
        {...tip.props}
      >
        <ButtonFace icon={control.icon} label={label} large={large} showLabel={labelled} />
      </button>
      <KeyTipBadge text={badge} />
      {tip.element}
    </span>
  );
}
