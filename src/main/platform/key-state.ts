/**
 * Bare-Alt / F10 detection from low-level keyboard events (pure; driven by win32/shell-keys.ts).
 *
 * Reports `Alt` when an Alt key is pressed and released with no other key (or mouse button) in
 * between, and `F10` for an unmodified F10 press + release. Ctrl+Alt and AltGr never count: on
 * layouts with AltGr (Turkish Q/F, German, …) Windows sends a synthetic Left-Ctrl before Right-Alt,
 * so the Ctrl is already held when the Alt arrives. Auto-repeat of the held key keeps the gesture.
 */
import type { ShellKey } from './types';

export const VK = {
  SHIFT: 0x10,
  CONTROL: 0x11,
  MENU: 0x12,
  LWIN: 0x5b,
  RWIN: 0x5c,
  F10: 0x79,
  LSHIFT: 0xa0,
  RSHIFT: 0xa1,
  LCONTROL: 0xa2,
  RCONTROL: 0xa3,
  LMENU: 0xa4,
  RMENU: 0xa5,
} as const;

export interface LowLevelKey {
  vk: number;
  down: boolean;
  /** Event time in milliseconds (KBDLLHOOKSTRUCT.time); used to forget keys whose key-up was missed. */
  time: number;
}

/** A key that neither repeated nor was released for this long is assumed released (missed key-up). */
export const STALE_KEY_MS = 2000;

function isAlt(vk: number): boolean {
  return vk === VK.MENU || vk === VK.LMENU || vk === VK.RMENU;
}

type State = 'idle' | 'alt' | 'f10' | 'cancelled';

export class ShellKeyDetector {
  private state: State = 'idle';
  /** vk → time of the last down/repeat event. */
  private readonly held = new Map<number, number>();

  /** True while an Alt or F10 gesture is in progress (a mouse hook is only needed then). */
  get armed(): boolean {
    return this.state === 'alt' || this.state === 'f10';
  }

  /** Feeds one event; returns the gesture that just completed, if any. */
  handle(event: LowLevelKey): ShellKey | null {
    this.forgetStale(event.time);
    return event.down ? this.onDown(event) : this.onUp(event);
  }

  /** A mouse button went down, focus moved, or the hook was (re)installed: abandon the gesture. */
  cancel(): void {
    if (this.state !== 'idle') this.state = 'cancelled';
    if (this.held.size === 0) this.state = 'idle';
  }

  reset(): void {
    this.state = 'idle';
    this.held.clear();
  }

  private onDown(event: LowLevelKey): null {
    const repeat = this.held.has(event.vk);
    this.held.set(event.vk, event.time);
    const alone = this.held.size === 1;
    switch (this.state) {
      case 'idle':
        if (!repeat && alone && isAlt(event.vk)) this.state = 'alt';
        else if (!repeat && alone && event.vk === VK.F10) this.state = 'f10';
        else if (!alone) this.state = 'cancelled';
        break;
      case 'alt':
        if (!(repeat && isAlt(event.vk))) this.state = 'cancelled';
        break;
      case 'f10':
        if (!(repeat && event.vk === VK.F10)) this.state = 'cancelled';
        break;
      case 'cancelled':
        break;
    }
    return null;
  }

  private onUp(event: LowLevelKey): ShellKey | null {
    this.held.delete(event.vk);
    let result: ShellKey | null = null;
    if (this.state === 'alt' && isAlt(event.vk)) result = 'Alt';
    else if (this.state === 'f10' && event.vk === VK.F10) result = 'F10';
    this.state = this.held.size === 0 ? 'idle' : 'cancelled';
    return result;
  }

  private forgetStale(now: number): void {
    for (const [vk, t] of this.held) {
      // Tick counts wrap after ~49.7 days; treat a negative age as fresh.
      const age = now - t;
      if (age > STALE_KEY_MS) this.held.delete(vk);
    }
    if (this.held.size === 0 && this.state === 'cancelled') this.state = 'idle';
  }
}
