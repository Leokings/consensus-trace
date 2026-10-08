import { z } from 'zod';
import { assertComplexity } from './bounds.js';
import { assertionSchema, caseSchema, parseCase } from './input.js';
import { canonicalJson } from './json.js';
import { NETWORKS } from './networks.js';
import { normalizeReceipt } from './receipt.js';
import { compareSource } from './source.js';
import { evaluateAssertion } from './assertions.js';
import type { RunRecord, TraceReport } from './types.js';

const text = z.string().max(300000);
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)), 'Invalid timestamp.');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const evidence = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ok'), method: text, capturedAt: timestamp, durationMs: z.number().nonnegative(), value: z.json() }).strict(),
  z.object({ kind: z.literal('error'), method: text, capturedAt: timestamp, durationMs: z.number().nonnegative(), error: z.object({ category: text, message: text, code: z.number().int().optional() }).strict() }).strict(),
  z.object({ kind: z.literal('skipped'), method: text, reason: text }).strict(),
]);
const vote = z.enum(['AGREE', 'DISAGREE', 'TIMEOUT', 'DETERMINISTIC_VIOLATION', 'NOT_VOTED', 'UNKNOWN']);
const count = z.number().int().nonnegative();
const round = z.object({ round: text, validators: z.array(z.object({ address: text, vote }).strict()).max(4096), counts: z.object({ AGREE: count, DISAGREE: count, TIMEOUT: count, DETERMINISTIC_VIOLATION: count, NOT_VOTED: count, UNKNOWN: count }).strict(), result: text.nullable() }).strict();
const reportSchema = z.object({
  schemaVersion: z.literal(1), id: z.uuid(), parentId: z.uuid().optional(), origin: z.enum(['live', 'fixture']), fixtureId: z.string().max(40).optional(),
  createdAt: timestamp, toolVersion: z.literal('0.1.0'), sdkVersion: z.literal('1.1.8'), input: caseSchema,
  network: z.object({ id: z.enum(['studionet', 'bradbury', 'localnet']), chainId: z.number().int(), rpc: text, explorer: text, chainVerified: z.boolean() }).strict(),
  identity: z.object({ transactionMatches: z.boolean(), recipientMatches: z.boolean() }).strict(),
  observations: z.object({ chainId: evidence, receipt: evidence, lifecycle: evidence, deployedCode: evidence, pinnedSource: evidence, schema: evidence, trace: evidence }).strict(),
  receipt: z.object({ found: z.boolean(), storedStatus: text, statusCode: z.number().int().nullable(), finalized: z.boolean(), execution: z.enum(['SUCCESS', 'ERROR', 'TIMEOUT', 'NONDET_DISAGREE', 'DETERMINISTIC_VIOLATION', 'UNKNOWN']), executionBasis: text, transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).nullable(), recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable(), rounds: z.array(round).max(256), inconsistencies: z.array(text).max(512) }).strict(),
  source: z.object({ comparison: z.enum(['EXACT', 'LINE_ENDINGS_ONLY', 'MISMATCH', 'UNAVAILABLE', 'NOT_REQUESTED']), deployedSha256: digest.optional(), pinnedSha256: digest.optional(), deployedLfSha256: digest.optional(), pinnedLfSha256: digest.optional() }).strict(),
  assertions: z.array(z.object({ spec: assertionSchema, evidence, stateVariant: z.literal('latest-final'), status: z.enum(['PASS', 'FAIL', 'UNAVAILABLE', 'SKIPPED']), actual: z.json().optional(), reason: text }).strict()).max(8),
  findings: z.array(z.object({ code: text, severity: z.enum(['error', 'warning', 'info']), certainty: z.enum(['observed', 'limitation']), title: text, detail: text, evidencePaths: z.array(text).max(64), nextCheck: text }).strict()).max(256),
  conclusion: z.enum(['CHECKS_PASSED', 'ISSUES_FOUND', 'INCOMPLETE']), links: z.object({ contract: text, transaction: text, source: text.optional() }).strict(),
  limitations: z.array(text).max(64), redaction: z.object({ applied: z.boolean(), replacements: count, note: text }).strict().optional(),
}).strict();

