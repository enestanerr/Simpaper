/**
 * Planning of page operations (sent as one `pdf:pages` request) and mapping of the current page and
 * the selection through them. Pure functions; indices are 0-based.
 */
import type { PdfPageOp } from '@shared/api/pdf';

/** Id used by {@link simulate} for pages that did not exist before (blank pages). */
export const NEW_PAGE = -1;

function uniqueSorted(indices: readonly number[]): number[] {
  return [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0).sort((a, b) => a - b);
}

/**
 * Applies ops to the list [0 … pageCount-1] and returns, for every resulting page, the original index
 * it came from (duplicates repeat the source index, blank pages are {@link NEW_PAGE}).
 */
export function simulate(pageCount: number, ops: readonly PdfPageOp[]): number[] {
  const pages = Array.from({ length: pageCount }, (_, i) => i);
  for (const op of ops) {
    switch (op.op) {
      case 'delete':
        pages.splice(op.pageIndex, 1);
        break;
      case 'move': {
        const [page] = pages.splice(op.pageIndex, 1);
        if (page !== undefined) pages.splice(op.value ?? op.pageIndex, 0, page);
        break;
      }
      case 'insertBlank':
        pages.splice(op.pageIndex, 0, NEW_PAGE);
        break;
      case 'duplicate': {
        const page = pages[op.pageIndex];
        if (page !== undefined) pages.splice(op.pageIndex + 1, 0, page);
        break;
      }
      case 'rotate':
        break;
    }
  }
  return pages;
}

export function planRotate(selected: readonly number[], degrees: number): PdfPageOp[] {
  return uniqueSorted(selected).map((pageIndex) => ({ op: 'rotate', pageIndex, value: degrees }));
}

/** Deletes from the back so earlier indices stay valid. Returns [] if every page would be deleted. */
export function planDelete(selected: readonly number[], pageCount: number): PdfPageOp[] {
  const pages = uniqueSorted(selected).filter((i) => i < pageCount);
  if (pages.length === 0 || pages.length >= pageCount) return [];
  return pages.reverse().map((pageIndex) => ({ op: 'delete', pageIndex }));
}

/** Each copy is inserted right after its source; processed from the back so indices stay valid. */
export function planDuplicate(selected: readonly number[]): PdfPageOp[] {
  return uniqueSorted(selected)
    .reverse()
    .map((pageIndex) => ({ op: 'duplicate', pageIndex }));
}

export function planInsertBlank(index: number): PdfPageOp[] {
  return [{ op: 'insertBlank', pageIndex: index }];
}

/**
 * Moves the selected pages (kept in document order) to the drop slot `slot` (0 … pageCount, i.e. the gap
 * before page `slot`). Returns [] when nothing would change.
 */
export function planMove(selected: readonly number[], slot: number, pageCount: number): PdfPageOp[] {
  const moving = uniqueSorted(selected).filter((i) => i < pageCount);
  if (moving.length === 0) return [];
  const clampedSlot = Math.max(0, Math.min(pageCount, slot));
  const movingSet = new Set(moving);
  const rest = Array.from({ length: pageCount }, (_, i) => i).filter((i) => !movingSet.has(i));
  const insertAt = rest.filter((i) => i < clampedSlot).length;
  const target = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
  const current = Array.from({ length: pageCount }, (_, i) => i);
  const ops: PdfPageOp[] = [];
  if (moving.length === 1) {
    const from = moving[0]!;
    const to = target.indexOf(from);
    return from === to ? [] : [{ op: 'move', pageIndex: from, value: to }];
  }
  for (let t = 0; t < pageCount; t++) {
    if (current[t] === target[t]) continue;
    const k = current.indexOf(target[t]!);
    const [page] = current.splice(k, 1);
    current.splice(t, 0, page!);
    ops.push({ op: 'move', pageIndex: k, value: t });
  }
  return ops;
}

/** Moves the selection one step up (-1) or down (+1); [] at the document edge. */
export function planNudge(selected: readonly number[], direction: -1 | 1, pageCount: number): PdfPageOp[] {
  const pages = uniqueSorted(selected).filter((i) => i < pageCount);
  if (pages.length === 0) return [];
  if (direction < 0) {
    const first = pages[0]!;
    return first === 0 ? [] : planMove(pages, first - 1, pageCount);
  }
  const last = pages[pages.length - 1]!;
  return last >= pageCount - 1 ? [] : planMove(pages, last + 2, pageCount);
}

/**
 * Where a page ends up after the ops. A deleted page maps to the next surviving page (the one that moves
 * into its place), or to the previous one when nothing follows.
 */
export function mapIndex(pageCount: number, ops: readonly PdfPageOp[], index: number): number {
  const result = simulate(pageCount, ops);
  if (result.length === 0) return 0;
  const found = result.indexOf(index);
  if (found !== -1) return found;
  for (let j = index + 1; j < pageCount; j++) {
    const at = result.indexOf(j);
    if (at !== -1) return at;
  }
  for (let j = index - 1; j >= 0; j--) {
    const at = result.indexOf(j);
    if (at !== -1) return at;
  }
  return Math.min(index, result.length - 1);
}

/** New indices of the selected pages after the ops (copies and deleted pages are not selected). */
export function mapSelection(pageCount: number, ops: readonly PdfPageOp[], selected: readonly number[]): number[] {
  const result = simulate(pageCount, ops);
  const wanted = new Set(selected);
  const out: number[] = [];
  const seen = new Set<number>();
  result.forEach((original, index) => {
    if (wanted.has(original) && !seen.has(original)) {
      seen.add(original);
      out.push(index);
    }
  });
  return out;
}

/**
 * Parses page ranges typed by the user ("1-3, 5; 8-") into 0-based indices, in the given order and
 * without duplicates. Returns null for invalid input or pages outside 1…pageCount.
 */
export function parsePageRanges(input: string, pageCount: number): number[] | null {
  const parts = input
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of parts) {
    const m = /^(\d+)?\s*(?:[-–]\s*(\d+)?)?$/.exec(part);
    if (!m || (!m[1] && !m[2])) return null;
    const isRange = part.includes('-') || part.includes('–');
    const start = m[1] ? Number(m[1]) : 1;
    const end = isRange ? (m[2] ? Number(m[2]) : pageCount) : start;
    if (start < 1 || end < 1 || start > pageCount || end > pageCount) return null;
    const step = start <= end ? 1 : -1;
    for (let p = start; step > 0 ? p <= end : p >= end; p += step) {
      if (!seen.has(p - 1)) {
        seen.add(p - 1);
        out.push(p - 1);
      }
    }
  }
  return out;
}

/** 0-based indices → "1-3, 5" (sorted). */
export function formatPageRanges(indices: readonly number[]): string {
  const sorted = uniqueSorted(indices);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(i === j ? `${sorted[i]! + 1}` : `${sorted[i]! + 1}-${sorted[j]! + 1}`);
    i = j + 1;
  }
  return parts.join(', ');
}
