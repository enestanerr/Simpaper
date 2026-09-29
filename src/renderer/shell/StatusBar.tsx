/** Status bar frame: module content on the left, view buttons and the zoom slider on the right. */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconLoader2, IconMinus, IconPlus } from '@tabler/icons-react';
import type { DocumentDescriptor } from '@shared/api/documents';
import type { ModuleDefinition, StatusViewButton, ZoomState } from '../modules/types';
import { runRibbonAction, useControlRuntime } from '../ribbon/runtime';
import { sliderToZoom, zoomToSlider } from '../services/zoom';
import { useApp } from '../state/appStore';

export function StatusBar({ doc, module }: { doc: DocumentDescriptor; module: ModuleDefinition }) {
  const { t } = useTranslation();
  const busy = useApp((s) => s.busy[doc.docId]);
  const Module = module.StatusBar;
  return (
    <div className="vr-status" role="group" aria-label={t('shell.status.label')}>
      <div className="vr-status__left">
        {Module && <Module doc={doc} />}
        {busy?.busy && busy.reason !== 'dialog' && (
          <span className="vr-status__item" role="status">
            <IconLoader2 className="vr-spin" size={14} stroke={2} aria-hidden="true" />
            {t(`shell.status.busy_${busy.reason ?? 'loading'}`)}
          </span>
        )}
        {doc.readOnly && <span className="vr-status__item vr-status__badge">{t('shell.title.readOnly')}</span>}
      </div>
      <div className="vr-status__right">
        {module.statusViews && module.statusViews.length > 0 && (
          <div className="vr-status__views" role="group" aria-label={t('shell.status.views')}>
            {module.statusViews.map((v) => (
              <ViewButton key={v.id} view={v} />
            ))}
          </div>
        )}
        {module.useZoom && <ZoomArea key={module.kind} doc={doc} useZoom={module.useZoom} />}
      </div>
    </div>
  );
}

function ViewButton({ view }: { view: StatusViewButton }) {
  const { t } = useTranslation();
  const rt = useControlRuntime(view.action, view.state);
  const label = t(view.labelKey);
  const Icon = view.icon;
  const isToggle = view.state !== undefined;
  return (
    <button
      type="button"
      className={`vr-status__view${isToggle && rt.pressed ? ' vr-status__view--on' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={isToggle ? rt.pressed : undefined}
      aria-disabled={!rt.enabled || undefined}
      onClick={() => {
        if (!rt.enabled || (isToggle && rt.pressed)) return;
        runRibbonAction(view.action);
      }}
    >
      <Icon size={15} stroke={1.75} aria-hidden="true" />
    </button>
  );
}

const SLIDER_THROTTLE_MS = 120;

function ZoomArea({ doc, useZoom }: { doc: DocumentDescriptor; useZoom: (doc: DocumentDescriptor) => ZoomState }) {
  const { t } = useTranslation();
  const zoom = useZoom(doc);
  const [drag, setDrag] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = drag ?? zoom.value;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const flush = () => {
    timer.current = null;
    if (pending.current !== null) zoom.set(pending.current);
    pending.current = null;
  };

  const onSlide = (position: number) => {
    const value = sliderToZoom(position);
    setDrag(value);
    pending.current = value;
    if (!timer.current) timer.current = setTimeout(flush, SLIDER_THROTTLE_MS);
  };

  const disabled = doc.state !== 'ready';
  return (
    <div className="vr-zoom" role="group" aria-label={t('shell.status.zoom')}>
      <button type="button" className="vr-zoom__btn" aria-label={t('shell.status.zoomOut')} title={t('shell.status.zoomOut')} disabled={disabled} onClick={() => zoom.step(-1)}>
        <IconMinus size={12} stroke={2} aria-hidden="true" />
      </button>
      <input
        type="range"
        className="vr-zoom__slider"
        min={0}
        max={1000}
        step={1}
        disabled={disabled || zoom.value === null}
        value={zoomToSlider(shown ?? 100)}
        aria-label={t('shell.status.zoom')}
        aria-valuetext={shown !== null ? `${shown}%` : undefined}
        onChange={(e) => onSlide(Number(e.target.value))}
        onPointerUp={() => {
          if (timer.current) clearTimeout(timer.current);
          flush();
          setDrag(null);
        }}
        onKeyUp={() => {
          if (timer.current) clearTimeout(timer.current);
          flush();
          setDrag(null);
        }}
      />
      <button type="button" className="vr-zoom__btn" aria-label={t('shell.status.zoomIn')} title={t('shell.status.zoomIn')} disabled={disabled} onClick={() => zoom.step(1)}>
        <IconPlus size={12} stroke={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="vr-zoom__value"
        title={t('shell.status.zoomDialog')}
        aria-label={t('shell.status.zoomDialogLabel', { value: shown ?? '—' })}
        disabled={disabled || !zoom.openDialog}
        onClick={() => zoom.openDialog?.()}
      >
        {shown !== null ? `${shown}%` : '—'}
      </button>
    </div>
  );
}
