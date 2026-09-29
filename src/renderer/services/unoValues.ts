/**
 * Interpreting FeatureStateEvent values sent by the engine. Shapes were observed on LibreOffice 26.8.0.3
 * (headless probe, see docs/dev/shell-ui.md):
 *   .uno:Bold → boolean              .uno:Zoom → [PropertyValue{Name:'Value',Value:100}, ValueSet, Type]
 *   .uno:CharFontName → FontDescriptor{Name,...}   .uno:FontHeight → FontHeight{Height,Prop,Diff}
 *   .uno:Color / .uno:BackgroundColor → long (-1 = automatic)
 *   .uno:StateTableCell → [PropertyValue{Name:'Value',Value:'Average: 2; Sum: 6'}, PropertyValue{Name:'Type'}]
 *   .uno:AssignLayout → current AutoLayout number      .uno:PageStatus → 'Slide 2 / 5' (engine UI language)
 */
import type { UnoPlain } from '@shared/engine-protocol';

type UnoObject = { [key: string]: UnoPlain };

function isObject(v: UnoPlain | undefined): v is UnoObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Checked state of toggle commands (bool items; enum/number items count as "on" when non-zero). */
export function unoPressed(value: UnoPlain | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (isObject(value)) {
    if (typeof value['State'] === 'boolean') return value['State'];
    if (typeof value['Value'] === 'boolean') return value['Value'];
  }
  return false;
}

/** Value of a named entry in a sequence of PropertyValue structs. */
export function propertyValue(value: UnoPlain | undefined, name: string): UnoPlain | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    if (isObject(item) && item['Name'] === name) return item['Value'];
  }
  return undefined;
}

export function unoString(value: UnoPlain | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === 'string');
    if (typeof first === 'string') return first;
    const named = propertyValue(value, 'Value');
    return typeof named === 'string' ? named : null;
  }
  if (isObject(value)) {
    for (const key of ['Value', 'Name', 'StyleName']) {
      const v = value[key];
      if (typeof v === 'string') return v;
    }
  }
  return null;
}

export function unoNumber(value: UnoPlain | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function zoomFromState(value: UnoPlain | undefined): number | null {
  const direct = unoNumber(value);
  if (direct !== null) return direct;
  const named = unoNumber(propertyValue(value, 'Value') ?? null);
  if (named !== null) return named;
  if (isObject(value)) return unoNumber(value['Value'] ?? value['CurrentZoom'] ?? null);
  return null;
}

export function fontNameFromState(value: UnoPlain | undefined): string | null {
  if (typeof value === 'string') return value || null;
  if (isObject(value)) {
    const name = value['Name'] ?? value['FamilyName'];
    return typeof name === 'string' && name ? name : null;
  }
  return null;
}

export function fontHeightFromState(value: UnoPlain | undefined): number | null {
  const direct = unoNumber(value);
  if (direct !== null) return direct > 0 ? direct : null;
  if (isObject(value)) {
    const h = unoNumber(value['Height'] ?? null);
    return h !== null && h > 0 ? h : null;
  }
  return null;
}

/** Colour state as 0xRRGGBB, or null for automatic / transparent / unknown. */
export function colorFromState(value: UnoPlain | undefined): number | null {
  const n = unoNumber(value) ?? (isObject(value) ? unoNumber(value['Color'] ?? null) : null);
  if (n === null || n < 0) return null;
  return n & 0xffffff;
}

/**
 * Current style from `.uno:StyleApply` (frame::status::Template): the programmatic name
 * (StyleNameIdentifier, e.g. "Heading 1") is preferred over the localised UI name.
 */
export function styleNameFromState(value: UnoPlain | undefined): string | null {
  if (typeof value === 'string') return value || null;
  if (isObject(value)) {
    for (const key of ['StyleNameIdentifier', 'StyleName', 'Name']) {
      const s = value[key];
      if (typeof s === 'string' && s) return s;
    }
  }
  return null;
}

/** Calc status bar functions ("Average: 2; Sum: 6") split into display segments. */
export function statusFunctionsFromState(value: UnoPlain | undefined): string[] {
  const text = typeof value === 'string' ? value : propertyValue(value, 'Value');
  if (typeof text !== 'string') return [];
  return text
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** First entry of `.uno:LanguageStatus` (the language of the current selection, in the engine's UI language). */
export function languageFromState(value: UnoPlain | undefined): string | null {
  const s = unoString(value);
  if (!s) return null;
  const main = s.split(';')[0]?.trim();
  return main || null;
}
