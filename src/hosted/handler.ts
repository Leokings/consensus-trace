import { z } from 'zod';
import { HttpCollector } from '../adapters/http.js';
import { CaseInputError, parseCase } from '../core/input.js';
import { assertComplexity } from '../core/bounds.js';
import { assertBundleFits, EvidenceBundleLimitError } from '../core/bundle.js';
import { inspectCase } from '../core/inspect.js';
import { NETWORKS } from '../core/networks.js';
import { redactReport } from '../core/redact.js';
import type { Collector } from '../core/types.js';
import { FIXTURES, FixtureCollector, fixtureCase } from '../fixtures/index.js';

const MAX_REQUEST = 65536;
const MAX_RESPONSE = 4000000;
const envelopeSchema = z.object({ id: z.uuid(), parentId: z.uuid().optional(), fixtureId: z.string().min(1).max(40).optional(), input: z.unknown().optional() }).strict().refine(value => (value.fixtureId !== undefined) !== (value.input !== undefined), 'Supply exactly one fixture or live input.');
export function hostedConfig() {
  return { version: '0.1.0', readOnly: true, storage: 'browser' as const, tracesEnabled: false,
    networks: Object.values(NETWORKS).filter(network => network.id !== 'localnet'),
    fixtures: FIXTURES.map(fixture => ({ ...fixture, input: fixtureCase(fixture.id) })),
    notice: 'Reports are saved only in this browser. Public API requests contain the case you submit; local SQLite history is never uploaded.',
  };
}
function response(status: number, value: unknown, extra: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });
}
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  return (!origin || origin === new URL(request.url).origin) && (!site || site === 'same-origin' || site === 'none');
}
async function requestBody(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new CaseInputError('Use application/json.');
  if (Number(request.headers.get('content-length')) > MAX_REQUEST) throw new CaseInputError('Hosted request exceeds 64 KiB.');
  const reader = request.body?.getReader(); if (!reader) throw new CaseInputError('A JSON body is required.');
  const chunks: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => undefined); reject(new CaseInputError('JSON body was not received within five seconds.')); }, 5000); });
  try { while (true) { const item = await Promise.race([reader.read(), deadline]); if (item.done) break; size += item.value.length; if (size > MAX_REQUEST) throw new CaseInputError('Hosted request exceeds 64 KiB.'); chunks.push(item.value); } }
  finally { clearTimeout(timer); await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); assertComplexity(body, 24, 4096); }
  catch { throw new CaseInputError('Hosted request must contain valid bounded JSON; it may be too deeply nested or complex.'); }
  return body;
}

/** Best-effort instance guard, not a distributed quota. No durable user/session data. */
export class AdmissionGate {
  private active = 0;
  private readonly windows = new Map<string, { start: number; count: number }>();
  enter(key: string, now = Date.now()): (() => void) | null {
    for (const [ip, window] of this.windows) if (now - window.start >= 60000) this.windows.delete(ip);
    if (this.active >= 3 || this.windows.size >= 2048 && !this.windows.has(key)) return null;
    const window = this.windows.get(key) ?? { start: now, count: 0 };
    if (window.count >= 6) return null;
    window.count++; this.windows.set(key, window); this.active++;
    let released = false; return () => { if (!released) { released = true; this.active--; } };
  }
}
const gate = new AdmissionGate();
export async function handleInspection(request: Request, options: { collector?: Collector; gate?: AdmissionGate; log?: (record: object) => void } = {}): Promise<Response> {
  if (request.method !== 'POST') return response(405, { error: 'Use POST.' }, { allow: 'POST' });
  if (!sameOrigin(request)) return response(403, { error: 'Cross-origin inspection requests are not allowed.' });
  let release: (() => void) | null = null; const started = Date.now(); let inspectionId: string | undefined;
  const log = options.log ?? (entry => console.info(JSON.stringify(entry)));
  try {
    const key = (request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim().slice(0, 64);
    release = (options.gate ?? gate).enter(key);
    if (!release) return response(429, { error: 'Inspection limit reached. Wait a minute before trying again.' }, { 'retry-after': '60' });
    const envelope = envelopeSchema.parse(await requestBody(request)); inspectionId = envelope.id;
    if (envelope.fixtureId && !FIXTURES.some(item => item.id === envelope.fixtureId)) throw new CaseInputError('Unknown diagnostic fixture.');
    const input = envelope.fixtureId ? fixtureCase(envelope.fixtureId) : parseCase(envelope.input);
    if (input.network === 'localnet') return response(400, { error: 'Localnet is available only in the local workbench.' });
    if (input.includeTrace) return response(400, { error: 'Replay-capable debug traces are disabled on the public site. Use the local CLI for an explicitly requested trace.' });
    const deadline = AbortSignal.timeout(40000); const signal = AbortSignal.any([deadline, request.signal]);
    const report = redactReport(await inspectCase(input, envelope.fixtureId ? new FixtureCollector(envelope.fixtureId) : options.collector ?? new HttpCollector(fetch, 8000, signal),
      { id: envelope.id, parentId: envelope.parentId, origin: envelope.fixtureId ? 'fixture' : 'live', fixtureId: envelope.fixtureId }));
    if (signal.aborted) { log({ event: 'inspection_timed_out', inspectionId, durationMs: Date.now() - started }); return response(504, { error: 'Inspection exceeded its collection deadline or the request was canceled. The transaction was not resubmitted; retry a fresh read-only snapshot.' }); }
    report.limitations.push('Hosted history is browser-local and may be cleared by browser settings. The hosted API does not store or share a history of your reports.', 'Public-site request/concurrency limits are per function instance, not a globally distributed rate limit. Replay-capable traces and localnet are disabled.');
    const serialized = JSON.stringify({ report });
    if (new TextEncoder().encode(serialized).length > MAX_RESPONSE) return response(413, { error: 'Collected evidence exceeds the hosted response limit. Inspect this case with the local CLI.' });
    assertBundleFits(report);
    log({ event: 'inspection_complete', inspectionId, origin: report.origin, conclusion: report.conclusion, durationMs: Date.now() - started });
    return new Response(serialized, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch (error) {
    const validation = error instanceof z.ZodError || error instanceof CaseInputError;
    if (error instanceof EvidenceBundleLimitError) return response(413, { error: 'Collected evidence is too large to export. Use the local CLI with a smaller case.' });
    const entry = { event: validation ? 'inspection_rejected' : 'inspection_failed', inspectionId, validation, durationMs: Date.now() - started };
    if (validation || options.log) log(entry); else console.error(JSON.stringify(entry));
    return response(validation ? 400 : 500, { error: error instanceof CaseInputError ? error.message : validation ? 'Invalid inspection input. Check the identifiers, full source commit, and assertion fields.' : 'The inspection service encountered an internal error. Retry a fresh read-only snapshot; no transaction was sent.' });
  } finally { release?.(); }
}
