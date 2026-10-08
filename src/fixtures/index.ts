import { abi } from 'genlayer-js';
import type { Collector, Evidence, Json, SourceRef, TraceCase } from '../core/types.js';

const { calldata } = abi;

const ADDRESS = `0x${'12'.repeat(20)}`;
const HASH = `0x${'ab'.repeat(32)}`;
const SOURCE = '# Synthetic Consensus Trace fixture, never deployed.\nclass FixtureContract:\n    pass\n';
export const FIXTURES = [
  { id: 'execution-error', title: 'Finalized, but execution failed', detail: 'Consensus accepted a receipt containing a contract error.' },
  { id: 'successful', title: 'All requested checks pass', detail: 'Exact source, successful execution and expected finalized values.' },
  { id: 'validator-timeout', title: 'Validator timeout', detail: 'Timeout votes are recorded; the underlying cause is unknown.' },
  { id: 'source-mismatch', title: 'Wrong source commit', detail: 'The pinned file differs from currently deployed code.' },
  { id: 'assertion-failure', title: 'Unexpected application result', detail: 'Execution succeeds, but the expected verdict is not observed.' },
  { id: 'read-unavailable', title: 'Finalized state read unavailable', detail: 'A successful receipt does not establish frontend staleness.' },
  { id: 'pending', title: 'Accepted, not finalized', detail: 'A projected Finalize action is not stored finality.' },
] as const;

export function fixtureCase(id: string): TraceCase {
  if (!FIXTURES.some(fixture => fixture.id === id)) throw new Error('Unknown fixture.');
  return { name: `Demo: ${FIXTURES.find(fixture => fixture.id === id)!.title}`, network: 'bradbury', contractAddress: ADDRESS, transactionHash: HASH,
    source: { repository: 'example/fixture', commit: 'a'.repeat(40), path: 'contracts/Fixture.py' },
    assertions: [
      { label: 'Request identifier', method: 'get_result', args: [1], pointer: '/request_id', operator: 'equals', expected: '1', parseJson: false },
      { label: 'Expected verdict', method: 'get_result', args: [1], pointer: '/verdict', operator: 'equals', expected: 'SUPPORTED', parseJson: false },
    ], includeTrace: false, traceRound: 0,
  };
}
export class FixtureCollector implements Collector {
  constructor(private readonly id: string) { fixtureCase(id); }
  private ok<T>(method: string, value: T): Evidence<T> { return { kind: 'ok', method, value, capturedAt: new Date().toISOString(), durationMs: 0 }; }
  async rpc(_network: string, method: string, _params: Json[]): Promise<Evidence> {
    if (method === 'eth_chainId') return this.ok(method, '0x107d');
    if (method === 'gen_getTransactionLifecycle') return this.ok(method, { storedStatus: this.id === 'pending' ? 'Accepted' : this.id === 'validator-timeout' ? 'ValidatorsTimeout' : 'Finalized', projectedStatus: 'Accepted', resolutionAction: this.id === 'pending' ? 'Finalize' : 'NoOp' });
    if (method === 'gen_getTransactionReceipt') return this.ok(method, { id: HASH, recipient: ADDRESS, status: this.id === 'pending' ? 5 : this.id === 'validator-timeout' ? 11 : 7,
      txExecutionResult: this.id === 'execution-error' ? 2 : this.id === 'validator-timeout' ? 3 : 1,
      roundData: [{ round: '0', roundValidators: Array.from({ length: 5 }, (_, i) => `0x${String(i + 1).padStart(40, '0')}`), validatorVotes: this.id === 'validator-timeout' ? [1, 1, 3, 3, 3] : [1, 1, 1, 1, 1], result: '6' }],
    });
    if (method === 'gen_getContractCode') return this.ok(method, Buffer.from(SOURCE).toString('base64'));
    if (method === 'gen_getContractSchema') return this.ok(method, { methods: { get_result: { readonly: true } } });
    if (method === 'gen_call') {
      if (this.id === 'read-unavailable') return { kind: 'error', method, capturedAt: new Date().toISOString(), durationMs: 0, error: { category: 'not_found', code: -32001, message: 'Synthetic fixture: finalized-state view unavailable.' } };
      return this.ok(method, Buffer.from(calldata.encode({ request_id: '1', verdict: this.id === 'assertion-failure' ? 'CONTRADICTED' : 'SUPPORTED' })).toString('hex'));
    }
    return { kind: 'error', method, capturedAt: new Date().toISOString(), durationMs: 0, error: { category: 'unsupported', code: -32601, message: 'Method unavailable in synthetic fixture.' } };
  }
  async source(_ref?: SourceRef): Promise<Evidence<string>> { return this.ok('github.commit-pinned-source', this.id === 'source-mismatch' ? `${SOURCE}# Different commit.\n` : SOURCE); }
}
