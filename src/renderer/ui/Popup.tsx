/**
 * Anchored popup rendered in a portal. While open it holds the airspace overlay if it overlaps the
 * native document view, closes on outside press / Esc / window blur / resize, and restores focus.
 * A press inside a popup opened from within this one (a menu of a split button in a collapsed ribbon
 * group) is not an outside press, although every popup is a sibling in document.body.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { acquireOverlay, overlayPending, whenOverlayReady } from '../services/overlay';

export type PopupCloseReason = 'escape' | 'outside' | 'blur' | 'select' | 'tab';

export interface PopupProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: (reason: PopupCloseReason) => void;
  children: ReactNode;
  /** `below` (default): under the anchor, flipping up if needed; `right`: submenu style; `above`. */
  placement?: 'below' | 'right' | 'above';
  className?: string;
  /** Focus the first focusable element when opening (default true). */
  autoFocus?: boolean;
  /** Return focus to the anchor when closing via keyboard (default true). */
  restoreFocus?: boolean;
  /** Minimum width = anchor width. */
  matchAnchorWidth?: boolean;
  id?: string;
  role?: string;
  ariaLabel?: string;
}

const MARGIN = 4;

export function computePopupPosition(
  anchor: { left: number; top: number; right: number; bottom: number; width: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: 'below' | 'right' | 'above',
): { left: number; top: number } {
  let left: number;
  let top: number;
  if (placement === 'right') {
    left = anchor.right + 2;
    top = anchor.top - 4;
    if (left + size.width > viewport.width - MARGIN) left = anchor.left - size.width - 2;
  } else {
    left = anchor.left;
    const below = anchor.bottom + 2;
    const above = anchor.top - size.height - 2;
    const fitsBelow = below + size.height <= viewport.height - MARGIN;
    top = placement === 'above' ? (above >= MARGIN ? above : below) : fitsBelow || above < MARGIN ? below : above;
  }
  left = Math.max(MARGIN, Math.min(left, viewport.width - size.width - MARGIN));
  top = Math.max(MARGIN, Math.min(top, viewport.height - size.height - MARGIN));
  return { left, top };
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"]), [role^="menuitem"], [role="option"]';

/** Open popup element → its anchor: nested popups are found through their anchor chain. */
const popupAnchors = new WeakMap<HTMLElement, HTMLElement | null>();

/**
 * Whether `target` is inside the popup `el`, its anchor, or a popup whose anchor chain leads there (a
 * nested popup is portaled to document.body, so it is not a DOM descendant of the popup it belongs to).
 */
export function isInsidePopup(target: EventTarget | null, el: HTMLElement | null, anchor: HTMLElement | null): boolean {
  let node: Element | null = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const seen = new Set<Element>();
  while (node && !seen.has(node)) {
    seen.add(node);
    if (el?.contains(node) || anchor?.contains(node)) return true;
    const popup = node.closest<HTMLElement>('.vr-popup');
    if (!popup || popup === el) return false;
    node = popupAnchors.get(popup) ?? null;
  }
  return false;
}

export function Popup({
  anchor,
  open,
  onClose,
  children,
  placement = 'below',
  className,
  autoFocus = true,
  restoreFocus = true,
  matchAnchorWidth,
  id,
  role,
  ariaLabel,
}: PopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden', left: 0, top: 0 });
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // Position after layout, then hold the airspace overlay for exactly this rect. When the popup overlaps the
  // native document view, the view is frozen first: until the freeze-frame is in place the popup is laid out
  // (and focusable) but transparent, so it never shows half hidden behind the document window.
  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const el = ref.current;
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const pos = computePopupPosition(a, size, { width: window.innerWidth, height: window.innerHeight }, placement);
    const shown: CSSProperties = { left: pos.left, top: pos.top, minWidth: matchAnchorWidth ? a.width : undefined, visibility: 'visible' };
    const release = acquireOverlay({ left: pos.left, top: pos.top, right: pos.left + size.width, bottom: pos.top + size.height });
    if (!overlayPending()) {
      setStyle(shown);
      return release;
    }
    setStyle({ ...shown, opacity: 0, pointerEvents: 'none' });
    let alive = true;
    void whenOverlayReady().then(() => {
      if (alive) setStyle(shown);
    });
    return () => {
      alive = false;
      release();
    };
  }, [open, anchor, placement, matchAnchorWidth]);

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (el) popupAnchors.set(el, anchor);
    if (autoFocus && el) {
      const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? el).focus({ preventScroll: true });
    }
    const onPointerDown = (e: PointerEvent) => {
      if (isInsidePopup(e.target, el, anchor)) return;
      onCloseRef.current('outside');
    };
    const onBlur = () => onCloseRef.current('blur');
    const onResize = () => onCloseRef.current('blur');
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onResize);
    return () => {
      if (el) popupAnchors.delete(el);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      if (restoreFocus && anchor && el?.contains(document.activeElement)) anchor.focus({ preventScroll: true });
    };
  }, [open, anchor, autoFocus, restoreFocus]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      id={id}
      role={role}
      aria-label={ariaLabel}
      className={`vr-popup${className ? ` ${className}` : ''}`}
      style={style}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          e.preventDefault();
          onCloseRef.current('escape');
        } else if (e.key === 'Tab' && role === 'menu') {
          onCloseRef.current('tab');
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
