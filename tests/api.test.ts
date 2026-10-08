import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api } from '../src/server/http.js';
import { RunService } from '../src/server/service.js';
import { RunStore } from '../src/server/store.js';
import { verifyBundle } from '../src/core/bundle.js';
import type { RunRecord } from '../src/core/types.js';

describe('HTTP API end to end without network writes', () => {
  const store = new RunStore(':memory:'); const service = new RunService(store);
  const server = createServer((req, res) => { void api(req, res, service); }); let base = '';
  beforeAll(async () => { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
  it('serves explicit read-only configuration', async () => { const data = await (await fetch(`${base}/api/config`)).json(); expect(data.readOnly).toBe(true); expect(data.fixtures.length).toBe(7); });
  it('blocks cross-origin requests', async () => { expect((await fetch(`${base}/api/runs`, { headers: { origin: 'https://evil.test' } })).status).toBe(403); });
  it('rejects non-JSON local requests', async () => { expect((await fetch(`${base}/api/fixtures`, { method: 'POST', body: 'fixtureId=successful' })).status).toBe(400); });
  it('rejects an unknown fixture without creating a report', async () => { const count = store.list().length; const response = await fetch(`${base}/api/fixtures`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"fixtureId":"fake"}' }); expect(response.status).toBe(400); expect(store.list().length).toBe(count); });
  it('creates, refreshes, retrieves and exports a fixture without promoting it to live evidence', async () => {
    const start = await fetch(`${base}/api/fixtures`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"fixtureId":"execution-error"}' });
    expect(start.status).toBe(202); const run = await start.json() as RunRecord;
    const current = await (await fetch(`${base}/api/runs/${run.id}`)).json() as RunRecord;
    expect(current.status).toBe('complete'); expect(current.report?.origin).toBe('fixture');
    const refreshed = await (await fetch(`${base}/api/runs/${run.id}/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as RunRecord;
    expect(refreshed.parentId).toBe(run.id); const next = await (await fetch(`${base}/api/runs/${refreshed.id}`)).json() as RunRecord;
    expect(next.report?.origin).toBe('fixture'); expect(next.report?.conclusion).toBe('ISSUES_FOUND');
    const response = await fetch(`${base}/api/runs/${run.id}/bundle`); const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get('content-type')).toBe('application/zip'); expect(verifyBundle(bytes, response.headers.get('x-evidence-sha256')!)).toMatchObject({ valid: true, anchored: true });
  });
  it('returns missing reports as 404', async () => { expect((await fetch(`${base}/api/runs/00000000-0000-4000-8000-000000000000`)).status).toBe(404); });
});
