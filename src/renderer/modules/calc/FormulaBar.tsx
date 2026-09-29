/**
 * Calc formula bar: Name Box (calc.gotoCell), fx (function wizard), and the input line showing the
 * active cell's localised formula (calc.activeCell) — Enter writes it with calc.setActiveCellContent.
 * Refreshed on selection events when the main process forwards them, on command-state changes, and
 * by polling while no selection events are available.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconMathFunction, IconX } from '@tabler/icons-react';
import type { DocumentDescriptor } from '@shared/api/documents';
import type { CellInfo } from '@shared/engine-protocol';
import { dispatchUno, focusView, queryEngine } from '../../services/engine';
import { pushMessage, useApp } from '../../state/appStore';
import { useCommands } from '../../state/commandStore';
import { onSelectionChange, selectionEventsAvailable } from '../../services/selection';

const POLL_MS = 400;

/** Text shown in the input line for a cell. */
export function cellInputText(cell: CellInfo | null): string {
  if (!cell) return '';
  if (cell.localFormula) return cell.localFormula;
  if (cell.value === null || cell.type === 'empty') return '';
  return cell.display || String(cell.value);
}

export function CalcFormulaBar({ doc }: { doc: DocumentDescriptor }) {
  const { t } = useTranslation();
  const visible = useApp((s) => s.formulaBarVisible);
  const active = useApp((s) => s.activeDocId === doc.docId);
  const ready = doc.state === 'ready';
  const [cell, setCell] = useState<CellInfo | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const editingRef = useRef(false);
  useLayoutEffect(() => {
    editingRef.current = text !== null || name !== null;
  });
  const revision = useCommands((s) => s.revision[doc.docId] ?? 0);

  const refresh = useCallback(() => {
    if (!ready) return;
    queryEngine(doc.docId, 'calc.activeCell')
      .then((c) => {
        if (!editingRef.current) setCell(c);
        else setCell((prev) => prev ?? c);
      })
      .catch(() => undefined);
  }, [doc.docId, ready]);

  useEffect(() => {
    if (!active || !visible) return;
    const timer = setTimeout(refresh, 60);
    return () => clearTimeout(timer);
  }, [active, visible, refresh, revision]);

  useEffect(() => (active ? onSelectionChange(doc.docId, refresh) : undefined), [active, doc.docId, refresh]);

  useEffect(() => {
    if (!active || !visible || !ready) return;
    const id = setInterval(() => {
      // The native view is a separate window, so document.hasFocus() is false while the user works in it.
      if (selectionEventsAvailable() || editingRef.current || document.visibilityState !== 'visible') return;
      refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [active, visible, ready, refresh]);

  if (!visible) return null;

  const commitName = async () => {
    const reference = (name ?? '').trim();
    setName(null);
    if (!reference) return;
    try {
      await queryEngine(doc.docId, 'calc.gotoCell', { reference });
      refresh();
      void focusView(doc.docId);
    } catch {
      pushMessage({ kind: 'warning', docId: doc.docId, key: 'calc.messages.invalidReference', values: { reference }, timeoutMs: 5000 });
    }
  };

  const commitContent = async () => {
    const content = text;
    setText(null);
    if (content === null) return;
    try {
      await queryEngine(doc.docId, 'calc.setActiveCellContent', { content });
      refresh();
      void focusView(doc.docId);
    } catch {
      pushMessage({ kind: 'error', docId: doc.docId, key: 'calc.messages.setContentFailed', timeoutMs: 6000 });
    }
  };

  const cancelContent = () => {
    setText(null);
    void focusView(doc.docId);
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitContent();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelContent();
    }
  };

  const disabled = !ready;
  const editing = text !== null;
  return (
    <div className="calc-fbar" role="group" aria-label={t('calc.formulaBar.label')}>
      <input
        className="calc-fbar__name"
        data-calc-namebox=""
        aria-label={t('calc.formulaBar.nameBox')}
        title={t('calc.formulaBar.nameBoxTip')}
        spellCheck={false}
        disabled={disabled}
        value={name ?? cell?.address ?? ''}
        onFocus={(e) => {
          setName(cell?.address ?? '');
          e.currentTarget.select();
        }}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setName(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commitName();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setName(null);
            void focusView(doc.docId);
          }
        }}
      />
      <div className="calc-fbar__buttons">
        {editing && (
          <>
            <button type="button" className="calc-fbar__btn" aria-label={t('calc.formulaBar.cancel')} title={t('calc.formulaBar.cancel')} onPointerDown={(e) => e.preventDefault()} onClick={cancelContent}>
              <IconX size={15} stroke={2} aria-hidden="true" />
            </button>
            <button type="button" className="calc-fbar__btn" aria-label={t('calc.formulaBar.enter')} title={t('calc.formulaBar.enter')} onPointerDown={(e) => e.preventDefault()} onClick={() => void commitContent()}>
              <IconCheck size={15} stroke={2} aria-hidden="true" />
            </button>
          </>
        )}
        <button
          type="button"
          className="calc-fbar__btn"
          aria-label={t('calc.formulaBar.insertFunction')}
          title={`${t('calc.formulaBar.insertFunction')} (Ctrl+F2)`}
          disabled={disabled}
          onClick={() => void dispatchUno(doc.docId, '.uno:FunctionDialog')}
        >
          <IconMathFunction size={16} stroke={1.75} aria-hidden="true" />
        </button>
      </div>
      <input
        className="calc-fbar__input"
        aria-label={t('calc.formulaBar.input')}
        spellCheck={false}
        disabled={disabled}
        value={text ?? cellInputText(cell)}
        onFocus={() => setText(cellInputText(cell))}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          // Leaving the input without Enter keeps the cell unchanged (like pressing Esc in Office).
          setText(null);
        }}
        onKeyDown={onInputKey}
      />
    </div>
  );
}
