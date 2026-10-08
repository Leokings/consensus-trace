import { describe, expect, it } from 'vitest';
import { FixtureCollector, fixtureCase, FIXTURES } from '../src/fixtures/index.js';
import { inspectCase } from '../src/core/inspect.js';
import { normalizeReceipt } from '../src/core/receipt.js';
import { parseCase } from '../src/core/input.js';
import { compareSource, decodeSource } from '../src/core/source.js';
import { atPointer, evaluateAssertion } from '../src/core/assertions.js';
import { canonicalJson, jsonSafe } from '../src/core/json.js';
import type { AssertionSpec, Collector, Evidence, Json } from '../src/core/types.js';

const ok = (value: Json): Evidence => ({ kind: 'ok', method: 'fixture', capturedAt: '2026-10-08T00:00:00Z', durationMs: 0, value });
class OverrideCollector extends FixtureCollector {
  calls: string[] = [];
  constructor(private readonly overrides: Record<string, Evidence> = {}) { super('successful'); }
  override async rpc(network: string, method: string, params: Json[]) { this.calls.push(method); return this.overrides[method] ?? super.rpc(network, method, params); }
}

describe('inspection diagnostics', () => {
  it.each(FIXTURES.map(item => item.id))('keeps %s clearly synthetic', async id => {
    const report = await inspectCase(fixtureCase(id), new FixtureCollector(id), { origin: 'fixture', fixtureId: id });
    expect(report.origin).toBe('fixture'); expect(report.limitations[0]).toContain('SYNTHETIC');
    expect(report.identity.transactionMatches).toBe(true); expect(report.identity.recipientMatches).toBe(true);
  });
  it('passes only the complete requested layers', async () => {
    const report = await inspectCase(fixtureCase('successful'), new FixtureCollector('successful'));
    expect(report.conclusion).toBe('CHECKS_PASSED'); expect(report.source.comparison).toBe('EXACT'); expect(report.assertions.every(item => item.status === 'PASS')).toBe(true);
  });
  it('does not call finalized execution errors successful', async () => {
    const collector = new FixtureCollector('execution-error'); const report = await inspectCase(fixtureCase('execution-error'), collector);
    expect(report.receipt.finalized).toBe(true); expect(report.receipt.execution).toBe('ERROR'); expect(report.conclusion).toBe('ISSUES_FOUND');
    expect(report.assertions.every(item => item.status === 'SKIPPED')).toBe(true);
  });
  it('reports source mismatch', async () => { const report = await inspectCase(fixtureCase('source-mismatch'), new FixtureCollector('source-mismatch')); expect(report.findings.map(item => item.code)).toContain('SOURCE_MISMATCH'); });
  it('reports application assertion failure despite consensus success', async () => { const report = await inspectCase(fixtureCase('assertion-failure'), new FixtureCollector('assertion-failure')); expect(report.receipt.execution).toBe('SUCCESS'); expect(report.findings.map(item => item.code)).toContain('ASSERTION_FAILED'); });
  it('never calls an unavailable read a stale frontend', async () => { const report = await inspectCase(fixtureCase('read-unavailable'), new FixtureCollector('read-unavailable')); expect(report.findings.map(item => item.code)).toContain('FINALIZED_READ_UNAVAILABLE'); expect(report.findings.map(item => item.code)).not.toContain('STALE_FRONTEND'); expect(report.conclusion).toBe('INCOMPLETE'); });
  it('keeps finalization action separate from finalization', async () => { const report = await inspectCase(fixtureCase('pending'), new FixtureCollector('pending')); expect(report.receipt.finalized).toBe(false); expect(report.findings.map(item => item.code)).toContain('FINALIZATION_ACTION_AVAILABLE'); expect(report.conclusion).toBe('INCOMPLETE'); });
  it('does not infer the cause of protocol timeouts', async () => { const report = await inspectCase(fixtureCase('validator-timeout'), new FixtureCollector('validator-timeout')); const finding = report.findings.find(item => item.code === 'PROTOCOL_TIMEOUT'); expect(finding?.detail).toContain('cause is not established'); expect(report.receipt.rounds[0].counts.TIMEOUT).toBe(3); });
  it('blocks state/code reads on wrong chain identity', async () => { const collector = new OverrideCollector({ eth_chainId: ok('0x1') }); const report = await inspectCase(fixtureCase('successful'), collector); expect(report.conclusion).toBe('ISSUES_FOUND'); expect(collector.calls).not.toContain('gen_call'); expect(collector.calls).not.toContain('gen_getContractCode'); });
  it('blocks reads if a receipt belongs to another contract', async () => {
    const input = fixtureCase('successful'); const collector = new OverrideCollector({ gen_getTransactionReceipt: ok({ id: input.transactionHash, recipient: `0x${'33'.repeat(20)}`, status: 7, txExecutionResult: 1 }) });
    const report = await inspectCase(input, collector); expect(report.findings.map(item => item.code)).toContain('CONTRACT_BINDING_MISMATCH'); expect(collector.calls).not.toContain('gen_call');
  });
  it('blocks reads if a receipt belongs to another transaction', async () => {
    const input = fixtureCase('successful'); const collector = new OverrideCollector({ gen_getTransactionReceipt: ok({ id: `0x${'33'.repeat(32)}`, recipient: input.contractAddress, status: 7, txExecutionResult: 1 }) });
    const report = await inspectCase(input, collector); expect(report.findings.map(item => item.code)).toContain('TRANSACTION_ID_MISMATCH'); expect(collector.calls).not.toContain('gen_call');
  });
  it('keeps missing receipt identity unknown instead of assuming a match', async () => {
    const input = fixtureCase('successful'); const collector = new OverrideCollector({ gen_getTransactionReceipt: ok({ recipient: input.contractAddress, status: 7, txExecutionResult: 1 }) });
    const report = await inspectCase(input, collector); expect(report.identity.transactionMatches).toBe(false); expect(collector.calls).not.toContain('gen_call');
  });
  it('keeps client request timeout separate from protocol timeout', async () => {
    const collector = new OverrideCollector({ gen_getTransactionReceipt: { kind: 'error', method: 'gen_getTransactionReceipt', capturedAt: '', durationMs: 15000, error: { category: 'request_timeout', message: 'Request deadline reached.' } } });
    const report = await inspectCase(fixtureCase('successful'), collector); expect(report.findings.map(item => item.code)).toContain('CLIENT_REQUEST_TIMEOUT'); expect(report.findings.map(item => item.code)).not.toContain('PROTOCOL_TIMEOUT');
  });
  it('does not claim a passed test when no assertions or source were supplied', async () => {
    const input = fixtureCase('successful'); input.assertions = []; delete input.source;
    const report = await inspectCase(input, new FixtureCollector('successful')); expect(report.conclusion).toBe('INCOMPLETE'); expect(report.findings.map(item => item.code)).toContain('NO_ASSERTIONS'); expect(report.findings.map(item => item.code)).toContain('SOURCE_UNVERIFIED');
  });
  it('does not request a replay trace by default', async () => { const collector = new OverrideCollector(); await inspectCase(fixtureCase('successful'), collector); expect(collector.calls).not.toContain('gen_dbg_traceTransaction'); });
  it('labels explicitly requested trace provenance unknown', async () => {
    const collector = new OverrideCollector({ gen_dbg_traceTransaction: ok({ result_code: 2 }) }); const input = fixtureCase('successful'); input.includeTrace = true;
    const report = await inspectCase(input, collector); expect(report.receipt.execution).toBe('SUCCESS'); expect(report.findings.map(item => item.code)).toContain('TRACE_PROVENANCE_UNVERIFIED');
  });
  it('always pins reads to latest-final', async () => {
    const fixture = new FixtureCollector('successful'); const variants: unknown[] = [];
    const collector: Collector = { source: ref => fixture.source(ref), rpc: async (network, method, params) => { if (method === 'gen_call') variants.push((params[0] as Record<string, Json>).transaction_hash_variant); return fixture.rpc(network, method, params); } };
    await inspectCase(fixtureCase('successful'), collector); expect(variants).toEqual(['latest-final', 'latest-final']);
  });
});

