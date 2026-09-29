/** CSV/text import options with a live preview (separator and number/date locale). */
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTable } from '@tabler/icons-react';
import type { Prompt, PromptAnswer } from '@shared/api/documents';
import { CSV_LCID } from '@shared/formats';
import { Dialog } from '../../ui/Dialog';

const SEPARATORS: { value: string; key: string }[] = [
  { value: ';', key: 'shell.options.sepSemicolon' },
  { value: ',', key: 'shell.options.sepComma' },
  { value: '\t', key: 'shell.options.sepTab' },
  { value: ' ', key: 'shell.prompts.csv.space' },
  { value: '|', key: 'shell.prompts.csv.pipe' },
];

const MAX_ROWS = 12;
const MAX_COLS = 10;

/** Splits one CSV line; quoted fields may contain the separator and doubled quotes. */
export function splitCsvLine(line: string, separator: string, quote = '"'): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === quote) {
        if (line[i + 1] === quote) {
          cur += quote;
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === quote && cur === '') quoted = true;
    else if (line.startsWith(separator, i)) {
      out.push(cur);
      cur = '';
      i += separator.length - 1;
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function CsvImportDialog({ prompt, onAnswer }: { prompt: Extract<Prompt, { kind: 'csvImport' }>; onAnswer: (a: PromptAnswer) => void }) {
  const { t, i18n } = useTranslation();
  const known = SEPARATORS.some((s) => s.value === prompt.defaultSeparator);
  const [choice, setChoice] = useState(known ? prompt.defaultSeparator : 'other');
  const [other, setOther] = useState(known ? '' : prompt.defaultSeparator);
  const [locale, setLocale] = useState(i18n.language === 'tr' ? 'tr-TR' : 'en-US');
  const otherId = useId();
  const localeId = useId();
  const separator = choice === 'other' ? other : choice;

  const rows = useMemo(
    () => (separator ? prompt.preview.slice(0, MAX_ROWS).map((l) => splitCsvLine(l, separator).slice(0, MAX_COLS)) : []),
    [prompt.preview, separator],
  );
  const columns = rows.reduce((n, r) => Math.max(n, r.length), 0);

  return (
    <Dialog
      title={t('shell.prompts.csv.title')}
      icon={<IconTable size={22} stroke={1.75} />}
      onCancel={() => onAnswer({ kind: 'csvImport', separator: null, locale })}
      size="large"
      footer={
        <>
          <button type="button" className="vr-btn" onClick={() => onAnswer({ kind: 'csvImport', separator: null, locale })}>
            {t('common.actions.cancel')}
          </button>
          <button type="button" className="vr-btn vr-btn--primary" disabled={!separator} onClick={() => onAnswer({ kind: 'csvImport', separator, locale })}>
            {t('shell.prompts.csv.import')}
          </button>
        </>
      }
    >
      <p>{t('shell.prompts.csv.body', { fileName: prompt.fileName })}</p>
      <fieldset className="vr-radios vr-radios--inline">
        <legend>{t('shell.prompts.csv.separator')}</legend>
        {SEPARATORS.map((s, i) => (
          <label key={s.value} className="vr-checkbox">
            <input type="radio" name="vr-csv-sep" checked={choice === s.value} data-autofocus={i === 0 && choice === s.value ? '' : undefined} onChange={() => setChoice(s.value)} />
            <span>{t(s.key)}</span>
          </label>
        ))}
        <label className="vr-checkbox">
          <input type="radio" name="vr-csv-sep" checked={choice === 'other'} onChange={() => setChoice('other')} />
          <span>{t('shell.prompts.csv.other')}</span>
        </label>
        <input
          id={otherId}
          className="vr-input vr-input--tiny"
          maxLength={1}
          aria-label={t('shell.prompts.csv.otherChar')}
          value={other}
          disabled={choice !== 'other'}
          onChange={(e) => setOther(e.target.value.replace(/["'\r\n]/g, ''))}
        />
      </fieldset>
      <div className="vr-field">
        <label htmlFor={localeId}>{t('shell.prompts.csv.locale')}</label>
        <select id={localeId} className="vr-select" value={locale} onChange={(e) => setLocale(e.target.value)}>
          {Object.keys(CSV_LCID).map((l) => (
            <option key={l} value={l}>
              {t(`shell.prompts.csv.locale_${l.replace('-', '_')}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="vr-csv-preview" role="region" aria-label={t('shell.prompts.csv.preview')} tabIndex={0}>
        <table>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {Array.from({ length: columns }, (_, c) => (
                  <td key={c}>{r[c] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
