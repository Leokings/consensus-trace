import { describe, expect, it, vi } from 'vitest';
import { HttpCollector, boundedText } from '../src/adapters/http.js';
import { fixtureCase } from '../src/fixtures/index.js';
import { localRequestAllowed } from '../src/server/http.js';
import type { IncomingMessage } from 'node:http';

describe('bounded read-only transport', () => {
  it('rejects every non-allowlisted mutation', async () => {
    const fetcher = vi.fn(); const collector = new HttpCollector(fetcher);
    for (const method of ['eth_sendRawTransaction', 'sim_cancelTransaction', 'gen_finalize', 'unknown']) expect(() => collector.rpc('bradbury', method, [])).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses the fixed official endpoint and rejects redirects', async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(String(init?.body)).id, result: '0x107d' })));
    const collector = new HttpCollector(fetcher); const evidence = await collector.rpc('bradbury', 'eth_chainId', []);
    expect(evidence.kind).toBe('ok'); expect(fetcher.mock.calls[0][0]).toBe('https://rpc-bradbury.genlayer.com'); expect(fetcher.mock.calls[0][1]?.redirect).toBe('error');
  });
  it('detects response ID mismatches', async () => { const collector = new HttpCollector(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 999, result: 1 }))); const evidence = await collector.rpc('bradbury', 'eth_chainId', []); expect(evidence.kind).toBe('error'); });
  it('preserves unsupported-method errors without fabricating a fallback', async () => {
    const collector = new HttpCollector(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } })));
    const evidence = await collector.rpc('studionet', 'gen_getTransactionLifecycle', []); expect(evidence.kind === 'error' && evidence.error.category).toBe('unsupported');
  });
  it('labels HTTP errors as retrieval failures, not execution failures', async () => { const evidence = await new HttpCollector(async () => new Response('', { status: 503 })).rpc('bradbury', 'eth_chainId', []); expect(evidence.kind).toBe('error'); });
  it('bounds streamed and advertised response size', async () => { await expect(boundedText(new Response('12345'), 4)).rejects.toThrow(); await expect(boundedText(new Response('x', { headers: { 'content-length': '100' } }), 4)).rejects.toThrow(); });
  it('refuses invalid source references before any outbound request', () => { const fetcher = vi.fn(); const collector = new HttpCollector(fetcher); expect(() => collector.source({ repository: 'evil', commit: 'main', path: '../x' })).toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
  it('uses only full-commit public GitHub source URLs', async () => { const fetcher = vi.fn(async (_url: unknown) => new Response('class Fixture: pass')); const ref = fixtureCase('successful').source!; const evidence = await new HttpCollector(fetcher).source(ref); expect(evidence.kind).toBe('ok'); expect(fetcher.mock.calls[0][0]).toBe(`https://raw.githubusercontent.com/${ref.repository}/${ref.commit}/${ref.path}`); });
  it('marks source 404 unavailable rather than a mismatch', async () => { const evidence = await new HttpCollector(async () => new Response('', { status: 404 })).source(fixtureCase('successful').source!); expect(evidence.kind).toBe('error'); });
  it.each([
    ['127.0.0.1:3910', 'http://127.0.0.1:3910', true], ['localhost:3910', undefined, true],
    ['127.0.0.1:3910', 'https://evil.test', false], ['evil.test:3910', undefined, false], ['127.0.0.1.evil.test', undefined, false], ['localhost:3910', 'null', false],
  ])('loopback host %s / origin %s', (host, origin, expected) => { expect(localRequestAllowed({ headers: { host, origin } } as IncomingMessage)).toBe(expected); });
});
