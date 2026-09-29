/**
 * Engine lifecycle: start + handshake, interception, command state, undo/redo, crash handling and
 * clean disposal (no processes left behind).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RPC_ERROR } from '@shared/engine-protocol';
import { isEngineRpcError } from '../../src/main/engine';
import { BRIDGE_EXIT_CONNECTION_LOST } from '../../src/main/engine/EngineInstance';
import { createTaskkillProcessGuard } from '../../src/main/engine/fallbackGuard';
import type { EngineExitInfo, EngineInstance, EngineManager } from '../../src/main/engine/types';
import { crashDumps, engineAvailable, EventLog, fileUrl, isProcessAlive, makeManager, outDir, printTimings, timed } from './helpers';

// Bridges started by this file offer the test-only 'debug.dropConnection' (varak_bridge/methods.py).
process.env['VARAK_BRIDGE_TEST_HOOKS'] = '1';
const dropConnection = (instance: EngineInstance): Promise<unknown> =>
  (instance.call as unknown as (method: string, params: object) => Promise<unknown>)('debug.dropConnection', {});

describe.skipIf(!engineAvailable)('engine lifecycle (headless)', () => {
  let manager: EngineManager;
  let dir: string;

  beforeAll(() => {
    manager = makeManager('lifecycle');
    dir = outDir('lifecycle');
  });

  afterAll(async () => {
    await manager?.dispose();
    printTimings('Engine lifecycle timings');
  });

  it('probes the engine without starting it', async () => {
    const probe = await manager.probe();
    expect(probe.available).toBe(true);
    expect(probe.officeVersion).toMatch(/^26\.8\.\d+\.\d+$/);
  });

  it('starts an instance and completes the handshake', async () => {
    const instance = await timed('instance start (acquire + hello)', () => manager.acquireDocumentInstance('life-1'));
    const info = instance.info();
    expect(info.state).toBe('ready');
    expect(info.role).toBe('document');
    expect(info.officeVersion).toMatch(/^26\.8\./);
    expect(info.officePid).toBeGreaterThan(0);
    expect(info.bridgePid).toBeGreaterThan(0);
    expect(isProcessAlive(info.officePid)).toBe(true);
    expect(manager.getDocumentInstance('life-1')).toBe(instance);
    // Asking again for the same document returns the same instance.
    expect(await manager.acquireDocumentInstance('life-1')).toBe(instance);
  });

  it('intercepts .uno:Save instead of writing the file', async () => {
    const instance = await manager.acquireDocumentInstance('life-1');
    const path = join(dir, 'intercept.docx');
    await instance.call('doc.new', { docId: 'seed', kind: 'writer', view: { mode: 'hidden' } });
    await instance.call('writer.insertText', { docId: 'seed', text: 'Özgün içerik' });
    await instance.call('doc.store', { docId: 'seed', url: fileUrl(path), filter: 'MS Word 2007 XML' });
    await instance.call('doc.close', { docId: 'seed' });
    const original = readFileSync(path);

    const events = new EventLog(instance);
    await instance.call('doc.load', { docId: 'w', url: fileUrl(path), view: { mode: 'hidden' } });
    await instance.call('writer.insertText', { docId: 'w', text: 'Kaydedilmeyecek ek. ' });
    await instance.call('cmd.dispatch', { docId: 'w', command: '.uno:Save' });
    const intercept = await events.waitFor((e) => e.type === 'intercept');
    expect(intercept).toMatchObject({ type: 'intercept', docId: 'w', command: '.uno:Save' });
    await instance.call('cmd.dispatch', { docId: 'w', command: '.uno:SaveAs' });
    await events.waitFor((e) => e.type === 'intercept' && e.command === '.uno:SaveAs');
    // LibreOffice did not save: the file is byte-identical and the document is still modified.
    expect(readFileSync(path).equals(original)).toBe(true);
    expect((await instance.call('doc.info', { docId: 'w' })).modified).toBe(true);
    expect(existsSync(`${path}.bak`)).toBe(false);
  });

  it('reports command state changes (.uno:Bold) after a dispatch', async () => {
    const instance = await manager.acquireDocumentInstance('life-1');
    const events = new EventLog(instance);
    const { states } = await instance.call('cmd.subscribe', { docId: 'w', commands: ['.uno:Bold', '.uno:Italic'] });
    expect(states.find((s) => s.command === '.uno:Bold')).toMatchObject({ enabled: true, value: false });
    await instance.call('cmd.dispatch', { docId: 'w', command: '.uno:SelectAll' });
    await instance.call('cmd.dispatch', { docId: 'w', command: '.uno:Bold' });
    const on = await events.waitFor((e) => e.type === 'state' && e.command === '.uno:Bold' && e.value === true);
    expect(on).toMatchObject({ docId: 'w', enabled: true });
    await instance.call('cmd.dispatch', { docId: 'w', command: '.uno:Bold' });
    await events.waitFor((e) => e.type === 'state' && e.command === '.uno:Bold' && e.value === false);
    await instance.call('cmd.unsubscribe', { docId: 'w', commands: ['.uno:Bold', '.uno:Italic'] });
  });

  it('undoes and redoes through dispatched commands', async () => {
    const instance = await manager.acquireDocumentInstance('life-1');
    await instance.call('doc.new', { docId: 'u', kind: 'writer', view: { mode: 'hidden' } });
    const text = 'Çağrı İşçi ığdır ÖŞÜ';
    await instance.call('writer.insertText', { docId: 'u', text });
    expect((await instance.call('writer.getText', { docId: 'u' })).text).toBe(text);
    await instance.call('cmd.dispatch', { docId: 'u', command: '.uno:Undo' });
    expect((await instance.call('writer.getText', { docId: 'u' })).text).toBe('');
    await instance.call('cmd.dispatch', { docId: 'u', command: '.uno:Redo' });
    expect((await instance.call('writer.getText', { docId: 'u' })).text).toBe(text);
    await instance.call('doc.close', { docId: 'u' });
  });

  it('maps bridge errors to protocol error codes', async () => {
    const instance = await manager.acquireDocumentInstance('life-1');
    await expect(instance.call('doc.info', { docId: 'missing' })).rejects.toSatisfy((e) => isEngineRpcError(e, RPC_ERROR.DOC_NOT_FOUND));
    await expect(instance.call('cmd.dispatch', { docId: 'w', command: 'macro:///Standard.Module1.Main' })).rejects.toSatisfy((e) =>
      isEngineRpcError(e, RPC_ERROR.INVALID_PARAMS),
    );
    await expect(
      instance.call('doc.load', { docId: 'nofile', url: fileUrl(join(dir, 'does-not-exist.docx')), view: { mode: 'hidden' } }),
    ).rejects.toSatisfy((e) => isEngineRpcError(e, RPC_ERROR.LOAD_FAILED));
    // Hidden documents never get a visible window.
    await expect(instance.call('view.setVisible', { docId: 'w', visible: true })).rejects.toSatisfy((e) => isEngineRpcError(e, RPC_ERROR.UNSUPPORTED));
  });

  it('detects a crashed soffice.bin and can start a new instance', async () => {
    const instance: EngineInstance = await manager.acquireDocumentInstance('crash-1');
    const { officePid, bridgePid } = instance.info();
    expect(officePid).toBeGreaterThan(0);
    const exited = new Promise<EngineExitInfo>((resolve) => instance.onExit(resolve));
    await createTaskkillProcessGuard().killTree(officePid!);
    const info = await exited;
    expect(info.crashed).toBe(true);
    expect(instance.info().state).toBe('crashed');
    await expect(instance.call('doc.info', { docId: 'x' })).rejects.toSatisfy((e) => isEngineRpcError(e, RPC_ERROR.ENGINE_UNAVAILABLE));
    // The bridge of the crashed instance is cleaned up as well.
    await expect.poll(() => isProcessAlive(bridgePid), { timeout: 15_000 }).toBe(false);

    const replacement = await timed('instance restart after crash', () => manager.acquireDocumentInstance('crash-1'));
    expect(replacement).not.toBe(instance);
    expect(replacement.info().state).toBe('ready');
    await replacement.call('doc.new', { docId: 'after-crash', kind: 'calc', view: { mode: 'hidden' } });
    await manager.releaseDocumentInstance('crash-1');
    expect(replacement.info().state).toBe('stopped');
  });

  it('ends as crashed when the bridge loses its URP connection while soffice keeps running', async () => {
    const instance: EngineInstance = await manager.acquireDocumentInstance('lost-1');
    const { officePid, bridgePid } = instance.info();
    await instance.call('doc.new', { docId: 'l', kind: 'writer', view: { mode: 'hidden' } });
    const exited = new Promise<EngineExitInfo>((resolve) => instance.onExit(resolve));
    // The URP connection ends while soffice keeps running (as binaryurp does after a marshalling error). The
    // bridge used to answer ENGINE_UNAVAILABLE from then on and never exit, so no crash handling (restore
    // into a new instance) ever ran.
    await dropConnection(instance).catch(() => undefined);
    await expect(instance.call('doc.info', { docId: 'l' })).rejects.toSatisfy((e) => isEngineRpcError(e, RPC_ERROR.ENGINE_UNAVAILABLE));
    const info = await timed('instance exit after a lost URP connection', () =>
      Promise.race([exited, new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('no exit within 15 s')), 15_000))]),
    );
    // The bridge's own exit code: it ended first, while soffice was still running.
    expect(info).toEqual({ code: BRIDGE_EXIT_CONNECTION_LOST, crashed: true });
    expect(instance.info().state).toBe('crashed');
    await expect.poll(() => isProcessAlive(officePid), { timeout: 15_000 }).toBe(false);
    await expect.poll(() => isProcessAlive(bridgePid), { timeout: 15_000 }).toBe(false);

    const replacement = await manager.acquireDocumentInstance('lost-1');
    expect(replacement).not.toBe(instance);
    await replacement.call('doc.new', { docId: 'l', kind: 'writer', view: { mode: 'hidden' } });
    await replacement.call('writer.insertText', { docId: 'l', text: 'Çağrı' });
    expect((await replacement.call('writer.getText', { docId: 'l' })).text).toBe('Çağrı');
    await manager.releaseDocumentInstance('lost-1');
  });

  it('replaces lone UTF-16 surrogates from the renderer instead of losing the engine', async () => {
    // binaryurp cannot marshal a lone surrogate: before the bridge scrubbed them (framing.scrub_surrogates),
    // such a string disposed the URP connection and ended the instance.
    const instance = await manager.acquireDocumentInstance('surrogate-1');
    let exited = false;
    instance.onExit(() => (exited = true));
    await instance.call('doc.new', { docId: 's', kind: 'writer', view: { mode: 'hidden' } });
    await instance.call('writer.insertText', { docId: 's', text: 'A\ud83dB \udc00 Çağrı \u{1F600}' });
    expect((await instance.call('writer.getText', { docId: 's' })).text).toBe('A\ufffdB \ufffd Çağrı \u{1F600}');
    expect(instance.info().state).toBe('ready');
    expect(exited).toBe(false);
    await manager.releaseDocumentInstance('surrogate-1');
  });

  it('shuts down with open documents whose content was read (release barrier before closing)', async () => {
    const instance = await manager.acquireDocumentInstance('life-3');
    const { profileDir } = instance.info();
    await instance.call('doc.new', { docId: 'slides', kind: 'impress', view: { mode: 'hidden' } });
    await instance.call('impress.setShapeText', { docId: 'slides', slide: 0, shape: 0, text: 'Başlık' });
    expect((await instance.call('impress.slides', { docId: 'slides' })).slides[0]?.texts).toContain('Başlık');
    await instance.call('doc.new', { docId: 'cells', kind: 'calc', view: { mode: 'hidden' } });
    await instance.call('calc.setCell', { docId: 'cells', address: 'B2', formula: '=1/3' });
    expect((await instance.call('calc.getCell', { docId: 'cells', address: 'B2' })).value).toBeCloseTo(1 / 3, 12);
    const exit = new Promise<EngineExitInfo>((resolve) => instance.onExit(resolve));
    await manager.releaseDocumentInstance('life-3');
    expect((await exit).crashed).toBe(false);
    expect(crashDumps(profileDir)).toEqual([]);
  });

  it('disposes instances without leaving processes behind', async () => {
    const instance = await manager.acquireDocumentInstance('life-2');
    const { officePid, bridgePid } = instance.info();
    const exit = new Promise<EngineExitInfo>((resolve) => instance.onExit(resolve));
    await timed('instance dispose (engine.shutdown)', () => manager.releaseDocumentInstance('life-2'));
    expect((await exit).crashed).toBe(false);
    expect(crashDumps(instance.info().profileDir)).toEqual([]);
    expect(isProcessAlive(officePid)).toBe(false);
    expect(isProcessAlive(bridgePid)).toBe(false);
    expect(manager.getDocumentInstance('life-2')).toBeUndefined();
  });
});
