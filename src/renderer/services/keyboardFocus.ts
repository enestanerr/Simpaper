/**
 * Keyboard focus between Simpaper's own controls and LibreOffice's window (child hosting, docs/dev/platform.md §6).
 *
 * Windows leaves the keyboard focus in LibreOffice's window when the user clicks Simpaper's web content, so keys
 * meant for a text box of the ribbon, the File backstage or a prompt would reach the document. The shell claims
 * the keyboard (`view:focusShell`) when a press on its own UI moves the focus into a text box, or into anything
 * outside the parts that leave the keyboard in the document as Office does (ribbon, title bar, tab strip, status
 * bar); while modal UI (dialogs, the backstage) or a popup that takes the focus (menus, galleries, collapsed ribbon
 * groups) is open; and when a PDF becomes the active document. The document gets it back when the last of them
 * closes; ribbon commands hand it back themselves (dispatchUno with `focus`). Programmatic focus changes alone never
 * claim it: that would take the keyboard while the user types.
 */
import { isOfficeKind } from '@shared/modules';
import { getActiveDocument } from '../state/appStore';
import { focusView } from './engine';
import { hasBridge, invoke } from './ipc';

/** A focus change this long after a press on Simpaper's UI belongs to that press. */
const PRESS_WINDOW_MS = 1000;
/**
 * Parts of the window that leave the keyboard in the document, as in Office (switching ribbon tabs, using a
 * button, the tab strip, the zoom slider). Their text boxes still take it; popups hold it while open (Popup.tsx).
 */
const PASSIVE = '.rb-ribbon, .vr-titlebar, .vr-doctabs, .vr-status, .vr-popup';

let lastPress = Number.NEGATIVE_INFINITY;
let holds = 0;
/** A modal hold took the keyboard from the document: give it back when the last hold ends. */
let takenForHolds = false;
/** A hold that returns to the document in any case (the backstage, as in Office) is or was open. */
let returnAlways = false;

function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range', 'color', 'submit', 'reset', 'file'].includes(el.type);
}

/** Asks for the keyboard (view:focusShell); resolves true when it was taken from LibreOffice's window. */
export function claimKeyboard(): Promise<boolean> {
  if (!hasBridge()) return Promise.resolve(false);
  return invoke('view:focusShell', undefined).then(
    (taken) => taken === true,
    () => false,
  );
}
const claim = claimKeyboard;

function giveBackToDocument(): void {
  const doc = getActiveDocument();
  if (doc && isOfficeKind(doc.kind) && doc.state === 'ready') void focusView(doc.docId);
}

/**
 * For modal UI: claims the keyboard now; the returned release gives it back to the active document when the last
 * hold ends and a hold took it from there. `returnToDocument: 'always'` (the backstage) gives it back in any case,
 * as Office does when the File view closes.
 */
export function holdKeyboard(returnToDocument: 'ifTaken' | 'always' = 'ifTaken'): () => void {
  holds += 1;
  if (returnToDocument === 'always') returnAlways = true;
  void claim().then((taken) => {
    if (!taken) return;
    if (holds > 0) takenForHolds = true;
    else giveBackToDocument();
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds > 0) return;
    const giveBack = takenForHolds || returnAlways;
    takenForHolds = false;
    returnAlways = false;
    if (giveBack) giveBackToDocument();
  };
}

/** Claims the keyboard when a control takes the focus right after the user pressed on Simpaper's UI. */
export function installKeyboardClaims(target: Window = window): () => void {
  const onPress = () => {
    lastPress = Date.now();
  };
  const onFocusIn = (e: FocusEvent) => {
    const el = e.target;
    if (!(el instanceof Element) || Date.now() - lastPress > PRESS_WINDOW_MS) return;
    if (isTextEntry(el) || !el.closest(PASSIVE)) void claim();
  };
  target.addEventListener('pointerdown', onPress, true);
  target.document.addEventListener('focusin', onFocusIn, true);
  return () => {
    target.removeEventListener('pointerdown', onPress, true);
    target.document.removeEventListener('focusin', onFocusIn, true);
  };
}

/** Tests only. */
export function resetKeyboardClaims(): void {
  lastPress = Number.NEGATIVE_INFINITY;
  holds = 0;
  takenForHolds = false;
  returnAlways = false;
}
