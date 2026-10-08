import { randomUUID } from 'node:crypto';
import { abi } from 'genlayer-js';
import { parseCase } from './input.js';
import { NETWORKS } from './networks.js';
import { jsonSafe, record } from './json.js';
import { normalizeReceipt } from './receipt.js';
import { compareSource, decodeSource, githubFileUrl } from './source.js';
import { decodeCallDataEnvelope, evaluateAssertion } from './assertions.js';
import { diagnose } from './diagnose.js';
import { compareFrontend } from './frontend.js';
import type { Collector, Evidence, Json, TraceReport } from './types.js';

const { calldata, transactions } = abi;

export const skipped = <T = Json>(method: string, reason: string): Evidence<T> => ({ kind: 'skipped', method, reason });
function failed<T>(evidence: Evidence<unknown>, message: string): Evidence<T> {
  return { kind: 'error', method: evidence.method, capturedAt: evidence.kind !== 'skipped' ? evidence.capturedAt : new Date().toISOString(), durationMs: evidence.kind !== 'skipped' ? evidence.durationMs : 0, error: { category: 'decode_failed', message } };
}
function parsedChainId(evidence: Evidence): number | null {
  if (evidence.kind !== 'ok') return null;
  if (typeof evidence.value === 'string' && /^0x[0-9a-fA-F]{1,12}$/.test(evidence.value)) return Number(BigInt(evidence.value));
  return typeof evidence.value === 'number' && Number.isSafeInteger(evidence.value) ? evidence.value : null;
}

