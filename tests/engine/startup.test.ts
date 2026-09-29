/**
 * Regression test for the start-up hang (docs/dev/engine.md, "Start-up hang"): new Writer, Calc and
 * Impress documents in a fresh profile and in the same profile reused by later sessions, in every
 * module order, through the real EngineManager → bridge → soffice path. Also checks the mechanism of
 * the fix: soffice.bin never loads an embedded Python interpreter (python313.dll).
 *
 * The short version (3 sessions) always runs. The long loop (a fresh profile plus 10 reused sessions for
 * each module order, ~35 sessions) runs with VARAK_ENGINE_LONG=1.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { OfficeKind } from '@shared/modules';
import type { EngineInstance, EngineManager } from '../../src/main/engine/types';
import { crashDumps, engineAvailable, isModuleLoaded, makeManager, OUT, PROFILES } from './helpers';

const LONG = process.env['VARAK_ENGINE_LONG'] === '1';
const LONG_SESSIONS = Number(process.env['VARAK_ENGINE_LONG_SESSIONS'] ?? 10);
/** A healthy engine creates a document in well under a second; a hang never ends. */
const DOC_TIMEOUT_MS = 60_000;

const ORDERS: Record<string, OfficeKind[]> = {
  'writer-first': ['writer', 'calc', 'impress'],
  'calc-first': ['calc', 'impress', 'writer'],
  'impress-first': ['impress', 'writer', 'calc'],
};

interface SessionReport {
  label: string;
  profileDir: string;
  startMs: number;
  docsMs: Partial<Record<OfficeKind, number>>;
  pythonInOffice: boolean | null;
  disposeMs: number;
}

const reports: SessionReport[] = [];
const managers: EngineManager[] = [];

function freshManager(root: string): EngineManager {
  rmSync(join(PROFILES, root), { recursive: true, force: true });
  const manager = makeManager(root);
  managers.push(manager);
  return manager;
}

async function useModule(instance: EngineInstance, docId: string, kind: OfficeKind): Promise<void> {
  if (kind === 'writer') {
    await instance.call('writer.insertText', { docId, text: 'Çağrı İşçi ığdır ÖŞÜ' });
    expect((await instance.call('writer.getText', { docId })).text).toBe('Çağrı İşçi ığdır ÖŞÜ');
  } else if (kind === 'calc') {
    await instance.call('calc.setCell', { docId, address: 'A1', value: 2 });
    await instance.call('calc.setCell', { docId, address: 'A2', formula: '=A1*21' });
    expect((await instance.call('calc.getCell', { docId, address: 'A2' })).value).toBe(42);
  } else {
    const { slides } = await instance.call('impress.slides', { docId });
    expect(slides.length).toBeGreaterThan(0);
  }
}

async function session(manager: EngineManager, label: string, order: OfficeKind[]): Promise<SessionReport> {
  let started = performance.now();
  const instance = await manager.acquireDocumentInstance(label);
  const report: SessionReport = {
    label,
    profileDir: instance.info().profileDir,
    startMs: Math.round(performance.now() - started),
    docsMs: {},
    pythonInOffice: null,
    disposeMs: 0,
  };
  for (const kind of order) {
    const docId = `${label}-${kind}`;
    started = performance.now();
    const loaded = await instance.call('doc.new', { docId, kind, view: { mode: 'hidden' } }, { timeoutMs: DOC_TIMEOUT_MS });
    report.docsMs[kind] = Math.round(performance.now() - started);
    expect(loaded.kind).toBe(kind);
    await useModule(instance, docId, kind);
    await instance.call('doc.close', { docId });
  }
  const officePid = instance.info().officePid;
  if (officePid && process.platform === 'win32') report.pythonInOffice = await isModuleLoaded(officePid, 'python313.dll');
  started = performance.now();
  await manager.releaseDocumentInstance(label);
  report.disposeMs = Math.round(performance.now() - started);
  expect(instance.info().state).toBe('stopped');
  // soffice's crash handler exits with 0: only the absence of a dump proves a clean session.
  expect(crashDumps(report.profileDir), `crash dump in ${label}`).toEqual([]);
  reports.push(report);
  return report;
}

function summary(from = 0): string {
  const rows = reports.slice(from).map(
    (r) =>
      `  ${r.label.padEnd(30)} start ${String(r.startMs).padStart(6)} ms | ` +
      (['writer', 'calc', 'impress'] as const).map((k) => `${k} ${String(r.docsMs[k] ?? '-').padStart(5)}`).join(' | ') +
      ` | dispose ${String(r.disposeMs).padStart(5)} ms | python in soffice.bin: ${r.pythonInOffice}`,
  );
  return [`Engine start-up sessions (${rows.length})`, ...rows].join('\n');
}

/** Prints the sessions of one test and keeps all of them in test-output/engine/startup-report.json. */
function printReport(from: number): void {
  console.log(summary(from));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'startup-report.json'), JSON.stringify(reports, null, 1));
}

afterAll(async () => {
  await Promise.allSettled(managers.map((m) => m.dispose()));
});

describe.skipIf(!engineAvailable)('engine start-up (regression: no hang in fresh or reused profiles)', () => {
  it('creates documents in a fresh profile and in the same profile reused twice', async () => {
    const manager = freshManager('startup-short');
    const from = reports.length;
    const first = await session(manager, 'short-1-fresh-writer-first', ORDERS['writer-first']!);
    const second = await session(manager, 'short-2-reused-calc-first', ORDERS['calc-first']!);
    const third = await session(manager, 'short-3-reused-impress-first', ORDERS['impress-first']!);
    // The same profile slot is reused (the first start created it).
    expect(second.profileDir).toBe(first.profileDir);
    expect(third.profileDir).toBe(first.profileDir);
    // The fix: soffice.bin never starts an embedded Python interpreter.
    for (const r of [first, second, third]) if (r.pythonInOffice !== null) expect(r.pythonInOffice).toBe(false);
    printReport(from);
  });
});

describe.skipIf(!engineAvailable || !LONG)(`engine start-up loop (VARAK_ENGINE_LONG=1, ${LONG_SESSIONS} reused sessions per order)`, () => {
  for (const [name, order] of Object.entries(ORDERS)) {
    it(
      `${name}: fresh profile, then ${LONG_SESSIONS} sessions on the reused profile`,
      async () => {
        const manager = freshManager(`startup-long-${name}`);
        const from = reports.length;
        const first = await session(manager, `long-${name}-fresh`, order);
        for (let i = 1; i <= LONG_SESSIONS; i++) {
          const r = await session(manager, `long-${name}-reused-${i}`, order);
          expect(r.profileDir).toBe(first.profileDir);
          if (r.pythonInOffice !== null) expect(r.pythonInOffice).toBe(false);
        }
        printReport(from);
      },
      (LONG_SESSIONS + 1) * 90_000,
    );
  }
});
