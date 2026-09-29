import { describe, expect, it } from 'vitest';
import { ShellKeyDetector, STALE_KEY_MS, VK, type LowLevelKey } from '../../../src/main/platform/key-state';
import type { ShellKey } from '../../../src/main/platform/types';

const TAB = 0x09;
const KEY_A = 0x41;

/** Feeds `[vk, 'down' | 'up', time?]` events and returns every reported gesture. */
function run(detector: ShellKeyDetector, events: [number, 'down' | 'up', number?][]): ShellKey[] {
  let t = 1000;
  const out: ShellKey[] = [];
  for (const [vk, dir, time] of events) {
    t = time ?? t + 30;
    const key = detector.handle({ vk, down: dir === 'down', time: t } satisfies LowLevelKey);
    if (key) out.push(key);
  }
  return out;
}

describe('ShellKeyDetector', () => {
  it('reports a bare Alt tap (left, generic and right Alt without AltGr)', () => {
    expect(run(new ShellKeyDetector(), [[VK.LMENU, 'down'], [VK.LMENU, 'up']])).toEqual(['Alt']);
    expect(run(new ShellKeyDetector(), [[VK.MENU, 'down'], [VK.MENU, 'up']])).toEqual(['Alt']);
    // US layout: Right Alt is a plain Alt (no synthetic Ctrl).
    expect(run(new ShellKeyDetector(), [[VK.RMENU, 'down'], [VK.RMENU, 'up']])).toEqual(['Alt']);
  });

  it('keeps the gesture across auto-repeat of the held Alt', () => {
    expect(run(new ShellKeyDetector(), [[VK.LMENU, 'down'], [VK.LMENU, 'down'], [VK.LMENU, 'down'], [VK.LMENU, 'up']])).toEqual(['Alt']);
  });

  it('ignores AltGr on Turkish/German layouts (synthetic Left-Ctrl + Right-Alt), in both release orders', () => {
    const d = new ShellKeyDetector();
    expect(run(d, [[VK.LCONTROL, 'down'], [VK.RMENU, 'down'], [VK.RMENU, 'up'], [VK.LCONTROL, 'up']])).toEqual([]);
    expect(run(d, [[VK.LCONTROL, 'down'], [VK.RMENU, 'down'], [VK.LCONTROL, 'up'], [VK.RMENU, 'up']])).toEqual([]);
    // AltGr+Q types '@' on Turkish Q: still nothing, and a following Alt tap works again.
    expect(run(d, [[VK.LCONTROL, 'down'], [VK.RMENU, 'down'], [0x51, 'down'], [0x51, 'up'], [VK.RMENU, 'up'], [VK.LCONTROL, 'up']])).toEqual([]);
    expect(run(d, [[VK.LMENU, 'down'], [VK.LMENU, 'up']])).toEqual(['Alt']);
  });

  it('ignores Alt combined with any other key', () => {
    const d = new ShellKeyDetector();
    expect(run(d, [[VK.LMENU, 'down'], [TAB, 'down'], [TAB, 'up'], [VK.LMENU, 'up']])).toEqual([]); // Alt+Tab
    expect(run(d, [[VK.LCONTROL, 'down'], [VK.LMENU, 'down'], [VK.LMENU, 'up'], [VK.LCONTROL, 'up']])).toEqual([]); // Ctrl+Alt
    expect(run(d, [[VK.LMENU, 'down'], [VK.LCONTROL, 'down'], [VK.LCONTROL, 'up'], [VK.LMENU, 'up']])).toEqual([]); // Alt then Ctrl
    expect(run(d, [[VK.LSHIFT, 'down'], [VK.LMENU, 'down'], [VK.LMENU, 'up'], [VK.LSHIFT, 'up']])).toEqual([]); // Shift+Alt (layout switch)
    expect(run(d, [[VK.LMENU, 'down'], [KEY_A, 'down'], [VK.LMENU, 'up'], [KEY_A, 'up']])).toEqual([]); // mnemonic
    expect(run(d, [[VK.LMENU, 'down'], [VK.RMENU, 'down'], [VK.RMENU, 'up'], [VK.LMENU, 'up']])).toEqual([]); // both Alts
    expect(run(d, [[VK.LWIN, 'down'], [VK.LMENU, 'down'], [VK.LMENU, 'up'], [VK.LWIN, 'up']])).toEqual([]);
    expect(run(d, [[VK.LMENU, 'down'], [VK.LMENU, 'up']])).toEqual(['Alt']); // recovers
  });

  it('reports an unmodified F10 press and release', () => {
    const d = new ShellKeyDetector();
    expect(run(d, [[VK.F10, 'down'], [VK.F10, 'down'], [VK.F10, 'up']])).toEqual(['F10']);
    expect(run(d, [[VK.LSHIFT, 'down'], [VK.F10, 'down'], [VK.F10, 'up'], [VK.LSHIFT, 'up']])).toEqual([]); // context menu
    expect(run(d, [[VK.LCONTROL, 'down'], [VK.F10, 'down'], [VK.F10, 'up'], [VK.LCONTROL, 'up']])).toEqual([]);
    expect(run(d, [[VK.F10, 'down'], [KEY_A, 'down'], [KEY_A, 'up'], [VK.F10, 'up']])).toEqual([]);
    expect(run(d, [[VK.LMENU, 'down'], [VK.F10, 'down'], [VK.F10, 'up'], [VK.LMENU, 'up']])).toEqual([]);
  });

  it('can be cancelled (mouse click during the gesture, focus change) and reset', () => {
    const d = new ShellKeyDetector();
    d.handle({ vk: VK.LMENU, down: true, time: 1 });
    expect(d.armed).toBe(true);
    d.cancel();
    expect(d.armed).toBe(false);
    expect(d.handle({ vk: VK.LMENU, down: false, time: 2 })).toBeNull();
    expect(run(d, [[VK.LMENU, 'down'], [VK.LMENU, 'up']])).toEqual(['Alt']);
    d.handle({ vk: VK.F10, down: true, time: 5000 });
    d.reset();
    expect(d.armed).toBe(false);
    expect(d.handle({ vk: VK.F10, down: false, time: 5001 })).toBeNull();
  });

  it('forgets a key whose release was missed, but not a key that is really held', () => {
    const d = new ShellKeyDetector();
    // Shift went down while another app was in the foreground; its key-up never reached us.
    d.handle({ vk: VK.LSHIFT, down: true, time: 1000 });
    expect(run(d, [[VK.LMENU, 'down', 1000 + STALE_KEY_MS + 1], [VK.LMENU, 'up', 1000 + STALE_KEY_MS + 50]])).toEqual(['Alt']);
    const e = new ShellKeyDetector();
    e.handle({ vk: VK.LSHIFT, down: true, time: 1000 });
    expect(run(e, [[VK.LMENU, 'down', 1500], [VK.LMENU, 'up', 1600]])).toEqual([]);
  });

  it('tolerates key-ups it never saw go down', () => {
    const d = new ShellKeyDetector();
    expect(d.handle({ vk: KEY_A, down: false, time: 1 })).toBeNull();
    expect(run(d, [[VK.LMENU, 'down'], [VK.LMENU, 'up']])).toEqual(['Alt']);
  });
});
