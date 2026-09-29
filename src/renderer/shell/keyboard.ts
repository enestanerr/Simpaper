/**
 * Global keyboard handling while the shell (not the native document view) has focus: Office
 * shortcuts, KeyTips (left Alt pressed alone, or F10; AltGr never), and F6 region cycling.
 * Keys pressed inside the document view reach us as `shellKey` events or intercepted commands.
 */
import { SHELL_ACTIONS } from '../ribbon/types';
import { keyTipBack, keyTipInput, startKeyTips, stopKeyTips, useKeyTips } from '../ribbon/keytipStore';
import { cycleDocument } from '../services/documents';
import { focusView } from '../services/engine';
import { runShellAction } from '../services/shellActions';
import { getActiveDocument, useApp } from '../state/appStore';
import { isOfficeKind } from '@shared/modules';

export type ShortcutAction =
  | 'save'
  | 'open'
  | 'new'
  | 'print'
  | 'close'
  | 'saveAs'
  | 'nextDoc'
  | 'prevDoc'
  | 'toggleRibbon'
  | 'keytips'
  | 'regionNext'
  | 'regionPrev'
  | 'undo'
  | 'redo';

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Maps a key event to a shell shortcut. `inEditable`: focus is in a text field (Ctrl+Z/Y stay native there). */
export function matchShortcut(e: KeyLike, inEditable: boolean): ShortcutAction | null {
  // AltGr is reported as Ctrl+Alt: never treat it as a Ctrl shortcut.
  const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
  const key = e.key.length === 1 ? e.key.toLocaleLowerCase('en-US') : e.key;
  if (ctrl && !e.shiftKey) {
    switch (key) {
      case 's':
        return 'save';
      case 'o':
        return 'open';
      case 'n':
        return 'new';
      case 'p':
        return 'print';
      case 'w':
      case 'F4':
        return 'close';
      case 'Tab':
        return 'nextDoc';
      case 'F1':
        return 'toggleRibbon';
      case 'z':
        return inEditable ? null : 'undo';
      case 'y':
        return inEditable ? null : 'redo';
      default:
        return null;
    }
  }
  if (ctrl && e.shiftKey && key === 'Tab') return 'prevDoc';
  if (plain && !e.shiftKey && key === 'F12') return 'saveAs';
  if (plain && !e.shiftKey && key === 'F10') return 'keytips';
  if (plain && key === 'F6') return e.shiftKey ? 'regionPrev' : 'regionNext';
  return null;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'range', 'color'].includes(target.type);
  return false;
}

type Region = 'ribbon' | 'workspace' | 'status';
const REGIONS: Region[] = ['ribbon', 'workspace', 'status'];

function regionOf(el: Element | null): Region | null {
  if (!el) return null;
  if (el.closest('.rb-ribbon, .vr-titlebar')) return 'ribbon';
  if (el.closest('.vr-status')) return 'status';
  if (el.closest('.vr-workspaces, .calc-fbar')) return 'workspace';
  return null;
}

export function focusRegion(region: Region): void {
  if (region === 'ribbon') {
    const tab = document.querySelector<HTMLElement>('.rb-tab--selected') ?? document.querySelector<HTMLElement>('.rb-filetab');
    tab?.focus();
    return;
  }
  if (region === 'status') {
    document.querySelector<HTMLElement>('.vr-status button:not(:disabled), .vr-status input:not(:disabled)')?.focus();
    return;
  }
  const doc = getActiveDocument();
  if (doc && isOfficeKind(doc.kind)) void focusView(doc.docId);
  else document.querySelector<HTMLElement>(`#workspace-${CSS.escape(doc?.docId ?? '')} [tabindex], #workspace-${CSS.escape(doc?.docId ?? '')}`)?.focus();
}

/** F6 / Shift+F6: ribbon → document → status bar. `from` = region that currently has focus. */
export function cycleRegion(direction: 1 | -1, from: Region | null = regionOf(document.activeElement)): void {
  const start = from ?? 'workspace';
  const next = REGIONS[(REGIONS.indexOf(start) + direction + REGIONS.length) % REGIONS.length]!;
  focusRegion(next);
}

export function showKeyTips(): void {
  startKeyTips('root');
  focusRegion('ribbon');
}

export function toggleKeyTips(): void {
  if (useKeyTips.getState().active) stopKeyTips();
  else showKeyTips();
}

export function runShortcut(action: ShortcutAction): void {
  switch (action) {
    case 'save':
      void runShellAction(SHELL_ACTIONS.save);
      break;
    case 'open':
      void runShellAction(SHELL_ACTIONS.open);
      break;
    case 'new':
      void runShellAction(SHELL_ACTIONS.newDocument);
      break;
    case 'print':
      void runShellAction(SHELL_ACTIONS.print);
      break;
    case 'close':
      void runShellAction(SHELL_ACTIONS.close);
      break;
    case 'saveAs':
      void runShellAction(SHELL_ACTIONS.saveAs);
      break;
    case 'nextDoc':
      cycleDocument(1);
      break;
    case 'prevDoc':
      cycleDocument(-1);
      break;
    case 'toggleRibbon':
      void runShellAction(SHELL_ACTIONS.toggleRibbon);
      break;
    case 'keytips':
      toggleKeyTips();
      break;
    case 'regionNext':
      cycleRegion(1);
      break;
    case 'regionPrev':
      cycleRegion(-1);
      break;
    case 'undo':
      void runShellAction(SHELL_ACTIONS.undo);
      break;
    case 'redo':
      void runShellAction(SHELL_ACTIONS.redo);
      break;
  }
}

/** Installs the window-level key handlers; returns the uninstaller. */
export function installGlobalKeyboard(target: Window = window): () => void {
  let altArmed = false;

  const onKeyDown = (e: KeyboardEvent) => {
    if (useApp.getState().prompts.length > 0) return;
    const keytips = useKeyTips.getState();
    if (keytips.active) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        keyTipBack();
        return;
      }
      if (e.key === 'Alt' || e.key === 'F10') {
        e.preventDefault();
        altArmed = false;
        stopKeyTips();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.key.length > 1) {
        // Navigation keys (Tab, arrows, Enter ...) leave KeyTip mode and keep their normal meaning.
        if (!['Shift', 'CapsLock'].includes(e.key)) stopKeyTips();
      } else if (keyTipInput(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    if (e.key === 'Alt') {
      altArmed = e.code === 'AltLeft' && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.repeat;
      return;
    }
    altArmed = false;
    const action = matchShortcut(e, isEditableTarget(e.target));
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    runShortcut(action);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== 'Alt') return;
    const armed = altArmed;
    altArmed = false;
    if (!armed || useApp.getState().prompts.length > 0) return;
    e.preventDefault();
    toggleKeyTips();
  };

  const onBlur = () => {
    altArmed = false;
    stopKeyTips();
  };

  // A mouse click ends KeyTip mode (Office behaviour).
  const onPointerDown = () => stopKeyTips();

  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('keyup', onKeyUp, true);
  target.addEventListener('blur', onBlur);
  target.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('keyup', onKeyUp, true);
    target.removeEventListener('blur', onBlur);
    target.removeEventListener('pointerdown', onPointerDown, true);
  };
}
