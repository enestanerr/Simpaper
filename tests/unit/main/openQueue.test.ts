/**
 * Files from Windows (double-click, "Open with", a multi-selection that starts one process per file) open one after
 * another, whatever batch they arrive in.
 */
import { describe, expect, it } from 'vitest';
import { createOpenQueue } from '../../../src/main/app/openQueue';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(fail: Record<string, string | Error> = {}) {
  const log: string[] = [];
  const pending = new Map<string, () => void>();
  const queue = createOpenQueue({
    open: (path) => {
      log.push(`start ${path}`);
      return new Promise<void>((resolve, reject) => {
        pending.set(path, () => {
          log.push(`end ${path}`);
          const f = fail[path];
          if (f === undefined) resolve();
          else reject(typeof f === 'string' ? Object.assign(new Error('x'), { errorKey: f }) : f);
        });
      });
    },
    failed: (path, key) => log.push(`failed ${path} ${key}`),
  });
  const finish = async (path: string) => {
    await tick();
    pending.get(path)?.();
    await tick();
  };
  return { queue, log, finish };
}

describe('open queue', () => {
  it('opens batches that arrive separately one file at a time, in arrival order', async () => {
    const h = harness();
    const first = h.queue.enqueue(['a.docx', 'b.xlsx']);
    const second = h.queue.enqueue(['c.pptx']); // second-instance event while the first batch still opens
    await h.finish('a.docx');
    expect(h.log).toEqual(['start a.docx', 'end a.docx', 'start b.xlsx']);
    await h.finish('b.xlsx');
    await first;
    expect(h.log.at(-1)).toBe('start c.pptx');
    await h.finish('c.pptx');
    await second;
    expect(h.log).toEqual(['start a.docx', 'end a.docx', 'start b.xlsx', 'end b.xlsx', 'start c.pptx', 'end c.pptx']);
  });

  it('reports failures with their error key, stays quiet about cancelled opens, and goes on', async () => {
    const h = harness({ 'gone.docx': 'errors.open.notFound', 'csv.csv': 'errors.open.cancelled', 'odd.xlsx': new Error('boom') });
    const done = h.queue.enqueue(['gone.docx', 'csv.csv', 'odd.xlsx', 'ok.pdf']);
    for (const f of ['gone.docx', 'csv.csv', 'odd.xlsx', 'ok.pdf']) await h.finish(f);
    await done;
    expect(h.log.filter((l) => l.startsWith('failed'))).toEqual(['failed gone.docx errors.open.notFound', 'failed odd.xlsx errors.open.failed']);
    expect(h.log).toContain('end ok.pdf');
    // The queue still works afterwards.
    const later = h.queue.enqueue(['next.docx']);
    await h.finish('next.docx');
    await later;
    expect(h.log.at(-1)).toBe('end next.docx');
  });
});
