import { NETWORKS, READ_METHODS } from '../core/networks.js';
import { githubRawUrl } from '../core/source.js';
import { sourceSchema } from '../core/input.js';
import { record } from '../core/json.js';
import type { Collector, Evidence, Json, NetworkId, SourceRef } from '../core/types.js';

export async function boundedText(response: Response, limit = 2097152): Promise<string> {
  const advertised = Number(response.headers.get('content-length'));
  if (advertised > limit) { await response.body?.cancel(); throw new Error('Response exceeds the configured evidence size limit.'); }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      length += item.value.byteLength;
      if (length > limit) throw new Error('Response exceeds the configured evidence size limit.');
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
}
export class HttpCollector implements Collector {
  private nextId = 1;
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 15000) {}
  private async capture<T>(method: string, action: (signal: AbortSignal) => Promise<T>): Promise<Evidence<T>> {
    const started = Date.now(); const capturedAt = new Date().toISOString();
    try { const value = await action(AbortSignal.timeout(this.timeoutMs)); return { kind: 'ok', method, capturedAt, durationMs: Date.now() - started, value }; }
    catch (error) {
      const data = record(error);
      const unsupported = data.code === -32601;
      const timeout = data.name === 'TimeoutError' || data.name === 'AbortError';
      return { kind: 'error', method, capturedAt, durationMs: Date.now() - started, error: {
        category: unsupported ? 'unsupported' : timeout ? 'request_timeout' : data.code === -32001 ? 'not_found' : 'request_failed',
        message: error instanceof Error ? error.message.slice(0, 500) : 'Evidence request failed.',
        ...(typeof data.code === 'number' ? { code: data.code } : {}),
      } };
    }
  }
  rpc(network: NetworkId, method: string, params: Json[]): Promise<Evidence> {
    if (!READ_METHODS.has(method)) throw new Error('Only explicitly allowlisted read/diagnostic RPC methods can be called.');
    const id = this.nextId++;
    return this.capture(method, async signal => {
      const response = await this.fetcher(NETWORKS[network].rpc, { method: 'POST', redirect: 'error', credentials: 'omit', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
      if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}.`);
      const data = record(JSON.parse(await boundedText(response)));
      if (data.id !== id || data.jsonrpc !== '2.0') throw new Error('RPC response envelope does not match the request.');
      if (data.error) {
        const rpcError = record(data.error);
        throw Object.assign(new Error(String(rpcError.message ?? 'RPC error').slice(0, 500)), { code: rpcError.code });
      }
      if (!Object.hasOwn(data, 'result')) throw new Error('RPC omitted its result.');
      return data.result as Json;
    });
  }
  source(ref: SourceRef): Promise<Evidence<string>> {
    const pinned = sourceSchema.parse(ref);
    return this.capture('github.commit-pinned-source', async signal => {
      const response = await this.fetcher(githubRawUrl(pinned), { redirect: 'error', credentials: 'omit', signal });
      if (!response.ok) throw new Error(`Pinned public source returned HTTP ${response.status}; private repositories are not supported by this adapter.`);
      const source = await boundedText(response, 262144);
      if (!source.trim()) throw new Error('Pinned source is empty.');
      return source;
    });
  }
}
