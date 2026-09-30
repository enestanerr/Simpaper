/**
 * Files handed to Simpaper by Windows (double-click, "Open with", the command line) open one after another.
 * Explorer starts one process per selected file and each reaches the running instance as a batch of its own
 * (`second-instance`), so all batches share one queue: parallel opens would start an engine per file at once, and
 * their prompts (CSV import, password) would pile up.
 */
export interface OpenQueueDeps {
  open(path: string): Promise<unknown>;
  /** A file that could not be opened; cancelled opens (`errors.open.cancelled`) are not reported. */
  failed(path: string, errorKey: string): void;
}

export interface OpenQueue {
  /** Opens the files after everything queued before them; resolves when they have been handled. */
  enqueue(files: readonly string[]): Promise<void>;
}

export function createOpenQueue(deps: OpenQueueDeps): OpenQueue {
  let tail: Promise<void> = Promise.resolve();
  const run = async (files: readonly string[]) => {
    for (const file of files) {
      try {
        await deps.open(file);
      } catch (err) {
        const key = (err as { errorKey?: unknown } | null)?.errorKey;
        const errorKey = typeof key === 'string' ? key : 'errors.open.failed';
        if (errorKey !== 'errors.open.cancelled') deps.failed(file, errorKey);
      }
    }
  };
  return {
    enqueue(files) {
      const next = tail.then(() => run(files));
      tail = next.catch(() => undefined);
      return next;
    },
  };
}
