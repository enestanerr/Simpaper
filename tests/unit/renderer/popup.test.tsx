// @vitest-environment jsdom
// @jsxRuntime automatic
/**
 * Nested popups: every popup is portaled to document.body, so a menu opened from inside a collapsed ribbon
 * group is not a DOM descendant of the group's popup. A press in it must not count as an outside press of the
 * group popup (which would unmount the menu before the click lands); a press elsewhere still closes both.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n, setLanguage } from '../../../src/renderer/i18n';
import { clipboardControls } from '../../../src/renderer/modules/common/controls';
import { GroupView } from '../../../src/renderer/ribbon/GroupView';
import type { RibbonGroup } from '../../../src/renderer/ribbon/types';
import { setActiveDocId, upsertDocument } from '../../../src/renderer/state/appStore';
import { isInsidePopup } from '../../../src/renderer/ui/Popup';
import { descriptor, FakeIpc, flush, installIpc, removeIpc, resetRendererState } from './helpers';

let ipc: FakeIpc;

beforeEach(async () => {
  resetRendererState();
  initI18n('en');
  await setLanguage('en');
  ipc = installIpc(new FakeIpc());
  ipc.handle('engine:dispatch', () => undefined);
  ipc.handle('view:focus', () => undefined);
  upsertDocument(descriptor('w1', 'writer'));
  setActiveDocId('w1');
});

afterEach(() => {
  cleanup();
  removeIpc();
});

const clipboard: RibbonGroup = { id: 'clipboard', labelKey: 'common.group.clipboard', controls: clipboardControls() };
const dispatched = () => ipc.callsTo('engine:dispatch').map((c) => (c.req as { command: string }).command);

/** Renders the Clipboard group collapsed (level 3), opens it and then the Paste split's menu. */
async function openPasteMenuInCollapsedGroup() {
  render(<GroupView group={clipboard} level={3} scope="tab:home" />);
  const groupButton = screen.getByRole('button', { name: /Clipboard/, expanded: false });
  await act(async () => {
    fireEvent.click(groupButton);
    await flush();
  });
  const groupPopup = screen.getByRole('dialog', { name: 'Clipboard' });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Paste options' }));
    await flush();
  });
  const menu = screen.getByRole('menu', { name: 'Paste' });
  expect(groupPopup.contains(menu)).toBe(false); // siblings in document.body
  return { groupButton, groupPopup, menu };
}

describe('popups opened from inside a popup', () => {
  it('a mouse click on a menu item of a split button inside a collapsed group runs the command', async () => {
    const { groupButton } = await openPasteMenuInCollapsedGroup();
    const item = screen.getByRole('menuitem', { name: /Paste Special/ });
    // A real mouse click: pointerdown (React commits in between), then click.
    await act(async () => {
      fireEvent.pointerDown(item);
      await flush();
    });
    expect(item.isConnected).toBe(true);
    await act(async () => {
      fireEvent.click(item);
      await flush();
    });
    expect(dispatched()).toEqual(['.uno:PasteSpecial']);
    // Choosing the command closes the menu and the group popup (as a button in the group does).
    expect(screen.queryByRole('menu', { name: 'Paste' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Clipboard' })).toBeNull();
    expect(groupButton.getAttribute('aria-expanded')).toBe('false');
  });

  it('choosing a menu item with the keyboard also closes the group popup', async () => {
    await openPasteMenuInCollapsedGroup();
    const item = screen.getByRole('menuitem', { name: /Paste unformatted/ });
    item.focus();
    await act(async () => {
      fireEvent.keyDown(item, { key: 'Enter' });
      await flush();
    });
    expect(dispatched()).toEqual(['.uno:PasteUnformatted']);
    expect(screen.queryByRole('menu', { name: 'Paste' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Clipboard' })).toBeNull();
  });

  it('a press in the group popup closes only the nested menu', async () => {
    const { groupPopup } = await openPasteMenuInCollapsedGroup();
    await act(async () => {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Cut' }));
      await flush();
    });
    expect(screen.queryByRole('menu', { name: 'Paste' })).toBeNull();
    expect(groupPopup.isConnected).toBe(true);
  });

  it('a press outside closes the group popup and its menu', async () => {
    await openPasteMenuInCollapsedGroup();
    await act(async () => {
      fireEvent.pointerDown(document.body);
      await flush();
    });
    expect(screen.queryByRole('menu', { name: 'Paste' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Clipboard' })).toBeNull();
    expect(dispatched()).toEqual([]);
  });

  it('follows the anchor chain and stops at popups that belong elsewhere', () => {
    const outer = document.createElement('div');
    outer.className = 'vr-popup';
    const anchorInOuter = document.createElement('button');
    outer.append(anchorInOuter);
    const stranger = document.createElement('div');
    stranger.className = 'vr-popup';
    const inside = document.createElement('span');
    stranger.append(inside);
    document.body.append(outer, stranger);
    // Unregistered popup (no anchor chain back to `outer`): outside.
    expect(isInsidePopup(inside, outer, null)).toBe(false);
    expect(isInsidePopup(anchorInOuter, outer, null)).toBe(true);
    expect(isInsidePopup(document.body, outer, null)).toBe(false);
    expect(isInsidePopup(null, outer, null)).toBe(false);
    outer.remove();
    stranger.remove();
  });
});

describe('focus on open (GUI check 2026-09-30: Esc and the arrows did nothing in a menu opened with the mouse)', () => {
  it('moves into the popup, although the render that opens it commits before the positioned one', async () => {
    // Like Chromium, which gives no focus to an element under visibility: hidden (jsdom would).
    const focus = HTMLElement.prototype.focus;
    const spy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (!this.closest('[style*="visibility: hidden"]')) focus.call(this, options);
    });
    try {
      const { groupPopup, menu } = await openPasteMenuInCollapsedGroup();
      expect(menu.contains(document.activeElement)).toBe(true);
      await act(async () => {
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        await flush();
      });
      expect(screen.queryByRole('menu', { name: 'Paste' })).toBeNull();
      // Back on the split button (the menu anchors at its wrapper, which cannot take the focus).
      const split = screen.getByRole('button', { name: 'Paste options' }).closest('.rb-split');
      expect(split?.contains(document.activeElement)).toBe(true);
      expect(groupPopup.contains(document.activeElement)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Tab in a menu', () => {
  it('closes it and puts the focus back on its button, from where the browser moves on', async () => {
    const { groupPopup, menu } = await openPasteMenuInCollapsedGroup();
    const item = menu.querySelector<HTMLElement>('[role^="menuitem"]')!;
    item.focus();
    await act(async () => {
      fireEvent.keyDown(item, { key: 'Tab' });
      await flush();
    });
    expect(screen.queryByRole('menu', { name: 'Paste' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Paste options' }).closest('.rb-split')?.contains(document.activeElement)).toBe(true);
    expect(groupPopup.isConnected).toBe(true); // only the menu closes
  });
});
