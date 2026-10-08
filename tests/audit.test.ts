import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { normalizeReceipt } from '../src/core/receipt.js';
import { parseCase } from '../src/core/input.js';
import { inspectCase } from '../src/core/inspect.js';
import { buildBundle, markdownReport, verifyBundle } from '../src/core/bundle.js';
import { fixtureCase, FixtureCollector } from '../src/fixtures/index.js';
import { BrowserRunStore } from '../src/web/storage.js';
import { handleInspection, AdmissionGate } from '../src/hosted/handler.js';
import type { RunRecord } from '../src/core/types.js';
import { parseReport } from '../src/core/report.js';
import { configureClient, request as clientRequest } from '../src/web/client.js';
import { hostedConfig } from '../src/hosted/handler.js';
import { HttpCollector } from '../src/adapters/http.js';
import { evaluateAssertion } from '../src/core/assertions.js';

const stores: BrowserRunStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); vi.restoreAllMocks(); });
async function completed(): Promise<RunRecord> {
  const report = await inspectCase(fixtureCase('successful'), new FixtureCollector('successful'), { origin: 'fixture' });
  return { id: report.id, createdAt: report.createdAt, status: 'complete', input: structuredClone(report.input), report };
}
function storage(factory = new IDBFactory(), name = randomUUID()) {
  const store = new BrowserRunStore(name, factory); stores.push(store); return store;
}
function request(body: unknown) {
  return new Request('https://consensus-trace.vercel.app/api/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('audit regressions: fail-closed receipt normalization', () => {
  it.each(['PENDING', 255])('rejects FINALIZED when the other status is %s', status => {
    const receipt = normalizeReceipt({ status, statusName: 'FINALIZED', txExecutionResult: 1 });
    expect(receipt.finalized).toBe(false); expect(receipt.inconsistencies.length).toBeGreaterThan(0);
  });
  it('does not prefer agreeing named votes over disagreeing encoded votes', () => {
    const receipt = normalizeReceipt({ status: 7, lastRound: { roundValidators: ['0x' + '1'.repeat(40)], validatorVotesName: ['AGREE'], validatorVotes: [2] } });
    expect(receipt.rounds[0].counts.AGREE).toBe(0); expect(receipt.inconsistencies.length).toBeGreaterThan(0);
  });
  it('does not replace an explicit unknown execution code with a convenient leader result', () => {
    expect(normalizeReceipt({ status: 7, txExecutionResult: 255, consensus_data: { leader_receipt: { mode: 'leader', execution_result: 'SUCCESS' } } }).execution).toBe('UNKNOWN');
  });
});
describe('audit regressions: public input and response boundary', () => {
  it('rejects nested credentials before a case can be persisted or sent', () => {
    const input = fixtureCase('successful'); input.assertions[0].args = [{ api_key: 'do-not-persist' }];
    expect(() => parseCase(input)).toThrow(/credential/i);
  });
  it('bounds recursive input validation in every entry point', () => {
    let nested: unknown = 1; for (let i = 0; i < 40; i++) nested = { next: nested };
    const input = fixtureCase('successful'); input.assertions[0].args = [nested as never];
    expect(() => parseCase(input)).toThrow(/nested|complex/i);
  });
  it('rejects ambiguous fixture plus live-input envelopes', async () => {
    const response = await handleInspection(request({ id: randomUUID(), fixtureId: 'successful', input: fixtureCase('successful') }), { gate: new AdmissionGate(), log: () => undefined });
    expect(response.status).toBe(400);
  });
  it('classifies unexpected service faults as sanitized server errors', async () => {
    const response = await handleInspection(request({ id: randomUUID(), input: fixtureCase('successful') }), { gate: new AdmissionGate(), log: () => undefined, collector: { rpc: async () => { throw new Error('internal secret detail'); }, source: async () => { throw new Error('internal secret detail'); } } });
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain('internal secret detail');
  });
});
describe('audit regressions: stored evidence integrity', () => {
  it('rejects a completed report with different source/assertion inputs', async () => {
    const run = await completed(); run.report!.input.source!.commit = 'b'.repeat(40);
    await expect(storage().save(run)).rejects.toThrow(/match|bound/i);
  });
  it('rejects malformed nested reports before rendering', async () => {
    const run = await completed(); delete (run.report as unknown as Record<string, unknown>).observations;
    await expect(storage().save(run)).rejects.toThrow();
  });
  it.each(['assertion', 'vote', 'link', 'receipt', 'source'] as const)('rejects inconsistent %s fields', async field => {
    const run = await completed(); const report = run.report!;
    if (field === 'assertion') report.assertions[0].actual = 'wrong result';
    if (field === 'vote') report.receipt.rounds[0].counts.AGREE++;
    if (field === 'link') report.links.contract = 'https://attacker.example';
    if (field === 'receipt') report.receipt.recipient = '0x' + '9'.repeat(40);
    if (field === 'source') report.source.pinnedSha256 = '0'.repeat(64);
    expect(() => parseReport(report, run)).toThrow();
  });
  it('rejects an API response that keeps the transaction but changes assertion expectations', async () => {
    const store = storage(); configureClient(hostedConfig(), store);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { id: string; fixtureId: string };
      const report = await inspectCase(fixtureCase(body.fixtureId), new FixtureCollector(body.fixtureId), { id: body.id, origin: 'fixture', fixtureId: body.fixtureId });
      report.input.assertions[0].expected = 'substituted expectation'; return Response.json({ report });
    });
    const run = await clientRequest<RunRecord>('/api/fixtures', { method: 'POST', body: JSON.stringify({ fixtureId: 'successful' }) });
    await vi.waitFor(async () => { const saved = await store.get(run.id); expect(saved?.status).toBe('interrupted'); expect(saved?.report).toBeUndefined(); expect(saved?.failure).toMatch(/bound/); });
  });
  it('keeps all supported history entries accessible', async () => {
    const store = storage(); const input = fixtureCase('successful');
    for (let i = 0; i < 105; i++) await store.save({ id: randomUUID(), createdAt: new Date().toISOString(), status: 'collecting', input });
    expect(await store.list()).toHaveLength(105);
  });
  it('isolates a damaged row without hiding or deleting valid evidence', async () => {
    const factory = new IDBFactory(); const name = randomUUID(); const store = storage(factory, name); const valid = await completed(); await store.save(valid);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = factory.open(name, 1); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const damagedId = randomUUID();
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('runs', 'readwrite'); tx.objectStore('runs').put({ schemaVersion: 99, run: { id: damagedId } }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    expect((await store.list()).map(item => item.id)).toEqual([valid.id]);
    const retained = await new Promise<unknown>(resolve => { const get = db.transaction('runs', 'readonly').objectStore('runs').get(damagedId); get.onsuccess = () => resolve(get.result); });
    expect(retained).toBeDefined(); db.close();
  });
});
describe('audit regressions: upstream resource bounds', () => {
  it('honors a canceled aggregate request before making a network call', async () => {
    const fetcher = vi.fn(); const collector = new HttpCollector(fetcher, 1000, AbortSignal.abort());
    expect((await collector.rpc('bradbury', 'eth_chainId', [])).kind).toBe('error'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects deeply nested upstream JSON without treating it as contract evidence', async () => {
    let value: unknown = 1; for (let i = 0; i < 70; i++) value = { next: value };
    const collector = new HttpCollector(vi.fn().mockResolvedValue(Response.json({ jsonrpc: '2.0', id: 1, result: value })));
    expect((await collector.rpc('bradbury', 'eth_chainId', [])).kind).toBe('error');
  });
  it('reports deeply nested parsed read strings as unavailable rather than recursing', () => {
    let value: unknown = 1; for (let i = 0; i < 70; i++) value = { next: value };
    const spec = { ...fixtureCase('successful').assertions[0], parseJson: true };
    expect(evaluateAssertion(spec, { kind: 'ok', method: 'gen_call', capturedAt: new Date().toISOString(), durationMs: 0, value: JSON.stringify(value) }).status).toBe('UNAVAILABLE');
  });
});
describe('audit regressions: exported evidence', () => {
  it('rejects duplicate physical ZIP paths even when their bytes match', async () => {
    const bundle = buildBundle((await completed()).report!); const files = unzipSync(bundle.bytes);
    const archive = zipSync({ ...files, 'reporx.json': files['report.json'] });
    const from = strToU8('reporx.json'); const to = strToU8('report.json');
    for (let i = 0; i <= archive.length - from.length; i++) if (from.every((byte, offset) => archive[i + offset] === byte)) archive.set(to, i);
    expect(verifyBundle(archive).valid).toBe(false);
  });
  it('renders submitted Markdown links as literal text', async () => {
    const report = (await completed()).report!; report.input.name = '[review](https://attacker.example)';
    expect(markdownReport(report)).not.toContain('Case: [review](https://attacker.example)');
  });
});
