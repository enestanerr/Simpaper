/** View › Show › Formula bar: toggles Varak's own formula bar (renderer view option). */
import { useTranslation } from 'react-i18next';
import { IconMathFunction } from '@tabler/icons-react';
import { cls } from '../../ribbon/controls/shared';
import type { CustomControl } from '../../ribbon/types';
import { useApp } from '../../state/appStore';

export function toggleFormulaBar(): void {
  useApp.setState((s) => ({ formulaBarVisible: !s.formulaBarVisible }));
}

function FormulaBarToggleButton() {
  const { t } = useTranslation();
  const visible = useApp((s) => s.formulaBarVisible);
  const label = t('calc.cmd.formulaBar');
  return (
    <button
      type="button"
      data-rb-item=""
      className={cls('rb-ctl rb-ctl--small', visible && 'rb-ctl--checked')}
      aria-pressed={visible}
      tabIndex={-1}
      onClick={toggleFormulaBar}
    >
      <span className="rb-ctl__icon" aria-hidden="true">
        <IconMathFunction size={16} stroke={1.75} />
      </span>
      <span className="rb-ctl__label">{label}</span>
    </button>
  );
}

export function formulaBarToggle(keytip: string): CustomControl {
  return {
    type: 'custom',
    id: 'formulaBar',
    labelKey: 'calc.cmd.formulaBar',
    icon: IconMathFunction,
    keytip,
    render: FormulaBarToggleButton,
    estimatedWidth: 104,
  };
}
