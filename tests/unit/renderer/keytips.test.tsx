// @vitest-environment jsdom
/**
 * KeyTips (Alt / F10 navigation): the pure matching rules, collapsed-group KeyTips, the scope/typing state
 * machine and the global keyboard handler (bare left Alt, F10, Esc, Turkish I, AltGr).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendKeyTipChar,
  assignGroupKeyTips,
  findKeyTipConflicts,
  isValidKeyTip,
  keyTipConflicts,
  matchKeyTip,
  qatKeyTip,
} from '../../../src/renderer/ribbon/keytips';
import { keyTipBack, keyTipInput, keyTipTargets, registerKeyTip, startKeyTips, stopKeyTips, useKeyTips } from '../../../src/renderer/ribbon/keytipStore';
import { installGlobalKeyboard, isEditableTarget, matchShortcut, type KeyLike } from '../../../src/renderer/shell/keyboard';
import { enqueuePrompt } from '../../../src/renderer/state/appStore';
import { resetRendererState } from './helpers';

const t = (id: string, keytip: string) => ({ id, keytip });

describe('KeyTip rules', () => {
  it('accepts 1–3 ASCII letters/digits without I', () => {
    for (const ok of ['H', 'FP', '1', '09', 'ZA', 'ABC']) expect(isValidKeyTip(ok), ok).toBe(true);
    for (const bad of ['', 'I', 'AI', 'h', 'Ş', 'ABCD', 'A-B']) expect(isValidKeyTip(bad), bad).toBe(false);
  });

  it('matches exact tips, narrows on prefixes and ignores unknown input', () => {
    const targets = [t('paste', 'V'), t('fontName', 'FF'), t('fontSize', 'FS'), t('bold', '1')];
    expect(matchKeyTip(targets, 'V')).toEqual({ kind: 'exact', target: targets[0] });
    expect(matchKeyTip(targets, 'F')).toEqual({ kind: 'partial', candidates: [targets[1], targets[2]] });
    expect(matchKeyTip(targets, 'FS')).toEqual({ kind: 'exact', target: targets[2] });
    expect(matchKeyTip(targets, 'Q')).toEqual({ kind: 'none' });
    expect(matchKeyTip(targets, '')).toEqual({ kind: 'partial', candidates: targets });
  });

  it('normalises typed characters: every Turkish I variant becomes I, lower case becomes upper case', () => {
    expect(appendKeyTipChar('', 'f')).toBe('F');
    expect(appendKeyTipChar('F', 'p')).toBe('FP');
    for (const i of ['i', 'ı', 'İ', 'I']) expect(appendKeyTipChar('', i)).toBe('I');
    expect(appendKeyTipChar('', 'ş')).toBeNull();
    expect(appendKeyTipChar('', 'Enter')).toBeNull();
    expect(appendKeyTipChar('', '7')).toBe('7');
  });

  it('finds duplicates and prefix conflicts', () => {
    expect(findKeyTipConflicts(['A', 'B', 'FP'])).toEqual([]);
    expect(findKeyTipConflicts(['A', 'A'])).toEqual(['duplicate A']);
    expect(findKeyTipConflicts(['F', 'FP'])).toEqual(['F is a prefix of FP']);
    expect(keyTipConflicts('ZA', ['Z'])).toBe(true);
    expect(keyTipConflicts('Z', ['ZA'])).toBe(true);
    expect(keyTipConflicts('ZB', ['ZA', 'Y'])).toBe(false);
  });

  it('numbers the Quick Access Toolbar 1–9, then 09, 08 …', () => {
    expect([0, 1, 8, 9, 10, 17, 18].map(qatKeyTip)).toEqual(['1', '2', '9', '09', '08', '01', '']);
  });
});

describe('collapsed group KeyTips', () => {
  it('uses Z + letter, skipping tips already taken', () => {
    const tips = assignGroupKeyTips(['clipboard', 'font', 'paragraph'], new Set(['V', 'ZB']));
    expect([...tips.values()]).toEqual(['ZA', 'ZC', 'ZD']);
  });

  it('falls back to another prefix when the scope uses Z itself', () => {
    const tips = assignGroupKeyTips(['zoom', 'navigate'], new Set(['Z', 'H']));
    expect([...tips.values()]).toEqual(['YA', 'YB']);
    expect(findKeyTipConflicts(['Z', 'H', ...tips.values()])).toEqual([]);
  });

  it('never produces the letter I and stays conflict-free for many groups', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `g${i}`);
    const taken = new Set(['ZA', 'Y', 'FP']);
    const tips = [...assignGroupKeyTips(ids, taken).values()];
    expect(tips).toHaveLength(40);
    expect(tips.every(isValidKeyTip)).toBe(true);
    expect(findKeyTipConflicts([...taken, ...tips])).toEqual([]);
  });
});

describe('KeyTip state machine', () => {
  const unregister: (() => void)[] = [];
  afterEach(() => {
    unregister.splice(0).forEach((u) => u());
    stopKeyTips();
  });

  function reg(scope: string, id: string, keytip: string, next: string | null = null) {
    const activate = vi.fn(() => next);
    unregister.push(registerKeyTip(scope, { id, keytip, activate }));
    return activate;
  }

  it('activates a tab, enters its scope and runs a control', () => {
    const home = reg('root', 'tab:home', 'H', 'tab:home');
    const bold = reg('tab:home', 'bold', '1');
    startKeyTips();
    expect(useKeyTips.getState()).toMatchObject({ active: true, scope: 'root', typed: '' });
    expect(keyTipInput('h')).toBe(true);
    expect(home).toHaveBeenCalledOnce();
    expect(useKeyTips.getState()).toMatchObject({ active: true, scope: 'tab:home', stack: ['root'] });
    expect(keyTipInput('1')).toBe(true);
    expect(bold).toHaveBeenCalledOnce();
    expect(useKeyTips.getState().active).toBe(false);
  });

  it('waits for the second character of two-letter tips and swallows unknown keys', () => {
    reg('root', 'tab:home', 'H', 'tab:home');
    const fontSize = reg('tab:home', 'fontSize', 'FS');
    reg('tab:home', 'fontName', 'FF');
    startKeyTips('tab:home');
    expect(keyTipInput('f')).toBe(true);
    expect(useKeyTips.getState().typed).toBe('F');
    expect(keyTipInput('q')).toBe(true); // no "FQ": ignored, prefix kept
    expect(useKeyTips.getState().typed).toBe('F');
    expect(keyTipInput('s')).toBe(true);
    expect(fontSize).toHaveBeenCalledOnce();
  });

  it('Esc clears the typed prefix, then goes back one scope, then leaves', () => {
    reg('root', 'tab:home', 'H', 'tab:home');
    reg('tab:home', 'fontSize', 'FS');
    startKeyTips();
    keyTipInput('H');
    keyTipInput('F');
    keyTipBack();
    expect(useKeyTips.getState()).toMatchObject({ scope: 'tab:home', typed: '' });
    keyTipBack();
    expect(useKeyTips.getState()).toMatchObject({ scope: 'root', active: true });
    keyTipBack();
    expect(useKeyTips.getState().active).toBe(false);
  });

  it('ignores input while inactive and forgets unmounted targets', () => {
    const off = registerKeyTip('root', { id: 'x', keytip: 'X', activate: () => null });
    expect(keyTipInput('x')).toBe(false);
    off();
    expect(keyTipTargets('root').some((k) => k.id === 'x')).toBe(false);
  });
});

describe('shortcuts', () => {
  const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });

  it('maps Office shortcuts', () => {
    expect(matchShortcut(key('s', { ctrlKey: true }), false)).toBe('save');
    expect(matchShortcut(key('S', { ctrlKey: true }), false)).toBe('save');
    expect(matchShortcut(key('F12'), false)).toBe('saveAs');
    expect(matchShortcut(key('F1', { ctrlKey: true }), false)).toBe('toggleRibbon');
    expect(matchShortcut(key('Tab', { ctrlKey: true }), false)).toBe('nextDoc');
    expect(matchShortcut(key('Tab', { ctrlKey: true, shiftKey: true }), false)).toBe('prevDoc');
    expect(matchShortcut(key('F6', { shiftKey: true }), false)).toBe('regionPrev');
    expect(matchShortcut(key('F10'), false)).toBe('keytips');
  });

  it('leaves undo/redo to text fields and never treats AltGr (Ctrl+Alt) as Ctrl', () => {
    expect(matchShortcut(key('z', { ctrlKey: true }), false)).toBe('undo');
    expect(matchShortcut(key('z', { ctrlKey: true }), true)).toBeNull();
    // Turkish Q: AltGr+Q = @ arrives as Ctrl+Alt+q.
    expect(matchShortcut(key('q', { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(matchShortcut(key('s', { ctrlKey: true, altKey: true }), false)).toBeNull();
  });

  it('knows which targets are editable', () => {
    const input = document.createElement('input');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const div = document.createElement('div');
    div.contentEditable = 'true';
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('global keyboard handler', () => {
  let uninstall: () => void;
  beforeEach(() => {
    resetRendererState();
    uninstall = installGlobalKeyboard(window);
  });
  afterEach(() => uninstall());

  const down = (init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  const up = (init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init }));

  it('shows KeyTips for a bare left Alt and hides them on the next Alt', () => {
    down({ key: 'Alt', code: 'AltLeft', altKey: true });
    up({ key: 'Alt', code: 'AltLeft' });
    expect(useKeyTips.getState().active).toBe(true);
    down({ key: 'Alt', code: 'AltLeft', altKey: true });
    expect(useKeyTips.getState().active).toBe(false);
  });

  it('does not show KeyTips for AltGr, Alt combinations or while a prompt is open', () => {
    down({ key: 'Alt', code: 'AltRight', altKey: true, ctrlKey: true });
    up({ key: 'Alt', code: 'AltRight' });
    expect(useKeyTips.getState().active).toBe(false);
    down({ key: 'Alt', code: 'AltLeft', altKey: true });
    down({ key: 'f', code: 'KeyF', altKey: true });
    up({ key: 'Alt', code: 'AltLeft' });
    expect(useKeyTips.getState().active).toBe(false);
    enqueuePrompt({ id: 'p1', kind: 'unsavedChanges', docId: 'd', fileName: 'a.docx' });
    down({ key: 'Alt', code: 'AltLeft', altKey: true });
    up({ key: 'Alt', code: 'AltLeft' });
    expect(useKeyTips.getState().active).toBe(false);
  });

  it('routes typed keys to KeyTips while they are shown and Esc steps back', () => {
    const activate = vi.fn(() => null);
    const off = registerKeyTip('root', { id: 'tab:x', keytip: 'X', activate });
    down({ key: 'F10', code: 'F10' });
    expect(useKeyTips.getState().active).toBe(true);
    const ev = new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(activate).toHaveBeenCalledOnce();
    down({ key: 'F10', code: 'F10' });
    down({ key: 'Escape', code: 'Escape' });
    expect(useKeyTips.getState().active).toBe(false);
    off();
  });

  it('a pointer press or window blur ends KeyTip mode', () => {
    startKeyTips();
    window.dispatchEvent(new Event('pointerdown'));
    expect(useKeyTips.getState().active).toBe(false);
    startKeyTips();
    window.dispatchEvent(new Event('blur'));
    expect(useKeyTips.getState().active).toBe(false);
  });
});