describe('raw receipt normalization', () => {
  it.each([[1, 'SUCCESS'], [2, 'ERROR'], [3, 'TIMEOUT'], [4, 'NONDET_DISAGREE'], [5, 'DETERMINISTIC_VIOLATION'], [99, 'UNKNOWN']] as const)('execution code %i -> %s', (code, expected) => { expect(normalizeReceipt({ status: 7, txExecutionResult: code }).execution).toBe(expected); });
  it('ignores quorum-cancelled validator receipts mixed into Studio leader_receipt', () => {
    expect(normalizeReceipt({ status: 7, consensus_data: { leader_receipt: [{ mode: 'leader', execution_result: 'SUCCESS' }, { mode: 'validator', execution_result: 'ERROR', vote: 'idle' }] } }).execution).toBe('SUCCESS');
  });
  it('does not infer execution from a consensus result field', () => { expect(normalizeReceipt({ status: 7, result: 1 }).execution).toBe('UNKNOWN'); });
  it('refuses to pick a winner among conflicting leader outcomes', () => { expect(normalizeReceipt({ status: 7, consensus_data: { leader_receipt: [{ mode: 'leader', execution_result: 'SUCCESS' }, { mode: 'leader', execution_result: 'ERROR' }] } }).execution).toBe('UNKNOWN'); });
  it('decodes base64 vote bytes, including missing and unknown votes', () => {
    const normalized = normalizeReceipt({ status: 7, roundData: [{ validatorVotes: Buffer.from([1, 2, 3, 4, 0, 99]).toString('base64'), roundValidators: [] }] });
    expect(normalized.rounds[0].counts).toEqual({ AGREE: 1, DISAGREE: 1, TIMEOUT: 1, DETERMINISTIC_VIOLATION: 1, NOT_VOTED: 1, UNKNOWN: 1 });
  });
  it('preserves idle Studio votes as not-voted, not as agreement', () => { expect(normalizeReceipt({ status: 'FINALIZED', consensus_data: { votes: { a: 'agree', b: 'idle' } } }).rounds[0].counts.NOT_VOTED).toBe(1); });
  it('does not invent votes', () => { expect(normalizeReceipt({ status: 7 }).rounds).toEqual([]); });
  it('does not classify an uninitialized receipt as found', () => { expect(normalizeReceipt({ status: 0 }).found).toBe(false); });
  it('does not trust a finalized name contradicting a pending status code', () => { const receipt = normalizeReceipt({ status: 1, statusName: 'Finalized', txExecutionResult: 1 }); expect(receipt.finalized).toBe(false); expect(receipt.inconsistencies).toHaveLength(1); });
  it('does not trust a success name contradicting an error execution code', () => { const receipt = normalizeReceipt({ status: 7, txExecutionResult: 2, txExecutionResultName: 'FinishedWithReturn' }); expect(receipt.execution).toBe('UNKNOWN'); expect(receipt.inconsistencies).toHaveLength(1); });
});

