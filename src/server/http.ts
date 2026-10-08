import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildBundle } from '../core/bundle.js';
import { NETWORKS } from '../core/networks.js';
import { FIXTURES } from '../fixtures/index.js';
import { RunService } from './service.js';

export function localRequestAllowed(request: IncomingMessage): boolean {
  const host = request.headers.host ?? '';
  if (!/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host)) return false;
  const origin = request.headers.origin;
  return !origin || origin === `http://${host}`;
}
export async function requestJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Use application/json.');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 262144) throw new Error('Request body exceeds 256 KiB.'); chunks.push(bytes); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(value));
}

export async function api(request: IncomingMessage, response: ServerResponse, service: RunService): Promise<boolean> {
  if (!localRequestAllowed(request)) { json(response, 403, { error: 'Only same-origin loopback requests are allowed.' }); return true; }
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;
  try {
    if (request.method === 'GET' && url.pathname === '/api/config') { json(response, 200, { version: '0.1.0', readOnly: true, networks: Object.values(NETWORKS), fixtures: FIXTURES }); return true; }
    if (request.method === 'GET' && url.pathname === '/api/runs') { json(response, 200, service.store.list().map(({ report, ...run }) => ({ ...run, conclusion: report?.conclusion, origin: report?.origin, fixtureId: report?.fixtureId }))); return true; }
    if (request.method === 'POST' && (url.pathname === '/api/runs' || url.pathname === '/api/fixtures')) {
      const input = await requestJson(request);
      const fixtureId = url.pathname === '/api/fixtures' && input && typeof input === 'object' && 'fixtureId' in input && typeof input.fixtureId === 'string' ? input.fixtureId : undefined;
      if (url.pathname === '/api/fixtures' && !fixtureId) throw new Error('Select a fixture.');
      void service.inspect(input, { fixtureId }, run => json(response, 202, run)).catch(error => {
        if (!response.headersSent) json(response, 400, { error: error instanceof Error ? error.message : 'Inspection failed.' });
      });
      return true;
    }
    const match = url.pathname.match(/^\/api\/runs\/([a-f0-9-]{36})(?:\/(bundle|refresh))?$/);
    if (match) {
      const run = service.store.get(match[1]);
      if (!run) { json(response, 404, { error: 'Run not found.' }); return true; }
      if (request.method === 'GET' && !match[2]) { json(response, 200, run); return true; }
      if (request.method === 'GET' && match[2] === 'bundle') {
        if (!run.report) { json(response, 409, { error: 'Inspection is not complete.' }); return true; }
        const bundle = buildBundle(run.report);
        response.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="consensus-trace-${run.id}.zip"`, 'x-content-type-options': 'nosniff', 'x-evidence-sha256': bundle.sha256, 'cache-control': 'no-store' }); response.end(bundle.bytes); return true;
      }
      if (request.method === 'POST' && match[2] === 'refresh') {
        await requestJson(request);
        void service.inspect(run.input, { parentId: run.id, fixtureId: run.fixtureId }, next => json(response, 202, next)).catch(error => { if (!response.headersSent) json(response, 400, { error: error instanceof Error ? error.message : 'Refresh failed.' }); });
        return true;
      }
    }
    json(response, 404, { error: 'Unknown API route.' });
  } catch (error) { if (!response.headersSent) json(response, 400, { error: error instanceof Error ? error.message : 'Invalid request.' }); }
  return true;
}
