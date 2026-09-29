/**
 * Enlarges libuv's thread pool before anything uses it. Imported first by the main entry (src/main/index.ts):
 * libuv reads UV_THREADPOOL_SIZE once, when the first task is queued (async fs, crypto, zlib, dns, koffi `.async`).
 *
 * Why: koffi `.async` calls of the platform layer (window placement, PrintWindow captures, the process guard's
 * waits) run on this pool, and a call into a LibreOffice window that stops pumping messages blocks its thread
 * until the engine pumps again or ends. With libuv's default of 4 threads, two such engines could stall every
 * fs.promises call of the main process — saves of other documents, recovery snapshots, settings.
 * A value set in the environment by the user wins.
 */
export const THREADPOOL_SIZE = 16;

export function configureThreadPool(env: NodeJS.ProcessEnv = process.env): string {
  const current = env['UV_THREADPOOL_SIZE'];
  if (!current || !/^[1-9]\d{0,3}$/.test(current)) env['UV_THREADPOOL_SIZE'] = String(THREADPOOL_SIZE);
  return env['UV_THREADPOOL_SIZE'] as string;
}

configureThreadPool();