/** Validate untrusted API/storage data before rendering or exporting it. Not chain authentication. */
export function parseReport(value: unknown, expected?: Pick<RunRecord, 'id' | 'input' | 'parentId' | 'fixtureId'>, origin?: TraceReport['origin']): TraceReport {
  assertComplexity(value);
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) throw new Error('The report has an unsupported or damaged format.');
  const report = parsed.data as TraceReport;
  report.input = parseCase(report.input);
  if (expected && (report.id !== expected.id || report.parentId !== expected.parentId || report.fixtureId !== expected.fixtureId || canonicalJson(report.input) !== canonicalJson(parseCase(expected.input))) || origin && report.origin !== origin) throw new Error('Returned report is not bound to the complete requested input and identity.');
  const network = NETWORKS[report.input.network];
  const normalized = normalizeReceipt(report.observations.receipt.kind === 'ok' ? report.observations.receipt.value : null);
  if (canonicalJson(report.receipt) !== canonicalJson(normalized)) throw new Error('Report receipt summary does not match its captured observation.');
  const transactionMatches = normalized.transactionHash?.toLowerCase() === report.input.transactionHash.toLowerCase();
  const recipientMatches = normalized.recipient?.toLowerCase() === report.input.contractAddress.toLowerCase();
  const chainValue = report.observations.chainId.kind === 'ok' ? report.observations.chainId.value : null;
  const chainId = typeof chainValue === 'string' && /^0x[0-9a-fA-F]{1,12}$/.test(chainValue) ? Number(BigInt(chainValue)) : chainValue;
  if (report.network.chainVerified !== (chainId === network.chainId) || report.identity.transactionMatches !== transactionMatches || report.identity.recipientMatches !== recipientMatches) throw new Error('Report identity summaries disagree with the captured observations.');
  const expectedLinks = { contract: `${network.explorer}/address/${report.input.contractAddress}`, transaction: `${network.explorer}/tx/${report.input.transactionHash}`, ...(report.input.source ? { source: `https://github.com/${report.input.source.repository}/blob/${report.input.source.commit}/${report.input.source.path}` } : {}) };
  if (report.network.id !== network.id || report.network.chainId !== network.chainId || report.network.rpc !== network.rpc || report.network.explorer !== network.explorer || canonicalJson(report.links) !== canonicalJson(expectedLinks)) throw new Error('Report network or evidence links do not match the requested case.');
  if (canonicalJson(report.assertions.map(item => item.spec)) !== canonicalJson(report.input.assertions)) throw new Error('Report assertions do not match the complete requested input.');
  if (report.receipt.finalized !== (report.receipt.storedStatus === 'FINALIZED')) throw new Error('Report finality fields disagree.');
  for (const entry of report.receipt.rounds) for (const key of vote.options) if (entry.counts[key] !== entry.validators.filter(item => item.vote === key).length) throw new Error('Report validator counts disagree.');
  for (const key of ['deployedCode', 'pinnedSource'] as const) if (report.observations[key].kind === 'ok' && typeof report.observations[key].value !== 'string') throw new Error('Report source text is malformed.');
  if (!report.redaction?.applied) {
    const deployed = report.observations.deployedCode; const pinned = report.observations.pinnedSource;
    const comparison = !report.input.source ? { comparison: 'NOT_REQUESTED' } : deployed.kind === 'ok' && pinned.kind === 'ok' ? compareSource(deployed.value, pinned.value) : { comparison: 'UNAVAILABLE' };
    if (canonicalJson(report.source) !== canonicalJson(comparison)) throw new Error('Report source hashes do not match the captured text.');
    for (const assertion of report.assertions) if (canonicalJson(assertion) !== canonicalJson(evaluateAssertion(assertion.spec, assertion.evidence))) throw new Error('Report assertion results do not match the captured reads.');
  }
  const errors = report.findings.some(item => item.severity === 'error');
  if ((report.conclusion === 'ISSUES_FOUND') !== errors || report.conclusion === 'CHECKS_PASSED' && (!report.network.chainVerified || !report.identity.transactionMatches || !report.identity.recipientMatches || !report.receipt.found || !report.receipt.finalized || report.receipt.execution !== 'SUCCESS' || report.receipt.inconsistencies.length > 0 || !report.input.source || report.source.comparison !== 'EXACT' || !report.source.deployedSha256 || report.source.deployedSha256 !== report.source.pinnedSha256 || report.assertions.length === 0 || report.assertions.some(item => item.status !== 'PASS'))) throw new Error('Report conclusion is inconsistent with its recorded checks.');
  return report;
}
