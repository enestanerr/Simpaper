/** Colour palettes for colour pickers (original set; hue columns × shade rows like a ribbon colour gallery). */

export interface PaletteHue {
  /** i18n key suffix under `shell.color.hue.*`. */
  hue: string;
  base: number;
}

export const PALETTE_HUES: readonly PaletteHue[] = [
  { hue: 'white', base: 0xffffff },
  { hue: 'black', base: 0x000000 },
  { hue: 'slate', base: 0x5b6475 },
  { hue: 'ink', base: 0x1d2b53 },
  { hue: 'blue', base: 0x3b5bdb },
  { hue: 'teal', base: 0x12876f },
  { hue: 'green', base: 0x3f8f2f },
  { hue: 'gold', base: 0xc9a227 },
  { hue: 'orange', base: 0xd5582a },
  { hue: 'red', base: 0xc0303f },
];

export const STANDARD_COLORS: readonly PaletteHue[] = [
  { hue: 'darkRed', base: 0x8e1b24 },
  { hue: 'red', base: 0xe03131 },
  { hue: 'orange', base: 0xf08c00 },
  { hue: 'yellow', base: 0xfcc419 },
  { hue: 'lime', base: 0x94d82d },
  { hue: 'green', base: 0x2f9e44 },
  { hue: 'cyan', base: 0x1098ad },
  { hue: 'blue', base: 0x1c7ed6 },
  { hue: 'navy', base: 0x1d2b53 },
  { hue: 'purple', base: 0x7048e8 },
];

export const HIGHLIGHT_COLORS: readonly PaletteHue[] = [
  { hue: 'yellow', base: 0xffff00 },
  { hue: 'lime', base: 0x00ff00 },
  { hue: 'cyan', base: 0x00ffff },
  { hue: 'pink', base: 0xff00ff },
  { hue: 'blue', base: 0x0000ff },
  { hue: 'red', base: 0xff0000 },
  { hue: 'navy', base: 0x000080 },
  { hue: 'teal', base: 0x008080 },
  { hue: 'green', base: 0x008000 },
  { hue: 'purple', base: 0x800080 },
  { hue: 'darkRed', base: 0x800000 },
  { hue: 'olive', base: 0x808000 },
  { hue: 'gray', base: 0x808080 },
  { hue: 'silver', base: 0xc0c0c0 },
  { hue: 'black', base: 0x000000 },
];

/** Shade keys (i18n `shell.color.shade.*`) with the mix amount: >0 towards white, <0 towards black. */
export type ShadeKey = 'lighter80' | 'lighter60' | 'lighter40' | 'darker25' | 'darker50' | 'darker5' | 'darker15' | 'darker35' | 'lighter50' | 'lighter35' | 'lighter25' | 'lighter15' | 'lighter5';

const SHADES_MID: [ShadeKey, number][] = [['lighter80', 0.8], ['lighter60', 0.6], ['lighter40', 0.4], ['darker25', -0.25], ['darker50', -0.5]];
const SHADES_LIGHT: [ShadeKey, number][] = [['darker5', -0.05], ['darker15', -0.15], ['darker25', -0.25], ['darker35', -0.35], ['darker50', -0.5]];
const SHADES_DARK: [ShadeKey, number][] = [['lighter50', 0.5], ['lighter35', 0.35], ['lighter25', 0.25], ['lighter15', 0.15], ['lighter5', 0.05]];

function channel(c: number, shift: number): number {
  return (c >> shift) & 0xff;
}

export function luminance(color: number): number {
  return (0.2126 * channel(color, 16) + 0.7152 * channel(color, 8) + 0.0722 * channel(color, 0)) / 255;
}

export function mix(color: number, amount: number): number {
  const target = amount >= 0 ? 255 : 0;
  const a = Math.abs(amount);
  const m = (v: number) => Math.round(v + (target - v) * a);
  return (m(channel(color, 16)) << 16) | (m(channel(color, 8)) << 8) | m(channel(color, 0));
}

export function shadesOf(base: number): { shade: ShadeKey; color: number }[] {
  const l = luminance(base);
  const set = l > 0.9 ? SHADES_LIGHT : l < 0.08 ? SHADES_DARK : SHADES_MID;
  return set.map(([shade, amount]) => ({ shade, color: mix(base, amount) }));
}

export function toHex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
}

export function fromHex(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m?.[1] ? parseInt(m[1], 16) : null;
}
