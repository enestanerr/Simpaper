/** Colour split button: applies the last used colour, the arrow opens a palette with "automatic" and "more colours". */
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Popup } from '../../ui/Popup';
import { useScreenTip } from '../../ui/ScreenTip';
import { useKeyTip } from '../keytipStore';
import { HIGHLIGHT_COLORS, PALETTE_HUES, shadesOf, STANDARD_COLORS, toHex, fromHex, type PaletteHue } from '../palette';
import { runRibbonAction, useControlRuntime } from '../runtime';
import type { ColorControl } from '../types';
import { cls, describe, KeyTipBadge, useScreenTipContent, type ControlViewProps } from './shared';
import { IconChevronDown, IconPalette } from '@tabler/icons-react';

const lastColors = new Map<string, number | null>();

export function ColorView({ control, scope }: ControlViewProps<ColorControl>) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const moreRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<number | null>(() => (lastColors.has(control.id) ? (lastColors.get(control.id) ?? null) : control.defaultColor));
  const rt = useControlRuntime(control.toAction(last), control.state);
  const label = t(control.labelKey);
  const tipContent = useScreenTipContent(control);
  const tip = useScreenTip(tipContent);
  const Icon = control.icon;

  const apply = (color: number | null) => {
    lastColors.set(control.id, color);
    setLast(color);
    setOpen(false);
    runRibbonAction(control.toAction(color));
  };

  const badge = useKeyTip(scope, control.id, control.keytip, () => {
    setOpen(true);
    return null;
  });

  return (
    <span ref={wrapRef} className="rb-slot rb-split rb-split--small rb-color" {...tip.props}>
      <button
        type="button"
        data-rb-item=""
        data-control-id={control.id}
        className="rb-ctl rb-ctl--small rb-ctl--icon rb-split__main"
        aria-label={label}
        aria-disabled={!rt.enabled || undefined}
        aria-description={describe(tipContent)}
        tabIndex={-1}
        onClick={() => rt.enabled && apply(last)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'F4') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="rb-color__icon" aria-hidden="true">
          {Icon ? <Icon size={16} stroke={1.75} /> : <IconPalette size={16} stroke={1.75} />}
          <span className={cls('rb-color__bar', last === null && 'rb-color__bar--none')} style={last === null ? undefined : { background: toHex(last) }} />
        </span>
      </button>
      <button
        type="button"
        className="rb-ctl rb-split__arrow"
        aria-label={t('shell.ribbon.moreOptions', { name: label })}
        aria-haspopup="dialog"
        aria-expanded={open}
        tabIndex={-1}
        onClick={() => setOpen((o) => !o)}
      >
        <IconChevronDown className="rb-ctl__chev" size={11} stroke={2} aria-hidden="true" />
      </button>
      <KeyTipBadge text={badge} />
      {tip.element}
      <Popup anchor={wrapRef.current} open={open} onClose={() => setOpen(false)} role="dialog" ariaLabel={label} className="rb-colorpop">
        <ColorPalette
          control={control}
          onPick={apply}
          onMore={() => {
            setOpen(false);
            moreRef.current?.click();
          }}
        />
      </Popup>
      {/* Outside the popup: the native colour dialog blurs the window, which closes the popup. */}
      <input
        ref={moreRef}
        type="color"
        className="vr-visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const c = fromHex(e.target.value);
          if (c !== null) apply(c);
        }}
      />
    </span>
  );
}

function ColorPalette({ control, onPick, onMore }: { control: ColorControl; onPick: (color: number | null) => void; onMore: () => void }) {
  const { t } = useTranslation();
  const hueName = (h: PaletteHue) => t(`shell.color.hue.${h.hue}`);

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>, columns: number) => {
    const swatches = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const i = swatches.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    swatches[Math.max(0, Math.min(swatches.length - 1, i + move))]?.focus();
  };

  const swatch = (color: number, name: string, key: string, autoFocus = false) => (
    <button
      key={key}
      type="button"
      className="rb-swatch"
      style={{ background: toHex(color) }}
      aria-label={name}
      title={`${name} (${toHex(color)})`}
      data-autofocus={autoFocus || undefined}
      onClick={() => onPick(color)}
    />
  );

  return (
    <div className="rb-palette">
      <button type="button" className="rb-palette__none" onClick={() => onPick(null)}>
        <span className="rb-swatch rb-swatch--none" aria-hidden="true" />
        {t(control.noneLabelKey ?? 'shell.color.automatic')}
      </button>
      {control.palette === 'highlight' ? (
        <div className="rb-palette__grid rb-palette__grid--5" role="group" aria-label={t('shell.color.highlightColors')} onKeyDown={(e) => onGridKey(e, 5)}>
          {HIGHLIGHT_COLORS.map((h, i) => swatch(h.base, hueName(h), h.hue, i === 0))}
        </div>
      ) : (
        <>
          <div className="rb-palette__title">{t('shell.color.paletteColors')}</div>
          <div className="rb-palette__grid rb-palette__grid--10" role="group" aria-label={t('shell.color.paletteColors')} onKeyDown={(e) => onGridKey(e, 10)}>
            {PALETTE_HUES.map((h, i) => swatch(h.base, hueName(h), `b-${h.hue}`, i === 0))}
            {[0, 1, 2, 3, 4].flatMap((row) =>
              PALETTE_HUES.map((h) => {
                const s = shadesOf(h.base)[row]!;
                return swatch(s.color, t('shell.color.shaded', { hue: hueName(h), shade: t(`shell.color.shade.${s.shade}`) }), `${h.hue}-${row}`);
              }),
            )}
          </div>
          <div className="rb-palette__title">{t('shell.color.standardColors')}</div>
          <div className="rb-palette__grid rb-palette__grid--10" role="group" aria-label={t('shell.color.standardColors')} onKeyDown={(e) => onGridKey(e, 10)}>
            {STANDARD_COLORS.map((h) => swatch(h.base, hueName(h), `s-${h.hue}`))}
          </div>
        </>
      )}
      <button type="button" className="rb-palette__more" onClick={onMore}>
        <IconPalette size={16} stroke={1.75} aria-hidden="true" />
        {t('shell.color.more')}
      </button>
    </div>
  );
}
