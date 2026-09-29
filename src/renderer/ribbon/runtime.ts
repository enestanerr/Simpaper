/** Runtime glue between ribbon controls and the active document: state, enablement, execution. */
import type { DocumentDescriptor } from '@shared/api/documents';
import type { UnoPlain } from '@shared/engine-protocol';
import { isOfficeKind } from '@shared/modules';
import { selectActiveDocument, useApp } from '../state/appStore';
import { useCommands } from '../state/commandStore';
import { dispatchUno } from '../services/engine';
import { isShellActionEnabled, runShellAction, shellActionGate } from '../services/shellActions';
import { unoPressed } from '../services/unoValues';
import type { RibbonAction, RibbonStateBinding } from './types';

export interface ControlRuntime {
  enabled: boolean;
  pressed: boolean;
  value: UnoPlain | undefined;
}

export function useActiveDocument(): DocumentDescriptor | null {
  return useApp(selectActiveDocument);
}

/** True while LibreOffice shows a modal dialog for the document: its commands cannot run then. */
export function useDocBlocked(docId: string | null): boolean {
  return useApp((s) => (docId ? s.busy[docId]?.busy === true && s.busy[docId]?.reason === 'dialog' : false));
}

function gateCommand(action: RibbonAction | undefined, binding: RibbonStateBinding | undefined): string | undefined {
  if (binding) return binding.command;
  if (action?.type === 'uno') return action.command;
  if (action?.type === 'shell') return shellActionGate(action.id);
  return undefined;
}

/** State of a control: enabled (document ready, command enabled), pressed (toggle) and raw value. */
export function useControlRuntime(action: RibbonAction | undefined, binding?: RibbonStateBinding): ControlRuntime {
  const doc = useActiveDocument();
  const docId = doc?.docId ?? null;
  const blocked = useDocBlocked(docId);
  const command = gateCommand(action, binding);
  const entry = useCommands((s) => (docId && command ? s.states[docId]?.[command] : undefined));
  // Re-evaluate shell actions when any state of the document changes (their gates live in the command store).
  useCommands((s) => (docId && action?.type === 'shell' ? s.revision[docId] : 0));

  let enabled: boolean;
  if (!doc || blocked) enabled = false;
  // Shell/module actions: the action's own availability, and — for controls bound to a state entry that a
  // module publishes (e.g. the PDF module's `pdf:*` entries) — that entry's enabled flag.
  else if (action?.type === 'shell') enabled = isShellActionEnabled(action.id, doc) && (binding && entry ? entry.enabled : true);
  else if (!isOfficeKind(doc.kind) || doc.state !== 'ready') enabled = false;
  else enabled = entry ? entry.enabled : true;

  const value = entry?.value;
  const pressed = binding?.pressed ? binding.pressed(value ?? null) : unoPressed(value);
  return { enabled, pressed: entry ? pressed : false, value };
}

/** Executes a ribbon action for the active document. */
export function runRibbonAction(action: RibbonAction, opts: { focusDocument?: boolean } = {}): void {
  const doc = selectActiveDocument(useApp.getState());
  if (action.type === 'shell') {
    void runShellAction(action.id, action.payload, doc);
    return;
  }
  if (!doc) return;
  void dispatchUno(doc.docId, action.command, action.args, { focus: opts.focusDocument !== false });
}
