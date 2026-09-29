/** "Insert table" with a size grid (Writer, Impress): `.uno:InsertTable` with Columns/Rows (short). */
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTable } from '@tabler/icons-react';
import { Popup } from '../../ui/Popup';
import { useScreenTip } from '../../ui/ScreenTip';
import { ButtonFace, cls } from '../../ribbon/controls/shared';
import { runRibbonAction, useControlRuntime } from '../../ribbon/runtime';
import type { CustomControl, RibbonAction } from '../../ribbon/types';
import { uno } from './controls';

const COLS = 10;
const ROWS = 8;

export function insertTableAction(columns: number, rows: number): RibbonAction {
  return uno('.uno:InsertTable', { Columns: { type: 'short', value: columns }, Rows: { type: 'short', value: rows } });
}

function TableGridButton() {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState({ c: 1, r: 1 });
  const rt = useControlRuntime(uno('.uno:InsertTable'));
  const label = t('common.cmd.table');
  const tip = useScreenTip({ title: label, description: t('common.tip.table') });

  const insert = (c: number, r: number) => {
    setOpen(false);
    runRibbonAction(insertTableAction(c, r));
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      setSize((s) => ({ c: Math.min(COLS, Math.max(1, s.c + m[0])), r: Math.min(ROWS, Math.max(1, s.r + m[1])) }));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      insert(size.c, size.r);
    }
  };

  return (
    <span className="rb-slot">
      <button
        ref={ref}
        type="button"
        data-rb-item=""
        className={cls('rb-ctl rb-ctl--large', open && 'rb-ctl--open')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-disabled={!rt.enabled || undefined}
        tabIndex={-1}
        onClick={() => rt.enabled && setOpen((o) => !o)}
        {...tip.props}
      >
        <ButtonFace icon={IconTable} label={label} large showLabel dropdown />
      </button>
      {tip.element}
      <Popup anchor={ref.current} open={open} onClose={() => setOpen(false)} role="dialog" ariaLabel={label} className="vr-tablegrid">
        <div className="vr-tablegrid__title" aria-live="polite">
          {t('common.cmd.tableSize', { columns: size.c, rows: size.r })}
        </div>
        <div
          className="vr-tablegrid__grid"
          role="grid"
          aria-label={label}
          aria-rowcount={ROWS}
          aria-colcount={COLS}
          tabIndex={0}
          data-autofocus=""
          onKeyDown={onGridKey}
        >
          {Array.from({ length: ROWS }, (_, r) => (
            <div key={r} role="row" className="vr-tablegrid__row">
              {Array.from({ length: COLS }, (_, c) => (
                <span
                  key={c}
                  role="gridcell"
                  aria-selected={c < size.c && r < size.r}
                  className={cls('vr-tablegrid__cell', c < size.c && r < size.r && 'vr-tablegrid__cell--on')}
                  onPointerEnter={() => setSize({ c: c + 1, r: r + 1 })}
                  onClick={() => insert(c + 1, r + 1)}
                />
              ))}
            </div>
          ))}
        </div>
        <button type="button" className="vr-menu__item vr-tablegrid__more" onClick={() => {
          setOpen(false);
          runRibbonAction(uno('.uno:InsertTable'));
        }}>
          {t('common.cmd.insertTableDialog')}
        </button>
      </Popup>
    </span>
  );
}

export function tableGridControl(keytip = 'T'): CustomControl {
  return {
    type: 'custom',
    id: 'insertTable',
    labelKey: 'common.cmd.table',
    tipKey: 'common.tip.table',
    icon: IconTable,
    keytip,
    render: TableGridButton,
    estimatedWidth: 50,
    stateCommands: ['.uno:InsertTable'],
  };
}
