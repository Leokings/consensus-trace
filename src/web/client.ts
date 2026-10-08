import { parseCase } from '../core/input.js';
import type { NetworkId, RunRecord, TraceCase, TraceReport } from '../core/types.js';
import { BrowserRunStore } from './storage.js';

export interface Config {
  fixtures: { id: string; title: string; detail: string; input?: TraceCase }[];
  networks: { id: NetworkId; name: string; chainId: number }[];
  storage?: 'browser'; tracesEnabled?: boolean; notice?: string;
}
let configuration: Config | undefined;
let browserStore: BrowserRunStore | undefined;
export function configureClient(settings: Config, store?: BrowserRunStore) {
  configuration = settings; if (settings.storage === 'browser') browserStore = store ?? new BrowserRunStore();
}
async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init); let data: unknown;
  try { data = await response.json(); } catch { throw new Error(`The inspection API returned an unreadable response (${response.status}).`); }
  if (!response.ok) throw new Error(data && typeof data === 'object' && 'error' in data ? String(data.error) : `Request failed (${response.status}).`);
  return data as T;
}
async function startBrowserInspection(input: unknown, options: { fixtureId?: string; parentId?: string } = {}): Promise<RunRecord> {
  if (!browserStore) throw new Error('Browser history is not initialized.');
  const store = browserStore;
  const fixtureInput = options.fixtureId ? configuration?.fixtures.find(item => item.id === options.fixtureId)?.input : undefined;
  const parsed = parseCase(options.fixtureId ? fixtureInput : input);
  const run: RunRecord = { id: crypto.randomUUID(), parentId: options.parentId, fixtureId: options.fixtureId, createdAt: new Date().toISOString(), status: 'collecting', input: parsed };
  // Persist the transaction before starting work. A reload never resubmits a chain transaction.
  await store.save(run);
  void (async () => {
    try {
      const result = await fetchJson<{ report: TraceReport }>('/api/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(55000),
        body: JSON.stringify({ id: run.id, parentId: options.parentId, fixtureId: options.fixtureId, ...(!options.fixtureId ? { input: parsed } : {}) }) });
      if (result.report.id !== run.id || result.report.input.transactionHash !== run.input.transactionHash || result.report.input.contractAddress.toLowerCase() !== run.input.contractAddress.toLowerCase() || result.report.input.network !== run.input.network || result.report.origin !== (options.fixtureId ? 'fixture' : 'live')) throw new Error('Returned report identity does not match this inspection.');
      await store.save({ ...run, status: 'complete', report: result.report });
    } catch (failure) {
      await store.save({ ...run, status: 'interrupted', failure: failure instanceof Error ? failure.message : 'Inspection could not be completed.' }).catch(() => undefined);
    }
  })();
  return run;
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (path === '/api/config') return fetchJson<T>(path, init);
  if (configuration?.storage !== 'browser') return fetchJson<T>(path, init);
  if (!browserStore) throw new Error('Browser history is unavailable.');
  const method = init?.method ?? 'GET';
  if (method === 'GET' && path === '/api/runs') return await browserStore.list() as T;
  if (method === 'POST' && (path === '/api/runs' || path === '/api/fixtures')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { fixtureId?: string };
    return await startBrowserInspection(body, path === '/api/fixtures' ? { fixtureId: body.fixtureId } : {}) as T;
  }
  const match = path.match(/^\/api\/runs\/([a-f0-9-]{36})(\/refresh)?$/);
  if (match) {
    const run = await browserStore.get(match[1]); if (!run) throw new Error('Report was not found in this browser.');
    if (method === 'GET' && !match[2]) return run as T;
    if (method === 'POST' && match[2]) return await startBrowserInspection(run.input, { parentId: run.id, fixtureId: run.fixtureId }) as T;
  }
  throw new Error('Unsupported hosted workbench operation.');
}
