import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { handleInspection, hostedConfig, AdmissionGate } from '../src/hosted/handler.js';
import { fixtureCase, FixtureCollector } from '../src/fixtures/index.js';
import { inspectCase } from '../src/core/inspect.js';
import { BrowserRunStore } from '../src/web/storage.js';
import { configureClient, request as clientRequest } from '../src/web/client.js';
import { buildBundle, verifyBundle } from '../src/core/bundle.js';
import type { RunRecord, TraceReport } from '../src/core/types.js';

const url = 'https://consensus-trace.vercel.app/api/inspect';
const quiet = () => undefined;
const payload = (extra: object = {}) => ({ id: randomUUID(), fixtureId: 'successful', ...extra });
const inspectionRequest = (body: unknown, headers: HeadersInit = {}) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://consensus-trace.vercel.app', ...headers }, body: JSON.stringify(body) });
describe('public hosted inspection boundary', () => {
  it('advertises browser-private storage, public networks and explicit trace limits', () => {
    const config = hostedConfig(); expect(config.storage).toBe('browser'); expect(config.tracesEnabled).toBe(false); expect(config.networks.map(item => item.id)).toEqual(['studionet', 'bradbury']); expect(config.fixtures).toHaveLength(7); expect(config.fixtures[0].input.name).toContain('Demo:');
  });
  it('runs an explicitly synthetic fixture without contacting a network', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network must not be used.'));
    try { const response = await handleInspection(inspectionRequest(payload()), { gate: new AdmissionGate(), log: quiet }); const value = await response.json() as { report: TraceReport }; expect(response.status).toBe(200); expect(value.report.origin).toBe('fixture'); expect(value.report.conclusion).toBe('CHECKS_PASSED'); expect(fetcher).not.toHaveBeenCalled(); }
    finally { fetcher.mockRestore(); }
  });
  it('preserves finalized execution errors as issues', async () => { const response = await handleInspection(inspectionRequest(payload({ fixtureId: 'execution-error' })), { gate: new AdmissionGate(), log: quiet }); const value = await response.json() as { report: TraceReport }; expect(value.report.receipt.finalized).toBe(true); expect(value.report.receipt.execution).toBe('ERROR'); expect(value.report.conclusion).toBe('ISSUES_FOUND'); });
  it('rejects cross-origin requests before doing work', async () => { const response = await handleInspection(inspectionRequest(payload(), { origin: 'https://attacker.example' }), { log: quiet }); expect(response.status).toBe(403); });
  it('rejects a browser cross-site signal', async () => { const response = await handleInspection(inspectionRequest(payload(), { 'sec-fetch-site': 'cross-site' }), { log: quiet }); expect(response.status).toBe(403); });
  it('rejects unsupported HTTP methods', async () => { expect((await handleInspection(new Request(url), { log: quiet })).status).toBe(405); });
  it('rejects JSON-like but unsupported content types', async () => { expect((await handleInspection(inspectionRequest(payload(), { 'content-type': 'application/jsonp' }), { log: quiet })).status).toBe(400); });
  it('rejects unknown envelope fields and credentials', async () => { expect((await handleInspection(inspectionRequest(payload({ privateKey: 'do-not-accept' })), { log: quiet })).status).toBe(400); });
  it('rejects localnet before the collector is called', async () => { const collector = new FixtureCollector('successful'); const spy = vi.spyOn(collector, 'rpc'); const response = await handleInspection(inspectionRequest({ id: randomUUID(), input: { ...fixtureCase('successful'), network: 'localnet' } }), { collector, log: quiet }); expect(response.status).toBe(400); expect(spy).not.toHaveBeenCalled(); });
  it('rejects replay-capable tracing before collection', async () => { const response = await handleInspection(inspectionRequest({ id: randomUUID(), input: { ...fixtureCase('successful'), includeTrace: true } }), { log: quiet }); expect(response.status).toBe(400); expect(JSON.stringify(await response.json())).toContain('disabled'); });
  it('rejects arbitrary RPC URLs in submitted input', async () => { const response = await handleInspection(inspectionRequest({ id: randomUUID(), input: { ...fixtureCase('successful'), rpc: 'https://attacker.example' } }), { log: quiet }); expect(response.status).toBe(400); });
  it('rejects oversized bodies even without content-length', async () => { expect((await handleInspection(inspectionRequest(payload({ huge: 'x'.repeat(66000) })), { log: quiet })).status).toBe(400); });
  it('rejects deeply nested bodies before recursive validation', async () => { let deep: unknown = 1; for (let i = 0; i < 30; i++) deep = { next: deep }; expect((await handleInspection(inspectionRequest({ id: randomUUID(), input: deep }), { log: quiet })).status).toBe(400); });
  it('returns explicit throttling and never logs case content', async () => { const gate = new AdmissionGate(); const logs: object[] = []; for (let i = 0; i < 6; i++) expect((await handleInspection(inspectionRequest(payload()), { gate, log: entry => logs.push(entry) })).status).toBe(200); const rejected = await handleInspection(inspectionRequest(payload()), { gate, log: quiet }); expect(rejected.status).toBe(429); expect(rejected.headers.get('retry-after')).toBe('60'); expect(JSON.stringify(logs)).not.toContain('contractAddress'); });
  it('bounds instance concurrency and releases exactly once', () => { const gate = new AdmissionGate(); const a = gate.enter('one', 1)!; const b = gate.enter('two', 1)!; const c = gate.enter('three', 1)!; expect(gate.enter('four', 1)).toBeNull(); a(); a(); expect(gate.enter('four', 1)).not.toBeNull(); b(); c(); });
});

