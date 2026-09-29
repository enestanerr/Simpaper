/** Locale-aware formatting for the shell (dates, sizes). */

export function localeOf(lang: string): string {
  return lang === 'tr' ? 'tr-TR' : 'en-US';
}

export function formatDateTime(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(localeOf(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function formatBytes(bytes: number, lang: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: u === 0 ? 0 : 1 }).format(v)} ${units[u]}`;
}
