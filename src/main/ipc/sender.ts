/**
 * IPC sender validation: requests are only served for the main frame of our own window showing our
 * own page (the dev server URL in development, the bundled index.html otherwise).
 */
import { fileURLToPath } from 'node:url';

export interface SenderFrameLike {
  url: string;
  processId: number;
  routingId: number;
}

export interface IpcEventLike {
  sender: { id: number };
  senderFrame: SenderFrameLike | null;
}

export interface TrustedWindowLike {
  isDestroyed(): boolean;
  webContents: { id: number; mainFrame: SenderFrameLike };
}

/** True when `url` is the app page: same origin for http(s) dev servers, same file for file: URLs. */
export function isAppUrl(url: string, appUrl: string): boolean {
  let actual: URL;
  let expected: URL;
  try {
    actual = new URL(url);
    expected = new URL(appUrl);
  } catch {
    return false;
  }
  if (actual.protocol !== expected.protocol) return false;
  if (expected.protocol === 'file:') {
    try {
      const a = fileURLToPath(actual);
      const e = fileURLToPath(expected);
      return process.platform === 'win32' ? a.toLowerCase() === e.toLowerCase() : a === e;
    } catch {
      return false;
    }
  }
  if (expected.protocol === 'http:' || expected.protocol === 'https:') return actual.origin === expected.origin;
  return false;
}

export function createSenderValidator(getWindow: () => TrustedWindowLike | null, appUrl: () => string | null): (event: IpcEventLike) => boolean {
  return (event) => {
    const win = getWindow();
    const url = appUrl();
    if (!win || win.isDestroyed() || !url) return false;
    if (event.sender.id !== win.webContents.id) return false;
    const frame = event.senderFrame;
    const main = win.webContents.mainFrame;
    if (!frame || frame.processId !== main.processId || frame.routingId !== main.routingId) return false;
    return isAppUrl(frame.url, url);
  };
}
