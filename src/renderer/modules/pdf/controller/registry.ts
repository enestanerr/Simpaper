/** Open PDF controllers by document id (the ribbon actions and the status bar look them up here). */
import type { PdfController } from './controller';

const controllers = new Map<string, PdfController>();
const listeners = new Set<() => void>();

export function registerController(controller: PdfController): void {
  controllers.set(controller.docId, controller);
  for (const l of listeners) l();
}

export function unregisterController(controller: PdfController): void {
  if (controllers.get(controller.docId) === controller) {
    controllers.delete(controller.docId);
    for (const l of listeners) l();
  }
}

export function controllerFor(docId: string | null | undefined): PdfController | undefined {
  return docId ? controllers.get(docId) : undefined;
}

export function onControllersChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
