/** Presentations module (LibreOffice Impress engine). */
import { IconLayoutGrid, IconNotes, IconPresentation, IconPlayerPlay } from '@tabler/icons-react';
import { uno } from '../common/controls';
import { useOfficeZoom } from '../common/hooks';
import { OfficeWorkspace } from '../common/OfficeWorkspace';
import type { ModuleDefinition } from '../types';
import { impressRibbon } from './ribbon';
import { ImpressStatusBar } from './StatusBar';

export const impressModule: ModuleDefinition = {
  kind: 'impress',
  ribbon: impressRibbon,
  Workspace: OfficeWorkspace,
  StatusBar: ImpressStatusBar,
  useZoom: useOfficeZoom,
  statusViews: [
    { id: 'status.normal', labelKey: 'impress.cmd.normalView', icon: IconPresentation, action: uno('.uno:NormalMultiPaneGUI'), state: { command: '.uno:NormalMultiPaneGUI' } },
    { id: 'status.sorter', labelKey: 'impress.cmd.sorterView', icon: IconLayoutGrid, action: uno('.uno:DiaMode'), state: { command: '.uno:DiaMode' } },
    { id: 'status.notes', labelKey: 'impress.cmd.notesView', icon: IconNotes, action: uno('.uno:NotesMode'), state: { command: '.uno:NotesMode' } },
    { id: 'status.slideShow', labelKey: 'impress.cmd.fromCurrent', icon: IconPlayerPlay, action: uno('.uno:PresentationCurrentSlide') },
  ],
};
