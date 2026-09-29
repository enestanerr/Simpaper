/** Folders of the engine installation the main process uses besides the engine layer itself. */
import { resolve } from 'node:path';

export interface EngineFontFolders {
  /** Fonts LibreOffice registers privately at start-up (used by the compatibility font check). */
  engine: string[];
  /** Candidate font files for the PDF module's text insertion (any Unicode TrueType/OpenType font). */
  pdf: string[];
}

/**
 * Font folders of the engine, from its `program` directory: `share/fonts/truetype` (packaged engine and
 * installed LibreOffice versions) and, for the PDF module only, the admin image's `Fonts` folder (development
 * image `vendor/libreoffice/Fonts`: files meant for the system font folder, which the engine itself does not
 * load, but which are valid Unicode fonts: DejaVu, Liberation, Noto …).
 */
export function engineFontFolders(programDir: string): EngineFontFolders {
  const engine = [resolve(programDir, '..', 'share', 'fonts', 'truetype')];
  return { engine, pdf: [...engine, resolve(programDir, '..', 'Fonts')] };
}
