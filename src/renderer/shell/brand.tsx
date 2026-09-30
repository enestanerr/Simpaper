/** Brand artwork (resources/brand, original Simpaper marks) as bundled image URLs. */
import type { ModuleKind } from '@shared/modules';
import calcIcon from '../../../resources/brand/calc.svg';
import impressIcon from '../../../resources/brand/impress.svg';
import logo from '../../../resources/brand/logo.svg';
import logoSmall from '../../../resources/brand/logo-small.svg';
import pdfIcon from '../../../resources/brand/pdf.svg';
import writerIcon from '../../../resources/brand/writer.svg';

export const LOGO_URL: string = logo;
export const LOGO_SMALL_URL: string = logoSmall;

export const MODULE_ICON_URL: Record<ModuleKind, string> = {
  writer: writerIcon,
  calc: calcIcon,
  impress: impressIcon,
  pdf: pdfIcon,
};

/** i18n keys of the module names. */
export const MODULE_NAME_KEY: Record<ModuleKind, string> = {
  writer: 'common.module.writer',
  calc: 'common.module.calc',
  impress: 'common.module.impress',
  pdf: 'common.module.pdf',
};

export function ModuleIcon({ kind, size = 16 }: { kind: ModuleKind; size?: number }) {
  return <img className="vr-module-icon" src={MODULE_ICON_URL[kind]} width={size} height={size} alt="" draggable={false} />;
}
