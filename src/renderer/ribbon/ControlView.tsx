/** Renders any ribbon control by type. */
import { ButtonView } from './controls/ButtonView';
import { ColorView } from './controls/ColorView';
import { ComboView } from './controls/ComboView';
import { MenuButtonView, SplitView } from './controls/DropdownViews';
import { GalleryView } from './controls/GalleryView';
import type { ControlViewProps } from './controls/shared';
import { useKeyTip } from './keytipStore';
import { useActiveDocument } from './runtime';
import type { CustomControl } from './types';
import { KeyTipBadge } from './controls/shared';

export function ControlView(props: ControlViewProps) {
  const { control } = props;
  switch (control.type) {
    case 'button':
    case 'toggle':
      return <ButtonView {...props} control={control} />;
    case 'split':
      return <SplitView {...props} control={control} />;
    case 'menu':
      return <MenuButtonView {...props} control={control} />;
    case 'combo':
      return <ComboView {...props} control={control} />;
    case 'color':
      return <ColorView {...props} control={control} />;
    case 'gallery':
      return <GalleryView {...props} control={control} />;
    case 'custom':
      return <CustomView {...props} control={control} />;
  }
}

function CustomView({ control, scope }: ControlViewProps<CustomControl>) {
  const doc = useActiveDocument();
  const Render = control.render;
  // Custom controls receive keyboard focus through their first [data-rb-item] element.
  const badge = useKeyTip(scope, control.id, control.keytip, () => {
    document.querySelector<HTMLElement>(`[data-control-id="${CSS.escape(control.id)}"] [data-rb-item]`)?.click();
    return null;
  });
  return (
    <span className="rb-slot rb-custom" data-control-id={control.id}>
      <Render docId={doc?.docId ?? null} />
      <KeyTipBadge text={badge} />
    </span>
  );
}
