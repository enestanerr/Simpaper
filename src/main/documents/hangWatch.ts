/**
 * Watchdog for the native windows of open office documents (HangDetector = IsHungAppWindow +
 * SendMessageTimeout(WM_NULL) on a worker thread, docs/dev/platform.md §8). Every visible view is probed
 * on each tick; a document whose window fails `strikes` probes in a row is reported as hung, and as
 * responding again after the next successful probe.
 *
 * A hung engine is reported, never killed automatically: a long operation (a big recalculation, a
 * slow printer driver) also stops the message loop, and killing would throw away unsaved work. The user
 * decides (wait, close the document, or restart its engine: DocumentService.restartEngine).
 */
import type { HangDetector } from '../platform/types';

export interface HangTarget {
  docId: string;
  hwnd: string;
}

export interface HangWatchOptions {
  detector: HangDetector;
  /** Views to probe now: the visible ones, plus those currently reported as hung. */
  targets: () => HangTarget[];
  onChange: (docId: string, responding: boolean) => void;
  /** Default 2500 ms. */
  intervalMs?: number;
  /** Timeout of one probe (default 1000 ms). */
  timeoutMs?: number;
  /** Consecutive failed probes before a window counts as hung (default 2). */
  strikes?: number;
}

export interface HangWatch {
  /** One round of probes (also run by the timer); resolves when every probe of the round finished. */
  tick(): Promise<void>;
  stop(): void;
}

interface ProbeState {
  hwnd: string;
  failures: number;
  hung: boolean;
  probing: boolean;
}

export function startHangWatch(opts: HangWatchOptions): HangWatch {
  const intervalMs = opts.intervalMs ?? 2_500;
  const timeoutMs = opts.timeoutMs ?? 1_000;
  const strikes = Math.max(1, opts.strikes ?? 2);
  const states = new Map<string, ProbeState>();
  let stopped = false;

  const probe = async (target: HangTarget, state: ProbeState): Promise<void> => {
    state.probing = true;
    try {
      // A failing detector (e.g. the native binding is gone) must not make documents look hung.
      const ok = await opts.detector.isResponding(target.hwnd, timeoutMs).catch(() => true);
      if (stopped || states.get(target.docId) !== state) return;
      if (ok) {
        state.failures = 0;
        if (state.hung) {
          state.hung = false;
          opts.onChange(target.docId, true);
        }
      } else if (++state.failures >= strikes && !state.hung) {
        state.hung = true;
        opts.onChange(target.docId, false);
      }
    } finally {
      state.probing = false;
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    let targets: HangTarget[];
    try {
      targets = opts.targets();
    } catch {
      return;
    }
    const seen = new Set<string>();
    const round: Array<Promise<void>> = [];
    for (const target of targets) {
      seen.add(target.docId);
      let state = states.get(target.docId);
      // A new native window (document reloaded after a crash) starts over.
      if (!state || state.hwnd !== target.hwnd) {
        state = { hwnd: target.hwnd, failures: 0, hung: false, probing: false };
        states.set(target.docId, state);
      }
      if (!state.probing) round.push(probe(target, state));
    }
    // Views that are hidden again or gone: forget their counters (a hung view stays a target until it answers).
    for (const docId of [...states.keys()]) if (!seen.has(docId)) states.delete(docId);
    await Promise.all(round);
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return {
    tick,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      states.clear();
    },
  };
}
