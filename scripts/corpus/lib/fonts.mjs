/**
 * Locates a Unicode TrueType font with Turkish glyphs for the generated PDFs (the PDF standard-14 fonts
 * are WinAnsi-encoded and cannot represent ğ, ş, ı, İ). Preference: the fonts bundled with the engine
 * (DejaVu Sans, Noto Sans; admin images keep them in `Fonts/`, prepared images in `share/fonts/truetype/`),
 * then common system fonts. Generated files are not committed, so system fonts are acceptable fallbacks.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const NAMES = {
  regular: ['DejaVuSans.ttf', 'NotoSans-Regular.ttf', 'LiberationSans-Regular.ttf'],
  bold: ['DejaVuSans-Bold.ttf', 'NotoSans-Bold.ttf', 'LiberationSans-Bold.ttf'],
};
const SYSTEM = {
  regular: ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
  bold: ['C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
};

/**
 * @param {{ repoRoot: string, programDir?: string | null, weight?: 'regular' | 'bold' }} opts
 * @returns {string | null}
 */
export function findUnicodeFont({ repoRoot, programDir, weight = 'regular' }) {
  const roots = [];
  if (programDir) roots.push(join(programDir, '..'));
  if (process.env.SIMPAPER_ENGINE_DIR) roots.push(process.env.SIMPAPER_ENGINE_DIR, join(process.env.SIMPAPER_ENGINE_DIR, '..'));
  roots.push(join(repoRoot, 'vendor', 'libreoffice'));
  const dirs = roots.flatMap((r) => [join(r, 'share', 'fonts', 'truetype'), join(r, 'Fonts')]);
  for (const name of NAMES[weight]) for (const dir of dirs) if (existsSync(join(dir, name))) return join(dir, name);
  for (const path of SYSTEM[weight]) if (existsSync(path)) return path;
  return null;
}
