/** Office-style ScreenTips: title, shortcut and description, shown after a hover delay below the ribbon. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { acquireOverlay, overlayPending, whenOverlayReady } from '../services/overlay';

export interface ScreenTipContent {
  title: string;
  description?: string;
  shortcut?: string;
}

const SHOW_DELAY_MS = 600;
const WARM_WINDOW_MS = 700;
let lastHiddenAt = 0;
let anyVisible = false;

interface TipState {
  anchor: HTMLElement;
}

export function useScreenTip(content: ScreenTipContent | null) {
  const [state, setState] = useState<TipState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = useRef(false);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (visible.current) {
      visible.current = false;
      lastHiddenAt = Date.now();
      anyVisible = false;
    }
    setState(null);
  }, []);

  useEffect(() => hide, [hide]);

  const onPointerEnter = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!content || e.pointerType === 'touch') return;
      const anchor = e.currentTarget;
      const warm = anyVisible || Date.now() - lastHiddenAt < WARM_WINDOW_MS;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(
        () => {
          visible.current = true;
          anyVisible = true;
          setState({ anchor });
        },
        warm ? 40 : SHOW_DELAY_MS,
      );
    },
    [content],
  );

  const element = state && content ? <ScreenTipView anchor={state.anchor} content={content} /> : null;
  return {
    props: { onPointerEnter, onPointerLeave: hide, onPointerDown: hide, onKeyDown: hide },
    element,
    hide,
  };
}

function ScreenTipView({ anchor, content }: { anchor: HTMLElement; content: ScreenTipContent }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [revealed, setRevealed] = useState(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const ribbon = anchor.closest('.rb-ribbon')?.getBoundingClientRect();
    const top = Math.max(a.bottom, ribbon ? ribbon.bottom : 0) + 6;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = Math.max(4, Math.min(a.left, window.innerWidth - width - 4));
    const clampedTop = top + height > window.innerHeight - 4 ? Math.max(4, a.top - height - 6) : top;
    setPos({ left, top: clampedTop });
    const release = acquireOverlay({ left, top: clampedTop, right: left + width, bottom: clampedTop + height });
    if (!overlayPending()) return release;
    // Below the ribbon a tip covers the document area: show it once the view is frozen (see Popup).
    setRevealed(false);
    let alive = true;
    void whenOverlayReady().then(() => {
      if (alive) setRevealed(true);
    });
    return () => {
      alive = false;
      release();
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      className="vr-screentip"
      aria-hidden="true"
      style={pos && revealed ? { left: pos.left, top: pos.top } : { left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: 'hidden' }}
    >
      <div className="vr-screentip__title">
        <span>{content.title}</span>
        {content.shortcut && <span className="vr-screentip__shortcut">({content.shortcut})</span>}
      </div>
      {content.description && <div className="vr-screentip__desc">{content.description}</div>}
    </div>,
    document.body,
  );
}
