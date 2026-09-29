/** Window chrome colours for the current theme (see WINDOW_CHROME in src/shared/api/app.ts). */
import { WINDOW_CHROME } from '@shared/api/app';

export interface ChromeColors {
  background: string;
  overlay: { color: string; symbolColor: string; height: number };
}

export function chromeColors(dark: boolean): ChromeColors {
  const c = dark ? WINDOW_CHROME.dark : WINDOW_CHROME.light;
  return { background: c.background, overlay: { color: c.titleBar, symbolColor: c.symbol, height: WINDOW_CHROME.titleBarHeight } };
}