export async function inspectCase(rawInput: unknown, collector: Collector, options: { id?: string; parentId?: string; origin?: 'live' | 'fixture'; fixtureId?: string } = {}): Promise<TraceReport> {
  const input = parseCase(rawInput);
  const network = NETWORKS[input.network];
  const receiptMethod = network.studio ? 'eth_getTransactionByHash' : 'gen_getTransactionReceipt';
  const [chainId, receiptEvidence, lifecycle, pinnedSource] = await Promise.all([
    collector.rpc(input.network, 'eth_chainId', []),
    collector.rpc(input.network, receiptMethod, network.studio ? [input.transactionHash] : [{ txId: input.transactionHash }]),
    collector.rpc(input.network, 'gen_getTransactionLifecycle', [{ txId: input.transactionHash }]),
    input.source ? collector.source(input.source) : Promise.resolve(skipped<string>('github.commit-pinned-source', 'No pinned source reference was supplied.')),
  ]);
  const receipt = normalizeReceipt(receiptEvidence.kind === 'ok' ? receiptEvidence.value : null);
  const chainVerified = parsedChainId(chainId) === network.chainId;
  const transactionMatches = receipt.transactionHash?.toLowerCase() === input.transactionHash.toLowerCase();
  const recipientMatches = receipt.recipient?.toLowerCase() === input.contractAddress.toLowerCase();
  const bindingValid = chainVerified && transactionMatches && recipientMatches && receipt.found;
  let deployedCode: Evidence<string> = skipped('gen_getContractCode', 'Chain and transaction-to-contract binding must be verified first.');
  let schema: Evidence = skipped('gen_getContractSchema', 'Chain and transaction-to-contract binding must be verified first.');
  if (bindingValid) {
    const codeEvidence = await collector.rpc(input.network, 'gen_getContractCode', network.studio ? [input.contractAddress] : [{ address: input.contractAddress }]);
    if (codeEvidence.kind === 'ok') {
      try { deployedCode = { ...codeEvidence, value: decodeSource(codeEvidence.value) }; }
      catch (error) { deployedCode = failed(codeEvidence, error instanceof Error ? error.message : 'Contract source decode failed.'); }
    } else deployedCode = codeEvidence;
    schema = await collector.rpc(input.network, 'gen_getContractSchema', network.studio ? [input.contractAddress] : codeEvidence.kind === 'ok' ? [{ code: codeEvidence.value }] : [{ address: input.contractAddress }]);
  }
  const source: TraceReport['source'] = !input.source ? { comparison: 'NOT_REQUESTED' }
    : deployedCode.kind === 'ok' && pinnedSource.kind === 'ok' ? compareSource(deployedCode.value, pinnedSource.value) : { comparison: 'UNAVAILABLE' };
  const canRead = bindingValid && receipt.finalized && receipt.execution === 'SUCCESS' && receipt.inconsistencies.length === 0;
  const assertions = await Promise.all(input.assertions.map(async spec => {
    if (!canRead) return evaluateAssertion(spec, skipped('gen_call', 'A bound, finalized transaction with successful execution is required before application-state checks.'));
    let evidence: Evidence;
    try {
      const args = calldata.makeCalldataObject(spec.method, spec.args, undefined);
      const data = transactions.serialize([calldata.encode(args), false]);
      evidence = await collector.rpc(input.network, 'gen_call', [{ type: 'read', to: input.contractAddress, from: '0x0000000000000000000000000000000000000000', data, transaction_hash_variant: 'latest-final' }]);
      if (evidence.kind === 'ok') {
        try { evidence = { ...evidence, value: jsonSafe(calldata.decode(Buffer.from(decodeCallDataEnvelope(evidence.value), 'hex'))) }; }
        catch (error) { evidence = failed(evidence, error instanceof Error ? error.message : 'Read decoding failed.'); }
      }
    } catch (error) { evidence = failed(skipped('gen_call', ''), error instanceof Error ? error.message : 'Read encoding failed.'); }
    return evaluateAssertion(spec, evidence);
  }));
  const trace = input.includeTrace && bindingValid
    ? await collector.rpc(input.network, 'gen_dbg_traceTransaction', [{ txID: input.transactionHash, round: input.traceRound }])
    : skipped('gen_dbg_traceTransaction', input.includeTrace ? 'Transaction binding was not verified.' : 'Not requested: this endpoint may reconstruct a trace by replaying execution.');
  const report: TraceReport = {
    schemaVersion: 1, id: options.id ?? randomUUID(), parentId: options.parentId,
    origin: options.origin ?? 'live', fixtureId: options.fixtureId, createdAt: new Date().toISOString(), toolVersion: '0.2.0', sdkVersion: '1.1.8', input,
    network: { id: network.id, chainId: network.chainId, rpc: network.rpc, explorer: network.explorer, chainVerified },
    identity: { transactionMatches, recipientMatches },
    observations: { chainId, receipt: receiptEvidence, lifecycle, deployedCode, pinnedSource, schema, trace }, receipt, source, assertions,
    findings: [], conclusion: 'INCOMPLETE',
    ...(input.frontend ? { frontend: compareFrontend(input, assertions) } : {}),
    links: { contract: `${network.explorer}/address/${input.contractAddress}`, transaction: `${network.explorer}/tx/${input.transactionHash}`, ...(input.source ? { source: githubFileUrl(input.source) } : {}) },
    limitations: [
      'This is read-only verification of an existing transaction. No deployment, write, appeal or finalize command is sent.',
      'latest-final reads observe current finalized state, not historical state at this transaction. A passing assertion does not prove this transaction caused the observed value.',
      'Source comparisons observe currently deployed code; transaction-time code provenance is not independently proven.',
      'RPC observations and hashes are evidence and integrity checks, not independent cryptographic proof of chain truth.',
      'Missing provider logs cannot establish that prompt complexity or a particular model caused a timeout.',
      'Frontend comparisons use supplied captures of equivalent reads. They do not authenticate a third-party UI. Missing reads, old captures and different read identities are not stale-UI proof.',
      'A debug trace may be replay-reconstructed; this adapter cannot independently distinguish an original trace from a replay.',
    ],
  };
  if (report.origin === 'fixture') report.limitations.unshift('SYNTHETIC FIXTURE: this report demonstrates diagnostics. It is not a live network test or submission proof.');
  report.findings = diagnose(report);
  report.conclusion = report.findings.some(finding => finding.severity === 'error') ? 'ISSUES_FOUND'
    : bindingValid && receipt.finalized && receipt.execution === 'SUCCESS' && source.comparison === 'EXACT' && assertions.length > 0 && assertions.every(assertion => assertion.status === 'PASS') ? 'CHECKS_PASSED' : 'INCOMPLETE';
  return report;
}

export function lifecycleProjection(report: TraceReport): Record<string, unknown> {
  return report.observations.lifecycle.kind === 'ok' ? record(report.observations.lifecycle.value) : {};
}
