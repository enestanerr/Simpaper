/**
 * Custom ribbon controls of the PDF module (rendered by the shell inside ribbon groups): page number box,
 * zoom box and the size/thickness choosers. Each shows the live value of the active document.
 */
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { controllerFor } from '../controller/registry';
import { parseZoomValue, zoomPercent, type ZoomMode } from '../logic/zoom';
import { usePdfDoc } from '../state/store';

const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200, 300, 400];
const ZOOM_MODES: ZoomMode[] = ['page-width', 'page-fit', 'page-actual', 'auto'];
export const TEXT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
export const THICKNESSES = [1, 2, 3, 4, 6, 8, 12, 16, 20];

/** Focus handler for the shell's keytips, which `click()` the first [data-rb-item]. */
const focusSelf = (e: { currentTarget: HTMLElement }) => e.currentTarget.focus();

export function PageNumberBox({ docId }: { docId: string | null }) {
  const { t } = useTranslation();
  const current = usePdfDoc(docId, (s) => s.currentPage);
  const total = usePdfDoc(docId, (s) => s.pageCount);
  const ready = usePdfDoc(docId, (s) => s.status === 'ready');
  const [text, setText] = useState(String(current));
  const id = useId();
  useEffect(() => setText(String(current)), [current]);

  const commit = () => {
    const n = Number(text.trim());
    if (Number.isInteger(n) && n >= 1 && n <= total) controllerFor(docId)?.goToPage(n);
    else setText(String(current));
  };

  return (
    <span className="vpdf-rc">
      <label className="vpdf-rc__label" htmlFor={id}>
        {t('pdf.ribbon.page')}
      </label>
      <input
        id={id}
        data-rb-item=""
        className="vpdf-rc__input vpdf-rc__input--page"
        inputMode="numeric"
        aria-label={t('pdf.ribbon.pageNumber', { total })}
        disabled={!ready}
        value={text}
        onClick={focusSelf}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            controllerFor(docId)?.focusDocument();
          } else if (e.key === 'Escape') {
            setText(String(current));
          }
        }}
      />
      <span className="vpdf-rc__suffix" aria-hidden="true">
        / {total}
      </span>
    </span>
  );
}

export function ZoomBox({ docId }: { docId: string | null }) {
  const { t } = useTranslation();
  const scale = usePdfDoc(docId, (s) => s.scale);
  const scaleValue = usePdfDoc(docId, (s) => s.scaleValue);
  const ready = usePdfDoc(docId, (s) => s.status === 'ready');
  const id = useId();
  const percent = zoomPercent(scale);
  const isMode = (ZOOM_MODES as string[]).includes(scaleValue);
  const value = isMode ? scaleValue : String(percent);
  const presets = ZOOM_PRESETS.includes(percent) || isMode ? ZOOM_PRESETS : [...ZOOM_PRESETS, percent].sort((a, b) => a - b);

  return (
    <span className="vpdf-rc">
      <label className="vpdf-rc__label" htmlFor={id}>
        {t('pdf.ribbon.zoom')}
      </label>
      <select
        id={id}
        data-rb-item=""
        className="vpdf-rc__select"
        disabled={!ready}
        value={value}
        onClick={focusSelf}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const parsed = ZOOM_MODES.includes(e.target.value as ZoomMode) ? e.target.value : parseZoomValue(`${e.target.value}%`);
          if (parsed) controllerFor(docId)?.setZoom(parsed);
        }}
      >
        {ZOOM_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {t(`pdf.zoom.${mode}`)}
          </option>
        ))}
        {presets.map((p) => (
          <option key={p} value={String(p)}>
            {t('pdf.zoom.percent', { value: p })}
          </option>
        ))}
      </select>
    </span>
  );
}

function NumberChooser({ docId, labelKey, values, apply, unitKey }: { docId: string | null; labelKey: string; values: number[]; apply: (v: number) => void; unitKey: string }) {
  const { t } = useTranslation();
  const ready = usePdfDoc(docId, (s) => s.status === 'ready');
  const id = useId();
  const [value, setValue] = useState('');
  return (
    <span className="vpdf-rc">
      <label className="vpdf-rc__label" htmlFor={id}>
        {t(labelKey)}
      </label>
      <select
        id={id}
        data-rb-item=""
        className="vpdf-rc__select vpdf-rc__select--narrow"
        disabled={!ready}
        value={value}
        onClick={focusSelf}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          setValue(e.target.value);
          const n = Number(e.target.value);
          if (n > 0) apply(n);
        }}
      >
        <option value="" disabled>
          …
        </option>
        {values.map((v) => (
          <option key={v} value={String(v)}>
            {t(unitKey, { value: v })}
          </option>
        ))}
      </select>
    </span>
  );
}

export function TextSizeChooser({ docId }: { docId: string | null }) {
  return <NumberChooser docId={docId} labelKey="pdf.ribbon.textSize" unitKey="pdf.units.pt" values={TEXT_SIZES} apply={(v) => controllerFor(docId)?.setFreeTextSize(v)} />;
}

export function ThicknessChooser({ docId }: { docId: string | null }) {
  return <NumberChooser docId={docId} labelKey="pdf.ribbon.thickness" unitKey="pdf.units.px" values={THICKNESSES} apply={(v) => controllerFor(docId)?.setThickness(v)} />;
}
