/**
 * Printing of PDF pages rendered by the renderer (pdf.js). The pages are written to a private temp folder,
 * loaded into a hidden, script-less BrowserWindow and handed to `webContents.print`, so the only UI the user
 * sees is the system print dialog. The folder is deleted afterwards (rendered pages are document content).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { PdfPrintPage } from '@shared/api/pdf';
import type { Logger } from '../log';
import { PdfServiceError } from './errors';
import { detectImageMime } from './content';

export interface PrintImage {
  file: string;
  widthPt: number;
  heightPt: number;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * HTML with one page box per image. The first page's size becomes the default paper orientation/size
 * (as pdf.js' print service does); every image is scaled to fit its page box.
 */
export function buildPrintHtml(images: PrintImage[], title: string): string {
  const first = images[0];
  const pageSize = first ? `${first.widthPt.toFixed(2)}pt ${first.heightPt.toFixed(2)}pt` : 'auto';
  const pages = images
    .map((img, i) => `<div class="page"><img src="${escapeHtml(img.file)}" alt="${i + 1}"></div>`)
    .join('\n');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title>
<style>
@page { size: ${pageSize}; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.page { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style>
</head>
<body>
${pages}
</body>
</html>
`;
}

export function validatePrintPages(pages: PdfPrintPage[] | undefined): PdfPrintPage[] {
  if (!Array.isArray(pages) || pages.length === 0) throw new PdfServiceError('pdf.errors.printNothing');
  for (const page of pages) {
    const data = page.data instanceof Uint8Array ? page.data : undefined;
    if (!data || detectImageMime(data) !== page.mime) throw new PdfServiceError('pdf.errors.printFailed', 'invalid page image');
    if (!(page.widthPt > 0 && page.heightPt > 0)) throw new PdfServiceError('pdf.errors.printFailed', 'invalid page size');
  }
  return pages;
}

/** Shows the system print dialog for the rendered pages. Must only run inside Electron's main process. */
export async function printRenderedPages(pages: PdfPrintPage[], title: string, parent: BrowserWindow | null, log: Logger): Promise<void> {
  const valid = validatePrintPages(pages);
  const { BrowserWindow: Window } = await import('electron');
  const dir = await mkdtemp(join(tmpdir(), 'varak-print-'));
  let win: BrowserWindow | null = null;
  try {
    const images: PrintImage[] = [];
    for (let i = 0; i < valid.length; i++) {
      const page = valid[i]!;
      const file = `page-${String(i + 1).padStart(4, '0')}.${page.mime === 'image/png' ? 'png' : 'jpg'}`;
      await writeFile(join(dir, file), page.data);
      images.push({ file, widthPt: page.widthPt, heightPt: page.heightPt });
    }
    const htmlPath = join(dir, 'print.html');
    await writeFile(htmlPath, buildPrintHtml(images, title), 'utf8');
    win = new Window({
      show: false,
      ...(parent && !parent.isDestroyed() ? { parent } : {}),
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        spellcheck: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    await win.loadFile(htmlPath);
    const printWin = win;
    await new Promise<void>((resolve, reject) => {
      printWin.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
        if (success || /cancel/i.test(failureReason)) resolve();
        else reject(new PdfServiceError('pdf.errors.printFailed', failureReason));
      });
    });
    log.info('print job handed to the system', { pages: valid.length });
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
