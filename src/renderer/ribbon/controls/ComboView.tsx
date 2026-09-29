/** Editable combo box (APG combobox with listbox popup): font name, font size, number format ... */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentLanguage } from '../../i18n';
import { fold } from '../../i18n/turkish';
import { fontHeightFromState, fontNameFromState, unoString } from '../../services/unoValues';
import { FONT_SIZES, formatFontSize, parseFontSize, useFontList } from '../../services/fonts';
import { Popup } from '../../ui/Popup';
import { useScreenTip } from '../../ui/ScreenTip';
import { comboWidthPx } from '../layout';
import { useKeyTip } from '../keytipStore';
import { runRibbonAction, useActiveDocument, useControlRuntime } from '../runtime';
import type { ComboControl } from '../types';
import { cls, describe, KeyTipBadge, useScreenTipContent, type ControlViewProps } from './shared';

interface Option {
  value: string;
  label: string;
}

export function ComboView({ control, level, scope }: ControlViewProps<ComboControl>) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const doc = useActiveDocument();
  const rt = useControlRuntime(undefined, control.state);
  const fonts = useFontList(control.options === 'fonts', doc?.docId ?? null);
  const label = t(control.labelKey);
  const tipContent = useScreenTipContent(control);
  const tip = useScreenTip(tipContent);

  const options: Option[] = useMemo(() => {
    if (control.options === 'fonts') return fonts.map((f) => ({ value: f, label: f }));
    if (control.options === 'fontSizes') return FONT_SIZES.map((s) => ({ value: String(s), label: formatFontSize(s, lang) }));
    return control.options.map((o) => ({ value: o.value, label: o.label ?? (o.labelKey ? t(o.labelKey) : o.value) }));
  }, [control.options, fonts, lang, t]);

  const current = useMemo(() => {
    const v = rt.value ?? null;
    if (control.state?.display) {
      // display() may return an option value (e.g. a number format id) or a ready-made text.
      const d = control.state.display(v);
      return options.find((o) => o.value === d)?.label ?? d;
    }
    if (control.options === 'fonts') return fontNameFromState(v) ?? '';
    if (control.options === 'fontSizes') {
      const h = fontHeightFromState(v);
      return h === null ? '' : formatFontSize(h, lang);
    }
    const s = unoString(v);
    return options.find((o) => o.value === s)?.label ?? s ?? '';
  }, [rt.value, control.state, control.options, options, lang]);

  const [text, setText] = useState(current);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!editing) {
      setText(current);
      setInvalid(false);
    }
  }, [current, editing]);

  const filtered = useMemo(() => {
    if (!editing || !text || text === current) return options;
    const q = fold(text, lang);
    const starts = options.filter((o) => fold(o.label, lang).startsWith(q));
    return starts.length > 0 ? starts : options;
  }, [editing, text, current, options, lang]);

  const commit = (raw: string) => {
    let value = raw.trim();
    if (!value) return revert();
    if (control.options === 'fontSizes') {
      const n = parseFontSize(value);
      if (n === null) {
        setInvalid(true);
        return;
      }
      value = String(n);
    } else if (Array.isArray(control.options)) {
      const byLabel = control.options.find((o) => (o.label ?? (o.labelKey ? t(o.labelKey) : o.value)) === value);
      if (byLabel) value = byLabel.value;
      else if (!control.editable && !control.options.some((o) => o.value === value)) return revert();
    }
    setOpen(false);
    setEditing(false);
    setInvalid(false);
    runRibbonAction(control.toAction(value));
  };

  const revert = () => {
    setText(current);
    setEditing(false);
    setOpen(false);
    setInvalid(false);
  };

  const badge = useKeyTip(scope, control.id, control.keytip, () => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return null;
  });

  const disabled = !rt.enabled;
  const activeOption = active >= 0 ? filtered[active] : undefined;

  return (
    <span className="rb-slot rb-combo" style={{ width: comboWidthPx(control.width ?? 12, level) }} {...tip.props}>
      <input
        ref={inputRef}
        data-rb-item=""
        data-control-id={control.id}
        className={cls('rb-combo__input', invalid && 'rb-combo__input--invalid')}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeOption ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-description={describe(tipContent)}
        aria-disabled={disabled || undefined}
        readOnly={disabled}
        tabIndex={-1}
        spellCheck={false}
        value={text}
        onFocus={(e) => {
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setEditing(true);
          setOpen(true);
          setActive(0);
          setInvalid(false);
        }}
        onBlur={() => {
          if (!open) revert();
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              setEditing(true);
              setActive(Math.max(0, filtered.findIndex((o) => o.label === text)));
              return;
            }
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => Math.max(0, Math.min(filtered.length - 1, i + delta)));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            commit(open && activeOption ? activeOption.value : text);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            revert();
          }
        }}
      />
      <button
        type="button"
        className="rb-combo__arrow"
        aria-label={t('shell.ribbon.openList', { name: label })}
        tabIndex={-1}
        disabled={disabled}
        onClick={() => {
          setEditing(true);
          setOpen((o) => !o);
          setActive(Math.max(0, options.findIndex((o) => o.label === current)));
          inputRef.current?.focus();
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <KeyTipBadge text={badge} />
      {tip.element}
      <Popup anchor={inputRef.current?.parentElement ?? null} open={open} onClose={revert} autoFocus={false} restoreFocus={false} matchAnchorWidth className="rb-listbox-popup">
        <ul id={listId} role="listbox" aria-label={label} className="rb-listbox">
          {filtered.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cls('rb-listbox__option', i === active && 'rb-listbox__option--active', o.label === current && 'rb-listbox__option--current')}
              style={control.options === 'fonts' ? { fontFamily: `"${o.value}", var(--font-ui)` } : undefined}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => commit(o.value)}
              onPointerEnter={() => setActive(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      </Popup>
    </span>
  );
}
