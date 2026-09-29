/** Small pure helpers of the PDF module: colours and error keys. */
import { PDF_ERROR_KEY_PATTERN } from '@shared/api/pdf';

/** 0xRRGGBB → `#rrggbb` (the ribbon colour control uses numbers, pdf.js uses hex strings). */
export function colorNumberToHex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function hexToColorNumber(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m?.[1] ? Number.parseInt(m[1], 16) : null;
}

const SHARED_KEY = /\berrors\.[A-Za-z]+(?:\.[A-Za-z]+)*/;

/**
 * Extracts the i18n key from an IPC rejection. Electron wraps the handler's message
 * ("Error invoking remote method 'pdf:pages': IpcRequestError: pdf.errors.encrypted").
 */
export function errorKeyOf(err: unknown): string | null {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return PDF_ERROR_KEY_PATTERN.exec(message)?.[0] ?? SHARED_KEY.exec(message)?.[0] ?? null;
}

/** The user closed a dialog; nothing to report. */
export function isCancellation(err: unknown): boolean {
  const key = errorKeyOf(err);
  return key === 'pdf.errors.cancelled' || key === 'errors.open.cancelled';
}
