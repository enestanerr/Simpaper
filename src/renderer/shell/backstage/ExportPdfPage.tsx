/** Export to PDF with options (documents:exportPdf). */
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFileExport } from '@tabler/icons-react';
import type { DocumentDescriptor, PdfExportOptions } from '@shared/api/documents';
import { exportPdf } from '../../services/documents';
import { closeBackstage } from '../../state/appStore';

type BoolOption = keyof Omit<PdfExportOptions, 'path'>;

const OPTIONS: { key: BoolOption; labelKey: string; hintKey: string }[] = [
  { key: 'openAfter', labelKey: 'shell.exportPdf.openAfter', hintKey: 'shell.exportPdf.openAfterHint' },
  { key: 'taggedPdf', labelKey: 'shell.exportPdf.tagged', hintKey: 'shell.exportPdf.taggedHint' },
  { key: 'bookmarks', labelKey: 'shell.exportPdf.bookmarks', hintKey: 'shell.exportPdf.bookmarksHint' },
  { key: 'pdfA', labelKey: 'shell.exportPdf.pdfA', hintKey: 'shell.exportPdf.pdfAHint' },
  { key: 'hybrid', labelKey: 'shell.exportPdf.hybrid', hintKey: 'shell.exportPdf.hybridHint' },
];

/** Checkbox with a hint that describes it (announced as description, not as part of the name). */
export function CheckOption({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const hintId = useId();
  return (
    <div className="vr-option">
      <label className="vr-checkbox">
        <input type="checkbox" checked={checked} aria-describedby={hintId} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      <span id={hintId} className="vr-option__hint">
        {hint}
      </span>
    </div>
  );
}

export function ExportPdfPage({ doc }: { doc: DocumentDescriptor | null }) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<PdfExportOptions>({ openAfter: false, taggedPdf: true, bookmarks: true, pdfA: false, hybrid: false });
  if (!doc) return null;
  return (
    <div className="vr-bs-content">
      <h1 className="vr-bs-title">{t('shell.backstage.exportPdf')}</h1>
      <p className="vr-muted">{t('shell.exportPdf.intro')}</p>
      <fieldset className="vr-options">
        <legend className="vr-bs-subtitle">{t('shell.exportPdf.options')}</legend>
        {OPTIONS.map((o) => (
          <CheckOption
            key={o.key}
            label={t(o.labelKey)}
            hint={t(o.hintKey)}
            checked={options[o.key] === true}
            onChange={(checked) => setOptions((prev) => ({ ...prev, [o.key]: checked }))}
          />
        ))}
      </fieldset>
      <button
        type="button"
        className="vr-btn vr-btn--primary vr-btn--big"
        onClick={() => {
          closeBackstage();
          void exportPdf(doc.docId, options);
        }}
      >
        <IconFileExport size={18} stroke={1.75} aria-hidden="true" />
        {t('shell.exportPdf.button')}
      </button>
    </div>
  );
}
