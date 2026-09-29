/** Small building blocks for module status bars. */
import type { ReactNode } from 'react';

export function StatusText({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="vr-status__item" title={title}>
      {children}
    </span>
  );
}

export function StatusButton({ children, label, onClick, disabled }: { children: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="vr-status__item vr-status__button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function formatNumber(n: number, lang: string): string {
  return new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-US').format(n);
}
