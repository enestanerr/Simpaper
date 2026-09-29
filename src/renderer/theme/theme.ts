/** Applies the theme preference (light/dark/system) and the brand colours to <html>. */
import { WINDOW_CHROME, type ThemePreference } from '@shared/api/app';
import { BRAND } from '@shared/brand';

export type ResolvedTheme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
}

/**
 * Brand colours come from src/shared/brand.ts and the title bar colours from WINDOW_CHROME (the main
 * process paints the Windows caption buttons with the same values), so the CSS never drifts.
 */
export function applyBrandColors(root: HTMLElement = document.documentElement): void {
  const c = BRAND.colors;
  root.style.setProperty('--c-ink', c.ink);
  root.style.setProperty('--c-gold', c.gold);
  root.style.setProperty('--c-writer', c.writer);
  root.style.setProperty('--c-calc', c.calc);
  root.style.setProperty('--c-impress', c.impress);
  root.style.setProperty('--c-pdf', c.pdf);
  root.style.setProperty('--titlebar-h', `${WINDOW_CHROME.titleBarHeight}px`);
  root.style.setProperty('--chrome-bg-light', WINDOW_CHROME.light.titleBar);
  root.style.setProperty('--chrome-fg-light', WINDOW_CHROME.light.symbol);
  root.style.setProperty('--chrome-bg-dark', WINDOW_CHROME.dark.titleBar);
  root.style.setProperty('--chrome-fg-dark', WINDOW_CHROME.dark.symbol);
}

export function applyTheme(preference: ThemePreference, root: HTMLElement = document.documentElement): ResolvedTheme {
  const theme = resolveTheme(preference, systemPrefersDark());
  root.dataset['theme'] = theme;
  return theme;
}

/**
 * Keeps <html data-theme> in sync with the preference and, for `system`, with the OS setting.
 * Returns an unsubscribe function.
 */
export function watchSystemTheme(getPreference: () => ThemePreference): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia(DARK_QUERY);
  const onChange = () => {
    if (getPreference() === 'system') applyTheme('system');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
