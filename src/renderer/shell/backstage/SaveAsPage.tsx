/** Save As: pick a format of the document's kind (formats that the engine can write), then the native dialog opens. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconDeviceFloppy } from '@tabler/icons-react';
import type { DocumentDescriptor } from '@shared/api/documents';
import { DEFAULT_SAVE_FORMAT, formatsForKind, getFormat, type FormatId, type FormatInfo } from '@shared/formats';
import { isOfficeKind } from '@shared/modules';
import { translateExternal } from '../../i18n';
import { saveDocument } from '../../services/documents';
import { runShellAction } from '../../services/shellActions';
import { closeBackstage } from '../../state/appStore';

/** Formats a document of this kind can be saved to, primary formats first. */
export function writableFormats(doc: DocumentDescriptor): FormatInfo[] {
  const list = formatsForKind(doc.kind).filter((f) => f.support === 'native' || f.support === 'pdf');
  return [...list.filter((f) => f.tier === 'primary'), ...list.filter((f) => f.tier !== 'primary')];
}

export function defaultSaveAsFormat(doc: DocumentDescriptor): FormatId {
  if (doc.format) {
    const f = getFormat(doc.format);
    if (f.support === 'native' || f.support === 'pdf') return f.id;
    if (f.saveFallback) return f.saveFallback;
  }
  return DEFAULT_SAVE_FORMAT[doc.kind];
}

export function SaveAsPage({ doc }: { doc: DocumentDescriptor | null }) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<FormatId | null>(null);
  if (!doc) return null;
  const formats = writableFormats(doc);
  const selected = format ?? defaultSaveAsFormat(doc);
  const info = getFormat(selected);

  const save = () => {
    closeBackstage();
    if (isOfficeKind(doc.kind)) void saveDocument(doc.docId, { saveAs: true, format: selected });
    else void runShellAction('file.saveAs', { format: selected }, doc);
  };

  return (
    <div className="vr-bs-content">
      <h1 className="vr-bs-title">{t('shell.backstage.saveAs')}</h1>
      <fieldset className="vr-formats">
        <legend className="vr-bs-subtitle">{t('shell.saveAs.format')}</legend>
        {formats.map((f) => (
          <label key={f.id} className={`vr-format${f.id === selected ? ' vr-format--selected' : ''}`}>
            <input type="radio" name="vr-save-format" value={f.id} checked={f.id === selected} onChange={() => setFormat(f.id)} />
            <span className="vr-format__label">{t(f.labelKey)}</span>
            <span className="vr-format__ext">.{f.extensions[0]}</span>
            {f.tier === 'primary' && <span className="vr-chip">{t('shell.saveAs.recommended')}</span>}
            {f.macroEnabled && <span className="vr-chip vr-chip--muted">{t('shell.saveAs.macroEnabled')}</span>}
          </label>
        ))}
      </fieldset>
      {info.knownLosses && info.knownLosses.length > 0 && (
        <div className="vr-banner vr-banner--warning" role="note">
          <IconAlertTriangle size={18} stroke={1.75} aria-hidden="true" />
          <div>
            <div>{t('shell.saveAs.lossIntro')}</div>
            <ul className="vr-bullets">
              {info.knownLosses.map((k) => (
                <li key={k}>{translateExternal(k, undefined, 'shell.compat.unknownLoss')}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <button type="button" className="vr-btn vr-btn--primary vr-btn--big" onClick={save}>
        <IconDeviceFloppy size={18} stroke={1.75} aria-hidden="true" />
        {t('shell.saveAs.button')}
      </button>
      <p className="vr-muted">{t('shell.saveAs.hint')}</p>
    </div>
  );
}
