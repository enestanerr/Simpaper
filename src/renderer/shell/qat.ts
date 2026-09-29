/** Quick Access Toolbar commands (ids are stored in settings.ui.quickAccess). */
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconDeviceFloppy,
  IconFileExport,
  IconFilePlus,
  IconFileTypePdf,
  IconFolderOpen,
  IconPrinter,
  IconSearch,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react';
import type { IconComponent } from '../ribbon/types';
import { SHELL_ACTIONS } from '../ribbon/types';

export interface QatCommand {
  id: string;
  labelKey: string;
  icon: IconComponent;
  shortcut?: string;
}

export const QAT_COMMANDS: readonly QatCommand[] = [
  { id: SHELL_ACTIONS.save, labelKey: 'shell.qat.save', icon: IconDeviceFloppy, shortcut: 'Ctrl+S' },
  { id: SHELL_ACTIONS.undo, labelKey: 'shell.qat.undo', icon: IconArrowBackUp, shortcut: 'Ctrl+Z' },
  { id: SHELL_ACTIONS.redo, labelKey: 'shell.qat.redo', icon: IconArrowForwardUp, shortcut: 'Ctrl+Y' },
  { id: SHELL_ACTIONS.newDocument, labelKey: 'shell.qat.new', icon: IconFilePlus, shortcut: 'Ctrl+N' },
  { id: SHELL_ACTIONS.open, labelKey: 'shell.qat.open', icon: IconFolderOpen, shortcut: 'Ctrl+O' },
  { id: SHELL_ACTIONS.saveAs, labelKey: 'shell.qat.saveAs', icon: IconFileExport, shortcut: 'F12' },
  { id: SHELL_ACTIONS.print, labelKey: 'shell.qat.print', icon: IconPrinter, shortcut: 'Ctrl+P' },
  { id: SHELL_ACTIONS.exportPdf, labelKey: 'shell.qat.exportPdf', icon: IconFileTypePdf },
  { id: SHELL_ACTIONS.find, labelKey: 'shell.qat.find', icon: IconSearch, shortcut: 'Ctrl+H' },
  { id: SHELL_ACTIONS.zoomIn, labelKey: 'shell.qat.zoomIn', icon: IconZoomIn },
  { id: SHELL_ACTIONS.zoomOut, labelKey: 'shell.qat.zoomOut', icon: IconZoomOut },
  { id: SHELL_ACTIONS.close, labelKey: 'shell.qat.close', icon: IconX, shortcut: 'Ctrl+W' },
];

export function qatCommand(id: string): QatCommand | undefined {
  return QAT_COMMANDS.find((c) => c.id === id);
}

/** Known ids only, without duplicates, in the stored order. */
export function normalizeQat(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) if (qatCommand(id) && !out.includes(id)) out.push(id);
  return out;
}

export function toggleQatItem(ids: readonly string[], id: string): string[] {
  const list = normalizeQat(ids);
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function moveQatItem(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const list = normalizeQat(ids);
  const i = list.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return list;
}
