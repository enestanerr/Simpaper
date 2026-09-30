/**
 * File-type icons that Windows shows for documents registered to Simpaper (build/installer.nsh): document,
 * spreadsheet, presentation and PDF. Original artwork (MPL-2.0), derived from resources/brand: a white sheet with
 * the brand's leaf corners (large radius top right and bottom left, as in logo.svg), a neutral outline, the logo's
 * offset edge in the type colour, and the glyph of the matching module icon in that colour. No folded corner and no
 * letters, so the icons are not mistaken for Microsoft Office's or LibreOffice's.
 *
 * Small sizes are drawn on their own pixel grids (viewBox = size, integer coordinates, 1 px outline) so Explorer's
 * 16/20/24/32/40/48 px icons stay crisp; 64 and 96 px are exact 2x renders of the 32 and 48 grids, 128 px is half of
 * the 256 master. scripts/brand/generate-icons.mjs renders them into resources/fileicons/<type>.ico.
 */

/** Type colours: the module colours of src/shared/brand.ts. */
export const FILE_TYPES = {
  document: { color: '#3B5BDB', title: 'Document', module: 'writer' },
  spreadsheet: { color: '#12876F', title: 'Spreadsheet', module: 'calc' },
  presentation: { color: '#D5582A', title: 'Presentation', module: 'impress' },
  pdf: { color: '#C0303F', title: 'PDF', module: 'pdf' },
};
/** Sheet outline: about 3.1:1 against white and 5.7:1 against Explorer's dark background. */
const OUTLINE = '#8C93A8';
const WHITE = '#FFFFFF';

/** Sheet per design grid: [x0, y0, x1, y1, R (top right, bottom left), r (other corners), outline, edge dx, edge dy]. */
const GRID = {
  16: [2, 1, 14, 15, 4, 1, 1, 1, 1],
  20: [3, 1, 17, 19, 5, 1, 1, 1, 1],
  24: [3, 1, 20, 22, 6, 1.5, 1, 1, 1],
  32: [4, 1, 27, 30, 8, 2, 1, 2, 1],
  40: [5, 1, 34, 38, 10, 2, 1, 2, 1],
  48: [6, 2, 40, 45, 12, 3, 1, 2, 1],
  256: [32, 8, 208, 240, 64, 14, 6, 10, 6],
};
/** ICO entry size -> design grid it is rendered from. */
export const FILE_ICON_SOURCE = { 16: 16, 20: 20, 24: 24, 32: 32, 40: 40, 48: 48, 64: 32, 96: 48, 128: 256, 256: 256 };
export const FILE_ICON_SIZES = Object.keys(FILE_ICON_SOURCE).map(Number);

const f3 = (n) => +n.toFixed(3);
function sheetPath(x0, y0, x1, y1, R, r) {
  return (
    `M${f3(x0 + r)} ${f3(y0)}H${f3(x1 - R)}A${f3(R)} ${f3(R)} 0 0 1 ${f3(x1)} ${f3(y0 + R)}V${f3(y1 - r)}` +
    (r > 0 ? `A${f3(r)} ${f3(r)} 0 0 1 ${f3(x1 - r)} ${f3(y1)}` : '') +
    `H${f3(x0 + R)}A${f3(R)} ${f3(R)} 0 0 1 ${f3(x0)} ${f3(y1 - R)}V${f3(y0 + r)}` +
    (r > 0 ? `A${f3(r)} ${f3(r)} 0 0 1 ${f3(x0 + r)} ${f3(y0)}` : '') +
    'Z'
  );
}
const rect = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
/** Pixel runs [y, xFrom, xTo] (inclusive) as one path. */
const runs = (list, fill) => `<path fill="${fill}" d="${list.map(([y, a, b]) => `M${a} ${y}h${b - a + 1}v1h-${b - a + 1}z`).join('')}"/>`;
const cells = (xs, ys, size, fill) => xs.flatMap((x) => ys.map((y) => rect(x, y, size, size, fill))).join('');
/** The module glyphs of resources/brand (512 box, centred on x = 244) placed on the 256 sheet. */
const fromModule = (cx, cy, s, body) => `<g transform="translate(120 126) scale(${s}) translate(${-cx} ${-cy})">${body}</g>`;

