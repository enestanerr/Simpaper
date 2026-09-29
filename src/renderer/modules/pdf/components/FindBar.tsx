/** Find bar (Ctrl+F): Turkish-insensitive search through pdf.js' find controller. */
import { IconChevronDown, IconChevronUp, IconX } from '@tabler/icons-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { controllerFor } from '../controller/registry';
import { patchDoc, usePdfDoc } from '../state/store';

/** pdf.js FindState values. */
const NOT_FOUND = 1;
const WRAPPED = 2;
const PENDING = 3;

export function FindBar({ docId, focusToken }: { docId: string; focusToken: number }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [entireWord, setEntireWord] = useState(false);
  const [highlightAll, setHighlightAll] = useState(true);
  const status = usePdfDoc(docId, (s) => s.find);
  const inputId = useId();
  const statusId = useId();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const opts = { caseSensitive, entireWord, highlightAll };
  const run = (type: '' | 'again' | 'highlightallchange' | 'casesensitivitychange' | 'entirewordchange', previous = false, override: Partial<typeof opts> = {}) => {
    if (!query) return;
    controllerFor(docId)?.find(query, { ...opts, ...override }, type, previous);
  };

  const close = () => {
    controllerFor(docId)?.closeFind();
    controllerFor(docId)?.focusDocument();
  };

  let message = '';
  if (query && status) {
    if (status.state === NOT_FOUND) message = t('pdf.find.notFound');
    else if (status.state === PENDING) message = t('pdf.find.searching');
    else if (status.total > 0) message = t('pdf.find.count', { current: status.current, total: status.total });
    if (status.state === WRAPPED) message = `${message} · ${t('pdf.find.wrapped')}`;
  }

  return (
    <div className="vpdf-find" role="search" aria-label={t('pdf.find.region')}>
      <label htmlFor={inputId} className="vr-visually-hidden">
        {t('pdf.find.label')}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className="vr-input vpdf-find__input"
        type="search"
        placeholder={t('pdf.find.placeholder')}
        aria-describedby={statusId}
        aria-invalid={status?.state === NOT_FOUND && query !== '' ? true : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value) controllerFor(docId)?.find(e.target.value, opts, '');
          else patchDoc(docId, { find: null });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            run('again', e.shiftKey);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      />
      <button type="button" className="vr-btn vr-btn--ghost vpdf-iconbtn" aria-label={t('pdf.find.previous')} title={`${t('pdf.find.previous')} (Shift+F3)`} disabled={!query} onClick={() => run('again', true)}>
        <IconChevronUp size={16} aria-hidden="true" />
      </button>
      <button type="button" className="vr-btn vr-btn--ghost vpdf-iconbtn" aria-label={t('pdf.find.next')} title={`${t('pdf.find.next')} (F3)`} disabled={!query} onClick={() => run('again')}>
        <IconChevronDown size={16} aria-hidden="true" />
      </button>
      <span id={statusId} className="vpdf-find__status" role="status" aria-live="polite">
        {message}
      </span>
      <label className="vr-checkbox">
        <input
          type="checkbox"
          checked={highlightAll}
          onChange={(e) => {
            setHighlightAll(e.target.checked);
            run('highlightallchange', false, { highlightAll: e.target.checked });
          }}
        />
        {t('pdf.find.highlightAll')}
      </label>
      <label className="vr-checkbox">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(e) => {
            setCaseSensitive(e.target.checked);
            run('casesensitivitychange', false, { caseSensitive: e.target.checked });
          }}
        />
        {t('pdf.find.matchCase')}
      </label>
      <label className="vr-checkbox">
        <input
          type="checkbox"
          checked={entireWord}
          onChange={(e) => {
            setEntireWord(e.target.checked);
            run('entirewordchange', false, { entireWord: e.target.checked });
          }}
        />
        {t('pdf.find.wholeWords')}
      </label>
      <button type="button" className="vr-btn vr-btn--ghost vpdf-iconbtn vpdf-find__close" aria-label={t('pdf.find.close')} title={t('pdf.find.close')} onClick={close}>
        <IconX size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
