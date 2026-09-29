/** Spreadsheets module (LibreOffice Calc engine). */
import { IconPageBreak, IconTable } from '@tabler/icons-react';
import { uno } from '../common/controls';
import { useOfficeZoom } from '../common/hooks';
import type { ModuleDefinition } from '../types';
import { CalcWorkspace } from './CalcWorkspace';
import { CalcFormulaBar } from './FormulaBar';
import { toggleFormulaBar } from './FormulaBarToggle';
import { calcRibbon } from './ribbon';
import { CalcStatusBar } from './StatusBar';

export const calcModule: ModuleDefinition = {
  kind: 'calc',
  ribbon: calcRibbon,
  Workspace: CalcWorkspace,
  StatusBar: CalcStatusBar,
  Toolstrip: CalcFormulaBar,
  useZoom: useOfficeZoom,
  statusViews: [
    { id: 'status.normal', labelKey: 'calc.cmd.normalView', icon: IconTable, action: uno('.uno:NormalViewMode'), state: { command: '.uno:NormalViewMode' } },
    { id: 'status.pageBreak', labelKey: 'calc.cmd.pageBreakView', icon: IconPageBreak, action: uno('.uno:PagebreakMode'), state: { command: '.uno:PagebreakMode' } },
  ],
  actions: {
    'calc.focusNameBox': () => {
      document.querySelector<HTMLInputElement>('[data-calc-namebox]')?.focus();
    },
    'calc.toggleFormulaBar': () => toggleFormulaBar(),
  },
};
