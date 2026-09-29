/**
 * Placeholder for the native LibreOffice view. Keeps the native window glued to this element:
 * rect → view:setBounds (ResizeObserver, window resize/scroll, DPR changes; rAF-throttled and
 * de-duplicated), visibility → view:setVisible, click → view:focus. While the view is frozen for
 * an HTML popup, the snapshot image is shown in its place.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CssRect } from '@shared/api/engine';
import { hasBridge, invoke } from '../../services/ipc';
import { focusView } from '../../services/engine';
import { registerSurface, useFrozenSnapshot } from '../../state/viewStore';

export interface DocumentSurfaceProps {
  docId: string;
  /** Whether the native view should be shown (active tab, no backstage, document ready). */
  visible: boolean;
  label: string;
}

export function sameRect(a: CssRect | null, b: CssRect): boolean {
  if (!a) return false;
  const eq = (x: number, y: number) => Math.abs(x - y) < 0.5;
  return eq(a.x, b.x) && eq(a.y, b.y) && eq(a.width, b.width) && eq(a.height, b.height);
}

export function DocumentSurface({ docId, visible, label }: DocumentSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastRect = useRef<CssRect | null>(null);
  const lastVisible = useRef<boolean | null>(null);
  const { frozen, snapshot } = useFrozenSnapshot(docId);

  useLayoutEffect(() => {
    const el = ref.current;
    return el ? registerSurface(docId, el) : undefined;
  }, [docId]);

  // Bounds tracking while visible.
  useEffect(() => {
    const el = ref.current;
    if (!el || !visible || !hasBridge()) return;
    let frame = 0;
    const send = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const rect: CssRect = { x: r.left, y: r.top, width: r.width, height: r.height };
      if (sameRect(lastRect.current, rect)) return;
      lastRect.current = rect;
      invoke('view:setBounds', { docId, rect }).catch(() => {
        lastRect.current = null;
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(send);
    };
    lastRect.current = null;
    schedule();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    ro?.observe(el);
    ro?.observe(document.body);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    let mq: MediaQueryList | null = null;
    const onDpr = () => {
      mq?.removeEventListener('change', onDpr);
      mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', onDpr);
      lastRect.current = null;
      schedule();
    };
    if (typeof matchMedia === 'function') {
      mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', onDpr);
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      mq?.removeEventListener('change', onDpr);
    };
  }, [docId, visible]);

  // Show/hide the native window with the tab.
  useEffect(() => {
    if (!hasBridge() || lastVisible.current === visible) return;
    lastVisible.current = visible;
    invoke('view:setVisible', { docId, visible }).catch(() => {
      lastVisible.current = null;
    });
  }, [docId, visible]);

  return (
    <div
      ref={ref}
      className="vr-surface"
      role="region"
      aria-label={label}
      data-frozen={frozen || undefined}
      onPointerDown={() => void focusView(docId)}
    >
      {frozen && snapshot && <img className="vr-surface__snapshot" src={snapshot} alt="" draggable={false} />}
    </div>
  );
}
