/**
 * Calc workspace. Varak shows its own formula bar, so LibreOffice's input line is switched off once per
 * engine instance (only if the engine reports it visible — `.uno:InputLineVisible` is a toggle). A crash
 * restore or an engine restart loads the document into a fresh engine whose input line is visible again.
 */
import { useEffect, useRef } from 'react';
import { dispatchUno, ensureSubscribed } from '../../services/engine';
import { unoPressed } from '../../services/unoValues';
import { useCommandState } from '../../state/commandStore';
import { OfficeWorkspace } from '../common/OfficeWorkspace';
import type { WorkspaceProps } from '../types';

export function CalcWorkspace(props: WorkspaceProps) {
  const { doc } = props;
  const inputLine = useCommandState(doc.docId, '.uno:InputLineVisible');
  const handled = useRef(false);

  useEffect(() => {
    if (doc.state === 'ready') ensureSubscribed(doc.docId, ['.uno:InputLineVisible']);
  }, [doc.docId, doc.state]);

  useEffect(() => {
    if (doc.state === 'crashed' || doc.state === 'loading') {
      // A crash restore or an engine restart ('crashed' → 'loading' → 'ready') loads the document into a new
      // engine. The shell drops the old engine's command states on a crash, so the value read below on the
      // next `ready` is the new engine's. (`busy` → `ready`, a hang that resolved, keeps the same engine.)
      handled.current = false;
      return;
    }
    if (handled.current || !inputLine || doc.state !== 'ready') return;
    handled.current = true;
    if (inputLine.enabled && unoPressed(inputLine.value)) void dispatchUno(doc.docId, '.uno:InputLineVisible', undefined, { focus: false });
  }, [inputLine, doc.docId, doc.state]);

  return <OfficeWorkspace {...props} />;
}
