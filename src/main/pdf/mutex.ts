/**
 * Serialises async work per key (per document), so concurrent `pdf:*` calls never interleave
 * their read-modify-write of the same working copy.
 */
export interface KeyedMutex {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** Number of keys with queued or running work (diagnostics/tests). */
  readonly size: number;
}

export function createKeyedMutex(): KeyedMutex {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(task, task);
      const tail = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
    get size() {
      return tails.size;
    },
  };
}
