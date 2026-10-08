import { name, record } from './json.js';
import type { ReceiptSummary, RoundSummary, Vote } from './types.js';

const STATUSES = ['UNINITIALIZED', 'PENDING', 'PROPOSING', 'COMMITTING', 'REVEALING', 'ACCEPTED', 'UNDETERMINED', 'FINALIZED', 'CANCELED', 'APPEAL_REVEALING', 'APPEAL_COMMITTING', 'VALIDATORS_TIMEOUT', 'LEADER_TIMEOUT', 'LEADER_REVEALING'];
const VOTES: Vote[] = ['NOT_VOTED', 'AGREE', 'DISAGREE', 'TIMEOUT', 'DETERMINISTIC_VIOLATION'];
const EXECUTIONS: ReceiptSummary['execution'][] = ['UNKNOWN', 'SUCCESS', 'ERROR', 'TIMEOUT', 'NONDET_DISAGREE', 'DETERMINISTIC_VIOLATION'];
const address = (value: unknown): string | null => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? value : null;
const hash = (value: unknown): string | null => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) ? value : null;
const code = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null;

function vote(value: unknown): Vote {
  const numeric = code(value);
  if (numeric !== null) return VOTES[numeric] ?? 'UNKNOWN';
  const normalized = name(value);
  if (normalized === 'IDLE') return 'NOT_VOTED';
  return VOTES.includes(normalized as Vote) ? normalized as Vote : 'UNKNOWN';
}
function execution(value: unknown): ReceiptSummary['execution'] {
  const numeric = code(value);
  if (numeric !== null) return EXECUTIONS[numeric] ?? 'UNKNOWN';
  const normalized = name(value);
  if (['SUCCESS', 'FINISHED_WITH_RETURN'].includes(normalized)) return 'SUCCESS';
  if (['ERROR', 'FINISHED_WITH_ERROR'].includes(normalized)) return 'ERROR';
  if (normalized === 'NONDET_DISAGREE' || normalized === 'NON_DET_DISAGREE') return 'NONDET_DISAGREE';
  if (['TIMEOUT', 'DETERMINISTIC_VIOLATION'].includes(normalized)) return normalized as ReceiptSummary['execution'];
  return 'UNKNOWN';
}
function decodeVotes(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.length <= 8192 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return [...Buffer.from(value, 'base64')];
  return [];
}
function summarizeRound(raw: unknown, index: number): RoundSummary {
  const data = record(raw);
  const validators = Array.isArray(data.roundValidators) ? data.roundValidators : [];
  const votes = decodeVotes(data.validatorVotesName ?? data.validatorVotes);
  const pairs = Array.from({ length: Math.max(validators.length, votes.length) }, (_, i) => ({ address: address(validators[i]) ?? `unidentified-validator-${i}`, vote: vote(votes[i]) }));
  return makeRound(String(data.round ?? index), pairs, typeof data.result === 'string' || typeof data.result === 'number' ? String(data.result) : null);
}
function makeRound(round: string, validators: RoundSummary['validators'], result: string | null): RoundSummary {
  const counts: RoundSummary['counts'] = { AGREE: 0, DISAGREE: 0, TIMEOUT: 0, DETERMINISTIC_VIOLATION: 0, NOT_VOTED: 0, UNKNOWN: 0 };
  for (const validator of validators) counts[validator.vote] += 1;
  return { round, validators, counts, result };
}

export function normalizeReceipt(raw: unknown): ReceiptSummary {
  const data = record(raw);
  const statusCode = code(data.status);
  const inconsistencies: string[] = [];
  const namedStatus = name(data.statusName);
  const numberedStatus = STATUSES[statusCode ?? -1];
  let storedStatus = namedStatus || (typeof data.status === 'string' && statusCode === null ? name(data.status) : numberedStatus) || 'UNKNOWN';
  if (namedStatus && numberedStatus && namedStatus !== numberedStatus) { inconsistencies.push('statusName and numeric status disagree'); storedStatus = 'UNKNOWN'; }
  const consensus = record(data.consensus_data);
  const nestedReceipt = Array.isArray(consensus.leader_receipt) ? consensus.leader_receipt : consensus.leader_receipt ? [consensus.leader_receipt] : [];
  // Studio can put quorum-cancelled validator receipts in leader_receipt. They are not the leader's execution result.
  const leaders = nestedReceipt.map(record).filter(item => !item.mode || name(item.mode) === 'LEADER');
  let executionValue = execution(data.txExecutionResultName ?? data.txExecutionResult);
  let executionBasis = 'receipt.txExecutionResult';
  const namedExecution = execution(data.txExecutionResultName);
  const numberedExecution = execution(data.txExecutionResult);
  if (data.txExecutionResultName !== undefined && data.txExecutionResult !== undefined && namedExecution !== numberedExecution) { inconsistencies.push('txExecutionResultName and numeric execution result disagree'); executionValue = 'UNKNOWN'; }
  if (executionValue === 'UNKNOWN' && leaders.length && !inconsistencies.length) {
    const results = [...new Set(leaders.map(item => execution(item.execution_result)))];
    executionValue = results.length === 1 ? results[0] : 'UNKNOWN';
    executionBasis = 'receipt.consensus_data.leader_receipt[mode=leader].execution_result';
  }
  const rounds = Array.isArray(data.roundData) && data.roundData.length ? data.roundData.map(summarizeRound)
    : data.lastRound ? [summarizeRound(data.lastRound, 0)]
    : Object.keys(record(consensus.votes)).length ? [makeRound('studio-current', Object.entries(record(consensus.votes)).map(([key, value]) => ({ address: key, vote: vote(value) })), null)] : [];
  return {
    found: Object.keys(data).length > 0 && storedStatus !== 'UNINITIALIZED',
    storedStatus, statusCode, finalized: storedStatus === 'FINALIZED',
    execution: executionValue, executionBasis,
    transactionHash: hash(data.hash ?? data.id ?? data.txId),
    recipient: address(data.recipient ?? data.to_address ?? data.to ?? record(data.data).contract_address),
    rounds, inconsistencies,
  };
}