const GLYPH = {
  document: {
    16: (c) => runs([[5, 4, 11], [7, 4, 11], [9, 4, 11], [11, 4, 8]], c),
    20: (c) => runs([[6, 5, 13], [8, 5, 13], [10, 5, 13], [12, 5, 13], [14, 5, 10]], c),
    24: (c) => rect(6, 7, 11, 2, c) + rect(6, 11, 11, 2, c) + rect(6, 15, 7, 2, c),
    32: (c) => rect(8, 9, 15, 2, c) + rect(8, 13, 15, 2, c) + rect(8, 17, 15, 2, c) + rect(8, 21, 10, 2, c),
    40: (c) => rect(10, 11, 19, 2, c) + rect(10, 16, 19, 2, c) + rect(10, 21, 19, 2, c) + rect(10, 26, 12, 2, c),
    48: (c) => rect(12, 14, 22, 3, c) + rect(12, 20, 22, 3, c) + rect(12, 26, 22, 3, c) + rect(12, 32, 14, 3, c),
    256: (c) => fromModule(244, 251, 0.62, `<path fill="none" stroke="${c}" stroke-width="26" stroke-linecap="round" d="M156 176H332M156 226H332M156 276H332M156 326H268"/>`),
  },
  spreadsheet: {
    16: (c) => cells([4, 7, 10], [5, 8, 11], 2, c),
    20: (c) => cells([5, 8, 11], [6, 9, 12], 2, c),
    24: (c) => cells([6, 10, 14], [7, 11, 15], 3, c),
    32: (c) => cells([8, 13, 18], [9, 14, 19], 4, c),
    40: (c) => cells([11, 17, 23], [11, 17, 23], 5, c),
    48: (c) => cells([12, 19, 26], [14, 21, 28], 6, c),
    256: (c) =>
      fromModule(
        244,
        250,
        0.62,
        `<rect x="150" y="160" width="188" height="180" rx="16" fill="none" stroke="${c}" stroke-width="22"/><path fill="none" stroke="${c}" stroke-width="18" d="M213 160V340M276 160V340M150 220H338M150 280H338"/>`,
      ),
  },
  presentation: {
    16: (c) => rect(4, 4, 8, 6, c) + rect(5, 7, 1, 2, WHITE) + rect(7, 6, 1, 3, WHITE) + rect(9, 5, 1, 4, WHITE) + rect(7, 10, 2, 2, c) + rect(5, 12, 6, 1, c),
    20: (c) => rect(5, 5, 10, 7, c) + rect(7, 9, 1, 2, WHITE) + rect(9, 7, 1, 4, WHITE) + rect(11, 8, 1, 3, WHITE) + rect(9, 12, 2, 2, c) + rect(7, 14, 6, 1, c),
    24: (c) => rect(6, 6, 12, 8, c) + rect(8, 10, 2, 3, WHITE) + rect(11, 8, 2, 5, WHITE) + rect(14, 11, 2, 2, WHITE) + rect(11, 14, 2, 2, c) + rect(8, 16, 8, 2, c),
    32: (c) => rect(8, 8, 16, 11, c) + rect(11, 13, 2, 4, WHITE) + rect(15, 10, 2, 7, WHITE) + rect(19, 12, 2, 5, WHITE) + rect(15, 19, 2, 3, c) + rect(11, 22, 10, 2, c),
    40: (c) => rect(10, 10, 20, 13, c) + rect(13, 17, 2, 4, WHITE) + rect(19, 13, 2, 8, WHITE) + rect(25, 15, 2, 6, WHITE) + rect(19, 23, 2, 4, c) + rect(14, 27, 12, 2, c),
    48: (c) => rect(12, 12, 24, 16, c) + rect(16, 20, 3, 5, WHITE) + rect(22, 16, 3, 9, WHITE) + rect(28, 18, 3, 7, WHITE) + rect(22, 28, 3, 5, c) + rect(16, 33, 15, 2, c),
    256: (c) =>
      fromModule(
        244,
        256,
        0.62,
        `<rect x="148" y="166" width="192" height="136" rx="14" fill="${c}"/><path fill="none" stroke="${c}" stroke-width="22" stroke-linecap="round" d="M244 304V346M204 346H284"/><path fill="${WHITE}" d="M182 246h26v34h-26zM231 212h26v68h-26zM280 230h26v50h-26z"/>`,
      ),
  },
  pdf: {
    // Fountain-pen nib pointing down (resources/brand/pdf.svg) with its slit and breather hole in white.
    16: (c) => runs([[3, 6, 8], [4, 5, 9], [5, 4, 10], [6, 4, 10], [7, 4, 10], [8, 5, 9], [9, 5, 9], [10, 6, 8], [11, 7, 7]], c) + rect(7, 6, 1, 4, WHITE),
    20: (c) =>
      runs([[4, 8, 12], [5, 7, 13], [6, 6, 14], [7, 6, 14], [8, 6, 14], [9, 6, 14], [10, 7, 13], [11, 7, 13], [12, 8, 12], [13, 9, 11], [14, 10, 10]], c) + rect(10, 8, 1, 5, WHITE),
    24: (c) =>
      runs([[5, 9, 13], [6, 8, 14], [7, 7, 15], [8, 6, 16], [9, 6, 16], [10, 6, 16], [11, 6, 16], [12, 7, 15], [13, 7, 15], [14, 8, 14], [15, 9, 13], [16, 10, 12], [17, 11, 11]], c) +
      runs([[9, 10, 12], [10, 10, 12]], WHITE) +
      rect(11, 11, 1, 5, WHITE),
    32: (c) => `<path fill="${c}" d="M13 6H19L24 14V15L16 25L8 15V14Z"/>` + rect(15, 15, 2, 8, WHITE) + `<circle cx="16" cy="14" r="2" fill="${WHITE}"/>`,
    40: (c) => `<path fill="${c}" d="M17 7H23L29 17V18L20 31L11 18V17Z"/>` + rect(19, 18, 2, 10, WHITE) + `<circle cx="20" cy="17" r="2.5" fill="${WHITE}"/>`,
    48: (c) => `<path fill="${c}" d="M20 9H28L35 20V22L24 37L13 22V20Z"/>` + rect(23, 22, 2, 12, WHITE) + `<circle cx="24" cy="21" r="3" fill="${WHITE}"/>`,
    256: (c) =>
      fromModule(
        244,
        262,
        0.7,
        `<path fill="${c}" d="M244 356L302 262C302 222 276 196 264 164H224C212 196 186 222 186 262Z"/><path fill="none" stroke="${WHITE}" stroke-width="10" stroke-linecap="round" d="M244 340V276"/><circle cx="244" cy="262" r="14" fill="${WHITE}"/>`,
      ),
  },
};

/** SVG of one file-type icon on one design grid (viewBox = grid; root width/height as renderSvg expects). */
export function fileIconSvg(type, grid) {
  const [x0, y0, x1, y1, R, r, w, dx, dy] = GRID[grid];
  const { color, title, module } = FILE_TYPES[type];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid} ${grid}" width="${grid}" height="${grid}" role="img" aria-labelledby="title">
  <title id="title">Simpaper ${title}</title>
  <!-- ${title} file icon, ${grid} px grid: white sheet with the brand's leaf corners, edge in the type colour, glyph of the ${module} module. Original artwork, MPL-2.0. -->
  <path fill="${color}" d="${sheetPath(x0 + dx, y0 + dy, x1 + dx, y1 + dy, R, r)}"/>
  <path fill="${OUTLINE}" d="${sheetPath(x0, y0, x1, y1, R, r)}"/>
  <path fill="${WHITE}" d="${sheetPath(x0 + w, y0 + w, x1 - w, y1 - w, Math.max(R - w, 0), Math.max(r - w, 0))}"/>
  ${GLYPH[type][grid](color)}
</svg>
`;
}
