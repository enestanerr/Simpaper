/** Hooks shared by the office modules: document info, zoom, command state values. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentDescriptor } from '@shared/api/documents';
import type { DocInfo, UnoPlain } from '@shared/engine-protocol';
import { dispatchUno, ensureSubscribed, queryEngine } from '../../services/engine';
import { setOfficeZoom, stepZoom, ZOOM_MAX, ZOOM_MIN } from '../../services/zoom';
import { zoomFromState } from '../../services/unoValues';
import { useCommands } from '../../state/commandStore';
import type { ZoomState } from '../types';

const INFO_DEBOUNCE_MS = 250;
const INFO_POLL_MS = 4000;

/**
 * `doc.info` of a document, refreshed when any command state of the document changes (debounced;
 * typing changes the Undo state, moving changes page/selection states) and polled slowly as a fallback.
 */
export function useDocInfo(doc: DocumentDescriptor, triggers: readonly string[]): DocInfo | null {
  const [info, setInfo] = useState<DocInfo | null>(null);
  const revision = useCommands((s) => s.revision[doc.docId] ?? 0);
  const ready = doc.state === 'ready';
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (ready) ensureSubscribed(doc.docId, triggers);
  }, [doc.docId, ready, triggers]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      queryEngine(doc.docId, 'doc.info')
        .then((i) => {
          if (alive.current) setInfo(i);
        })
        .catch(() => undefined);
    }, INFO_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [doc.docId, ready, revision, doc.modified]);

  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      queryEngine(doc.docId, 'doc.info')
        .then((i) => {
          if (alive.current) setInfo(i);
        })
        .catch(() => undefined);
    }, INFO_POLL_MS);
    return () => clearInterval(id);
  }, [doc.docId, ready]);

  return info;
}

export function useCommandValue(docId: string, command: string): UnoPlain | undefined {
  return useCommands((s) => s.states[docId]?.[command]?.value);
}

/** Zoom of an office document through `.uno:Zoom` (state: PropertyValue sequence with `Value`). */
export function useOfficeZoom(doc: DocumentDescriptor): ZoomState {
  const raw = useCommandValue(doc.docId, '.uno:Zoom');
  const value = zoomFromState(raw);
  useEffect(() => {
    if (doc.state === 'ready') ensureSubscribed(doc.docId, ['.uno:Zoom']);
  }, [doc.docId, doc.state]);
  return useMemo(
    () => ({
      value,
      min: ZOOM_MIN,
      max: ZOOM_MAX,
      set: (v: number) => void setOfficeZoom(doc.docId, v),
      step: (dir: 1 | -1) => void setOfficeZoom(doc.docId, stepZoom(value ?? 100, dir)),
      openDialog: () => void dispatchUno(doc.docId, '.uno:Zoom'),
    }),
    [doc.docId, value],
  );
}
