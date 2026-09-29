/** Modal dialog with focus trap, Esc handling and airspace overlay (the scrim covers the document area). */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { holdKeyboard } from '../services/keyboardFocus';
import { acquireOverlay, overlayPending, whenOverlayReady } from '../services/overlay';

export interface DialogProps {
  title: string;
  onCancel: () => void;
  children: ReactNode;
  footer?: ReactNode;
  role?: 'dialog' | 'alertdialog';
  size?: 'small' | 'medium' | 'large';
  /** Element to focus first (CSS selector inside the dialog); defaults to [data-autofocus] or the first control. */
  initialFocus?: string;
  icon?: ReactNode;
}

const TABBABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, onCancel, children, footer, role = 'dialog', size = 'medium', initialFocus, icon }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef(onCancel);
  useLayoutEffect(() => {
    cancelRef.current = onCancel;
  });

  // The scrim covers the document area: freeze the native view, and paint the dialog box once the
  // freeze-frame is in place (see Popup). The hold is persistent: a window blur or a LibreOffice dialog
  // must not uncover the document while this dialog is open.
  const [revealed, setRevealed] = useState(true);
  useLayoutEffect(() => {
    const release = acquireOverlay(null, { persistent: true });
    if (!overlayPending()) return release;
    setRevealed(false);
    let alive = true;
    void whenOverlayReady().then(() => {
      if (alive) setRevealed(true);
    });
    return () => {
      alive = false;
      release();
    };
  }, []);

  // Enter/Esc and the fields must reach the dialog, not LibreOffice's window (see services/keyboardFocus).
  useEffect(() => holdKeyboard(), []);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const target =
      (initialFocus ? el?.querySelector<HTMLElement>(initialFocus) : null) ??
      el?.querySelector<HTMLElement>('[data-autofocus]') ??
      el?.querySelector<HTMLElement>(TABBABLE);
    (target ?? el)?.focus({ preventScroll: true });
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
    };
  }, [initialFocus]);

  return createPortal(
    <div className="vr-dialog-scrim">
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={`vr-dialog vr-dialog--${size}`}
        style={revealed ? undefined : { opacity: 0 }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancelRef.current();
            return;
          }
          if (e.key !== 'Tab') return;
          const items = [...(ref.current?.querySelectorAll<HTMLElement>(TABBABLE) ?? [])];
          if (items.length === 0) return;
          const first = items[0]!;
          const last = items[items.length - 1]!;
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="vr-dialog__header">
          {icon && <span className="vr-dialog__icon" aria-hidden="true">{icon}</span>}
          <h2 id={titleId} className="vr-dialog__title">
            {title}
          </h2>
        </div>
        <div id={bodyId} className="vr-dialog__body">
          {children}
        </div>
        {footer && <div className="vr-dialog__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
