/** A ribbon group at a given size level (full, reduced, icon-only, or collapsed into a popup button). */
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowDownRight, IconLayoutGrid } from '@tabler/icons-react';
import { Popup } from '../ui/Popup';
import { ControlView } from './ControlView';
import { ButtonFace, cls, KeyTipBadge } from './controls/shared';
import { columnsOf, isLarge, splitRows, type GroupLevel } from './layout';
import { useKeyTip } from './keytipStore';
import { runRibbonAction, useControlRuntime } from './runtime';
import type { RibbonGroup } from './types';

export interface GroupViewProps {
  group: RibbonGroup;
  level: GroupLevel;
  scope: string;
  /** KeyTip for the collapsed group button (assigned at runtime). */
  collapsedKeyTip?: string;
}

export function GroupView({ group, level, scope, collapsedKeyTip }: GroupViewProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const label = t(group.labelKey);
  if (level >= 3) return <CollapsedGroup group={group} scope={scope} keytip={collapsedKeyTip} label={label} />;
  return (
    <div role="group" aria-labelledby={labelId} className="rb-group" data-group-id={group.id} data-level={level}>
      <div className="rb-group__body">
        <GroupBody group={group} level={level} scope={scope} />
      </div>
      <div className="rb-group__footer">
        <span id={labelId} className="rb-group__label">
          {label}
        </span>
        {group.launcher && <Launcher group={group} label={label} />}
      </div>
    </div>
  );
}

export function GroupBody({ group, level, scope }: { group: RibbonGroup; level: GroupLevel; scope: string }) {
  const layout = group.layout ?? 'columns';
  if (layout === 'rows') {
    const leading = group.controls.filter((c) => isLarge(c, level));
    const rows = splitRows(group.controls.filter((c) => !isLarge(c, level)));
    return (
      <>
        {leading.map((c) => (
          <div key={c.id} className="rb-col">
            <ControlView control={c} level={level} layout={layout} scope={scope} />
          </div>
        ))}
        <div className={cls('rb-rows', rows.length >= 3 && 'rb-rows--3')}>
          {rows.map((row, i) => (
            <div key={i} className="rb-row">
              {row.map((c) => (
                <ControlView key={c.id} control={c} level={level} layout={layout} scope={scope} />
              ))}
            </div>
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      {columnsOf(group.controls, level).map((column, i) => (
        <div key={i} className={cls('rb-col', column.length > 1 && 'rb-col--stack')}>
          {column.map((c) => (
            <ControlView key={c.id} control={c} level={level} layout={layout} scope={scope} />
          ))}
        </div>
      ))}
    </>
  );
}

function Launcher({ group, label }: { group: RibbonGroup; label: string }) {
  const { t } = useTranslation();
  const rt = useControlRuntime(group.launcher);
  const name = t(group.launcherLabelKey ?? 'shell.ribbon.groupSettings', { name: label });
  return (
    <button
      type="button"
      className="rb-launcher"
      aria-label={name}
      title={name}
      aria-disabled={!rt.enabled || undefined}
      tabIndex={-1}
      data-rb-item=""
      onClick={() => rt.enabled && group.launcher && runRibbonAction(group.launcher)}
    >
      <IconArrowDownRight size={12} stroke={2} aria-hidden="true" />
    </button>
  );
}

/** An enabled item of a menu opened from inside the group popup. */
const MENU_COMMAND = '[role^="menuitem"]:not([aria-disabled="true"])';

/** Whether an event target inside a collapsed group's popup runs a command (and so ends the popup). */
function runsCommand(target: HTMLElement): boolean {
  const command = target.closest('[data-rb-item]') ?? target.closest(MENU_COMMAND);
  return !!command && !target.closest('[aria-haspopup]') && !target.closest('input');
}

function CollapsedGroup({ group, scope, keytip, label }: { group: RibbonGroup; scope: string; keytip?: string; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const popupScope = `popup:${group.id}`;
  const Icon = group.controls.find((c) => c.icon)?.icon ?? IconLayoutGrid;
  const badge = useKeyTip(scope, `group:${group.id}`, keytip, () => {
    setOpen(true);
    return popupScope;
  });
  return (
    <div className="rb-group rb-group--collapsed" data-group-id={group.id} data-level={3}>
      <span className="rb-slot">
        <button
          ref={ref}
          type="button"
          data-rb-item=""
          className={cls('rb-ctl rb-ctl--large', open && 'rb-ctl--open')}
          aria-haspopup="dialog"
          aria-expanded={open}
          tabIndex={-1}
          onClick={() => setOpen((o) => !o)}
        >
          <ButtonFace icon={Icon} label={label} large showLabel dropdown />
        </button>
        <KeyTipBadge text={badge} />
      </span>
      <Popup anchor={ref.current} open={open} onClose={() => setOpen(false)} role="dialog" ariaLabel={label} className="rb-grouppop">
        <div
          role="group"
          aria-label={label}
          className="rb-group rb-group--popup"
          onClick={(e) => {
            // A command inside the popup closes it (menus inside manage themselves). Events of a nested menu
            // (portaled to document.body) arrive here through React's tree: choosing an item closes the group too.
            if (runsCommand(e.target as HTMLElement)) setOpen(false);
          }}
          onKeyDown={(e) => {
            // Menu items are chosen with Enter/Space without a click event (buttons get one from the browser).
            const target = e.target as HTMLElement;
            if ((e.key === 'Enter' || e.key === ' ') && target.closest(MENU_COMMAND) && runsCommand(target)) setOpen(false);
          }}
        >
          <div className="rb-group__body">
            <GroupBody group={group} level={0} scope={popupScope} />
          </div>
          <div className="rb-group__footer">
            <span className="rb-group__label">{label}</span>
            {group.launcher && <Launcher group={group} label={label} />}
          </div>
        </div>
      </Popup>
    </div>
  );
}
