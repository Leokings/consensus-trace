import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { caseSchema } from '../core/input.js';
import { buildBundle } from '../core/bundle.js';
import { RunStore } from '../server/store.js';
import { RunService } from '../server/service.js';
import { prepareTest, resolveSubmission, walletLaunchUrl } from '../core/execution.js';
import { HttpCollector } from '../adapters/http.js';

const store = new RunStore(resolve(process.env.TRACE_DATA_DIR ?? '.local', 'runs.sqlite'));
const service = new RunService(store);
const server = new McpServer({ name: 'consensus-trace', version: '0.2.0' });
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
server.registerTool('prepare_test', {
  description: 'Verify a public commit-pinned contract test and return a browser-wallet handoff URL. Does not sign or submit anything. Human review and wallet approval are mandatory; private keys and credentials are rejected.',
  inputSchema: { test: z.unknown() }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
}, async ({ test }) => { const prepared = await prepareTest(test, new HttpCollector(fetch, 8000, AbortSignal.timeout(40000))); return result({ prepared, walletLaunchUrl: prepared.status === 'READY' ? walletLaunchUrl(prepared.draft) : undefined, approvalRequired: true }); });
server.registerTool('resolve_submission', {
  description: 'Resolve an already-sent outer EVM hash to a bound GenLayer ID using public receipt evidence. Never resends, appeals, or finalizes. Supply the exact draft, sender, outerHash, encoded data and gas from the browser test record.',
  inputSchema: { submission: z.unknown() }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
}, async ({ submission }) => result(await resolveSubmission(submission, new HttpCollector(fetch, 8000, AbortSignal.timeout(40000)))));
server.registerTool('inspect_transaction', {
  description: 'Inspect an existing GenLayer transaction, compare a pinned PUBLIC GitHub source and assert current latest-final view values. Never signs, sends, appeals or finalizes. Saves a local report. Optional trace may replay execution.',
  inputSchema: { testCase: caseSchema },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
}, async ({ testCase }) => result((await service.inspect(testCase)).report));
server.registerTool('get_report', { description: 'Read a saved local Consensus Trace report.', inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true, openWorldHint: false } }, async ({ id }) => {
  const run = store.get(id); if (!run) return { ...result({ error: 'Report not found.' }), isError: true }; return result(run);
});
server.registerTool('list_reports', { description: 'List up to 50 saved local reports without including raw evidence.', inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false } }, async () => result(store.list().map(run => ({ id: run.id, name: run.input.name, status: run.status, conclusion: run.report?.conclusion, origin: run.report?.origin }))));
server.registerTool('evidence_manifest', { description: 'Compute a review-bundle manifest and ZIP hash for a saved report. Does not upload or publish anything.', inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true, openWorldHint: false } }, async ({ id }) => {
  const report = store.get(id)?.report; if (!report) return { ...result({ error: 'Completed report not found.' }), isError: true }; const bundle = buildBundle(report); return result({ manifest: bundle.manifest, zipSha256: bundle.sha256 });
});
await server.connect(new StdioServerTransport());
