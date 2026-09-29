/**
 * KeyTips (Office "Alt" navigation), pure part. KeyTips are ASCII letters/digits only and never use
 * the letter I (Turkish I/ı/İ/i ambiguity); matching is done on the typed character, normalised with
 * normalizeKeyTipChar so Turkish-Q and Turkish-F layouts behave the same.
 */
import { normalizeKeyTipChar } from '../i18n/turkish';

export interface KeyTipTarget {
  id: string;
  keytip: string;
}

export type KeyTipMatch<T extends KeyTipTarget = KeyTipTarget> =
  | { kind: 'none' }
  | { kind: 'partial'; candidates: T[] }
  | { kind: 'exact'; target: T };

const VALID = /^[A-HJ-Z0-9]{1,3}$/;

export function isValidKeyTip(keytip: string): boolean {
  return VALID.test(keytip);
}

export function matchKeyTip<T extends KeyTipTarget>(targets: readonly T[], typed: string): KeyTipMatch<T> {
  if (!typed) return { kind: 'partial', candidates: [...targets] };
  const candidates = targets.filter((t) => t.keytip.startsWith(typed));
  if (candidates.length === 0) return { kind: 'none' };
  const exact = candidates.find((t) => t.keytip === typed);
  if (exact) return { kind: 'exact', target: exact };
  return { kind: 'partial', candidates };
}

/** Appends a typed key (KeyboardEvent.key) to the buffer; returns null for keys that can never be part of a KeyTip. */
export function appendKeyTipChar(typed: string, key: string): string | null {
  if ([...key].length !== 1) return null;
  const ch = normalizeKeyTipChar(key);
  return ch ? typed + ch : null;
}

/** Duplicates and prefix conflicts ("F" and "FS" cannot coexist) within one scope. */
export function findKeyTipConflicts(keytips: readonly string[]): string[] {
  const problems: string[] = [];
  const sorted = [...keytips].sort();
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (a === b) problems.push(`duplicate ${a}`);
      else if (b.startsWith(a)) problems.push(`${a} is a prefix of ${b}`);
    }
  }
  return problems;
}

/** True when `tip` cannot coexist with the KeyTips in `used` (same, or one is a prefix of the other). */
export function keyTipConflicts(tip: string, used: Iterable<string>): boolean {
  for (const u of used) if (u === tip || u.startsWith(tip) || tip.startsWith(u)) return true;
  return false;
}

/** Prefixes of collapsed-group KeyTips, in order of preference (Office uses "Z"). */
const GROUP_PREFIXES = ['Z', 'Y', 'X', 'Q'] as const;
const GROUP_ALPHABET = 'ABCDEFGHJKLMNOPQRSTUVWXY123456789';

/**
 * KeyTips for collapsed groups: "Z" + a letter/digit that does not conflict with the KeyTips already used
 * in the scope. When a scope uses "Z" itself (or all "Z?" combinations), the next prefix is used.
 */
export function assignGroupKeyTips(groupIds: readonly string[], taken: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set(taken);
  const candidates = GROUP_PREFIXES.flatMap((prefix) => [...GROUP_ALPHABET].map((ch) => `${prefix}${ch}`));
  let i = 0;
  for (const id of groupIds) {
    while (i < candidates.length && keyTipConflicts(candidates[i]!, used)) i++;
    const tip = candidates[i++];
    if (!tip) break;
    used.add(tip);
    out.set(id, tip);
  }
  return out;
}

/** Quick Access Toolbar KeyTips: 1–9, then 09, 08 … (Office convention). */
export function qatKeyTip(index: number): string {
  if (index < 9) return String(index + 1);
  const n = 9 - (index - 9);
  return n >= 1 ? `0${n}` : '';
}