describe('input and source bounds', () => {
  it('applies safe defaults', () => { const input = fixtureCase('successful'); const { includeTrace: _trace, ...rest } = input; expect(parseCase(rest).includeTrace).toBe(false); });
  it.each(['main', 'a'.repeat(39), 'a'.repeat(41), 'z'.repeat(40)])('rejects unpinned commit %s', commit => { const input = fixtureCase('successful'); input.source!.commit = commit; expect(() => parseCase(input)).toThrow(); });
  it.each(['../keys', '/secret', 'a/../b', 'a//b', 'file%2fsecret', 'https://evil.test/x'])('rejects unsafe source path %s', path => { const input = fixtureCase('successful'); input.source!.path = path; expect(() => parseCase(input)).toThrow(); });
  it('rejects arbitrary RPC destinations and signing properties', () => { expect(() => parseCase({ ...fixtureCase('successful'), rpc: 'http://internal', privateKey: 'secret' })).toThrow(); });
  it('rejects duplicate assertion labels', () => { const input = fixtureCase('successful'); input.assertions[1].label = input.assertions[0].label; expect(() => parseCase(input)).toThrow(); });
  it('rejects too many assertions', () => { const input = fixtureCase('successful'); input.assertions = Array.from({ length: 9 }, (_, i) => ({ ...input.assertions[0], label: String(i) })); expect(() => parseCase(input)).toThrow(); });
  it('requires expected values except for exists', () => { const input = fixtureCase('successful'); delete input.assertions[0].expected; expect(() => parseCase(input)).toThrow(); input.assertions[0].operator = 'exists'; expect(() => parseCase(input)).not.toThrow(); });
  it('distinguishes exact hashes and line-ending matches', () => { expect(compareSource('a\n', 'a\n').comparison).toBe('EXACT'); expect(compareSource('a\r\n', 'a\n').comparison).toBe('LINE_ENDINGS_ONLY'); expect(compareSource('a\n', 'b\n').comparison).toBe('MISMATCH'); });
  it('preserves a UTF-8 BOM rather than hiding a byte mismatch', () => { const source = '\uFEFFclass X: pass\n'; expect(decodeSource(Buffer.from(source).toString('base64'))).toBe(source); expect(compareSource(source, source.slice(1)).comparison).toBe('MISMATCH'); });
  it('rejects invalid base64 source', () => { expect(() => decodeSource('invalid%%%')).toThrow(); expect(() => decodeSource('')).toThrow(); });
  it('rejects invalid UTF-8 source', () => { expect(() => decodeSource(Buffer.from([255]).toString('base64'))).toThrow(); });
});

