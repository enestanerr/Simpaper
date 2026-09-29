/** Documents module (LibreOffice Writer engine). */
import { IconFile, IconWorldWww } from '@tabler/icons-react';
import { uno } from '../common/controls';
import { useOfficeZoom } from '../common/hooks';
import { OfficeWorkspace } from '../common/OfficeWorkspace';
import type { ModuleDefinition } from '../types';
import { writerRibbon } from './ribbon';
import { WriterStatusBar } from './StatusBar';

export const writerModule: ModuleDefinition = {
  kind: 'writer',
  ribbon: writerRibbon,
  Workspace: OfficeWorkspace,
  StatusBar: WriterStatusBar,
  useZoom: useOfficeZoom,
  statusViews: [
    { id: 'status.printLayout', labelKey: 'writer.cmd.printLayout', icon: IconFile, action: uno('.uno:PrintLayout'), state: { command: '.uno:PrintLayout' } },
    { id: 'status.webLayout', labelKey: 'writer.cmd.webLayout', icon: IconWorldWww, action: uno('.uno:BrowseView'), state: { command: '.uno:BrowseView' } },
  ],
};