const stores: BrowserRunStore[] = [];
function store(factory = new IDBFactory(), name = `test-${randomUUID()}`, maximum?: number) { const value = new BrowserRunStore(name, factory, maximum); stores.push(value); return value; }
async function completed(): Promise<RunRecord> { const report = await inspectCase(fixtureCase('successful'), new FixtureCollector('successful'), { origin: 'fixture' }); return { id: report.id, createdAt: report.createdAt, status: 'complete', input: report.input, report }; }
afterEach(async () => { for (const item of stores.splice(0)) await item.close(); vi.restoreAllMocks(); });
describe('browser-local immutable report storage', () => {
  it('persists reports across new store instances without server history', async () => { const factory = new IDBFactory(); const name = randomUUID(); const a = store(factory, name); const run = await completed(); await a.save(run); await a.close(); const b = store(factory, name); expect(await b.get(run.id)).toEqual(run); expect((await b.list())[0].conclusion).toBe('CHECKS_PASSED'); });
  it('does not expose reports to a different browser database', async () => { const factory = new IDBFactory(); const a = store(factory, 'first'); const b = store(factory, 'second'); await a.save(await completed()); expect(await b.list()).toEqual([]); });
  it('rejects overwriting completed evidence snapshots', async () => { const a = store(); const run = await completed(); await a.save(run); await expect(a.save({ ...run, input: { ...run.input, name: 'Changed' } })).rejects.toThrow('cannot be overwritten'); expect((await a.get(run.id))?.input.name).toBe(run.input.name); });
  it('preserves existing reports when its byte quota is exceeded', async () => { const a = store(undefined, undefined, 1000); const run = await completed(); await expect(a.save(run)).rejects.toThrow('history is full'); expect(await a.list()).toEqual([]); });
  it('recovers a stale collecting record without resubmitting the transaction', async () => { const a = store(); const run = await completed(); const pending: RunRecord = { id: run.id, createdAt: run.createdAt, input: run.input, status: 'collecting' }; await a.save(pending); const recovered = await a.get(run.id, Date.parse(run.createdAt) + 76000); expect(recovered?.status).toBe('interrupted'); expect(recovered?.input.transactionHash).toBe(run.input.transactionHash); });
  it('keeps an active collection intact', async () => { const a = store(); const run = await completed(); await a.save({ id: run.id, createdAt: run.createdAt, input: run.input, status: 'collecting' }); expect((await a.get(run.id, Date.parse(run.createdAt) + 1000))?.status).toBe('collecting'); });
  it('keeps browser-exported bundles independently verifiable', async () => { const a = store(); const run = await completed(); await a.save(run); const report = (await a.get(run.id))!.report!; const bundle = buildBundle(report); expect(verifyBundle(bundle.bytes, bundle.sha256).valid).toBe(true); });
});
describe('hosted client transport', () => {
  it('uses the stateless endpoint, saves before collection, refreshes without chain writes', async () => {
    const a = store(); configureClient(hostedConfig(), a); const calls: { path: string; body: Record<string, unknown> }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>; calls.push({ path: String(input), body }); expect((await a.get(String(body.id)))?.status).toBe('collecting');
      return handleInspection(new Request(url, { method: 'POST', headers: init?.headers, body: String(init?.body) }), { gate: new AdmissionGate(), log: quiet });
    });
    const initial = await clientRequest<RunRecord>('/api/fixtures', { method: 'POST', body: JSON.stringify({ fixtureId: 'successful' }) });
    let done: RunRecord | undefined; await vi.waitFor(async () => { done = await a.get(initial.id); expect(done?.status).toBe('complete'); });
    const refresh = await clientRequest<RunRecord>(`/api/runs/${initial.id}/refresh`, { method: 'POST', body: '{}' });
    await vi.waitFor(async () => expect((await a.get(refresh.id))?.status).toBe('complete'));
    expect(refresh.parentId).toBe(initial.id); expect(refresh.input.transactionHash).toBe(initial.input.transactionHash); expect(calls.map(call => call.path)).toEqual(['/api/inspect', '/api/inspect']); expect(calls[1].body.fixtureId).toBe('successful'); expect((await a.get(initial.id))?.report).toEqual(done?.report);
  });
  it('preserves an interrupted report and the API error after a failed hosted request', async () => { const a = store(); configureClient(hostedConfig(), a); vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'Request limit reached.' }, { status: 429 })); const started = await clientRequest<RunRecord>('/api/fixtures', { method: 'POST', body: JSON.stringify({ fixtureId: 'successful' }) }); await vi.waitFor(async () => { const saved = await a.get(started.id); expect(saved?.status).toBe('interrupted'); expect(saved?.failure).toBe('Request limit reached.'); }); });
});