describe('bounded assertions and serialization', () => {
  const spec: AssertionSpec = { label: 'x', method: 'get_x', args: [], pointer: '', operator: 'equals', expected: 1, parseJson: false };
  it('does not coerce strings into numbers for equality', () => { expect(evaluateAssertion(spec, ok('1')).status).toBe('FAIL'); });
  it('supports JSON pointer escape rules', () => { expect(atPointer({ 'a/b': { '~key': 2 } }, '/a~1b/~0key').value).toBe(2); });
  it('does not walk prototypes', () => { expect(atPointer({}, '/constructor').found).toBe(false); expect(atPointer({}, '/__proto__/x').found).toBe(false); });
  it('does not treat a missing path as an existing null', () => { expect(evaluateAssertion({ ...spec, pointer: '/absent', operator: 'exists' }, ok({})).status).toBe('FAIL'); expect(evaluateAssertion({ ...spec, pointer: '/present', operator: 'exists' }, ok({ present: null })).status).toBe('PASS'); });
  it('preserves large integer comparisons exactly', () => { expect(evaluateAssertion({ ...spec, operator: 'gte', expected: '999999999999999999999999' }, ok('1000000000000000000000000')).status).toBe('PASS'); });
  it('reports unsupported numeric comparisons unavailable', () => { expect(evaluateAssertion({ ...spec, operator: 'gte' }, ok('oops')).status).toBe('UNAVAILABLE'); });
  it('parses stringified JSON only with explicit opt-in', () => { expect(evaluateAssertion({ ...spec, parseJson: true, pointer: '/x' }, ok('{"x":1}')).status).toBe('PASS'); expect(evaluateAssertion({ ...spec, parseJson: true }, ok('{broken')).status).toBe('UNAVAILABLE'); });
  it('supports bounded contains', () => { expect(evaluateAssertion({ ...spec, operator: 'contains', expected: 'a' }, ok(['a', 'b'])).status).toBe('PASS'); });
  it('serializes maps, bigint and byte arrays safely', () => { expect(jsonSafe(new Map([['x', 1n]]))).toEqual({ x: '1' }); expect(jsonSafe(new Uint8Array([255]))).toBe('0xff'); expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}'); });
});
