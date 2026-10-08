export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type NetworkId = 'studionet' | 'bradbury' | 'localnet';
export type Evidence<T = Json> =
  | { kind: 'ok'; method: string; capturedAt: string; durationMs: number; value: T }
  | { kind: 'error'; method: string; capturedAt: string; durationMs: number; error: { category: string; message: string; code?: number } }
  | { kind: 'skipped'; method: string; reason: string };

export interface SourceRef { repository: string; commit: string; path: string }
export interface AssertionSpec {
  label: string;
  method: string;
  args: Json[];
  pointer: string;
  operator: 'equals' | 'exists' | 'contains' | 'gte' | 'lte';
  expected?: Json;
  parseJson: boolean;
}
export interface TraceCase {
  name: string;
  network: NetworkId;
  contractAddress: string;
  transactionHash: string;
  source?: SourceRef;
  assertions: AssertionSpec[];
  includeTrace: boolean;
  traceRound: number;
  frontend?: FrontendSnapshot[];
}
export interface FrontendSnapshot {
  label: string;
  network: NetworkId;
  contractAddress: string;
  method: string;
  args: Json[];
  pointer: string;
  parseJson: boolean;
  stateVariant: 'latest-final';
  capturedAt: string;
  displayedValue: Json;
  readValue?: Json;
}
export interface FrontendComparison {
  snapshot: FrontendSnapshot;
  status: 'MATCH' | 'DISPLAY_STALE' | 'DIVERGENCE' | 'NOT_COMPARABLE' | 'UNAVAILABLE';
  reason: string;
  assertionIndex?: number;
}
export type Vote = 'AGREE' | 'DISAGREE' | 'TIMEOUT' | 'DETERMINISTIC_VIOLATION' | 'NOT_VOTED' | 'UNKNOWN';
export interface RoundSummary {
  round: string;
  validators: { address: string; vote: Vote }[];
  counts: Record<Vote, number>;
  result: string | null;
}
export interface ReceiptSummary {
  found: boolean;
  storedStatus: string;
  statusCode: number | null;
  finalized: boolean;
  execution: 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'NONDET_DISAGREE' | 'DETERMINISTIC_VIOLATION' | 'UNKNOWN';
  executionBasis: string;
  transactionHash: string | null;
  recipient: string | null;
  rounds: RoundSummary[];
  inconsistencies: string[];
}
export interface AssertionResult {
  spec: AssertionSpec;
  evidence: Evidence;
  stateVariant: 'latest-final';
  status: 'PASS' | 'FAIL' | 'UNAVAILABLE' | 'SKIPPED';
  actual?: Json;
  reason: string;
}
export interface Finding {
  code: string;
  severity: 'error' | 'warning' | 'info';
  certainty: 'observed' | 'limitation';
  title: string;
  detail: string;
  evidencePaths: string[];
  nextCheck: string;
}
export interface TraceReport {
  schemaVersion: 1;
  id: string;
  parentId?: string;
  origin: 'live' | 'fixture';
  fixtureId?: string;
  createdAt: string;
  toolVersion: '0.1.0' | '0.2.0';
  sdkVersion: '1.1.8';
  input: TraceCase;
  network: { id: NetworkId; chainId: number; rpc: string; explorer: string; chainVerified: boolean };
  identity: { transactionMatches: boolean; recipientMatches: boolean };
  observations: {
    chainId: Evidence;
    receipt: Evidence;
    lifecycle: Evidence;
    deployedCode: Evidence<string>;
    pinnedSource: Evidence<string>;
    schema: Evidence;
    trace: Evidence;
  };
  receipt: ReceiptSummary;
  source: {
    comparison: 'EXACT' | 'LINE_ENDINGS_ONLY' | 'MISMATCH' | 'UNAVAILABLE' | 'NOT_REQUESTED';
    deployedSha256?: string;
    pinnedSha256?: string;
    deployedLfSha256?: string;
    pinnedLfSha256?: string;
  };
  assertions: AssertionResult[];
  frontend?: FrontendComparison[];
  findings: Finding[];
  conclusion: 'CHECKS_PASSED' | 'ISSUES_FOUND' | 'INCOMPLETE';
  links: { contract: string; transaction: string; source?: string };
  limitations: string[];
  redaction?: { applied: boolean; replacements: number; note: string };
}

export interface Collector {
  rpc(network: NetworkId, method: string, params: Json[]): Promise<Evidence>;
  source(ref: SourceRef): Promise<Evidence<string>>;
}

export interface RunRecord {
  id: string;
  parentId?: string;
  fixtureId?: string;
  createdAt: string;
  status: 'collecting' | 'complete' | 'interrupted';
  failure?: string;
  input: TraceCase;
  report?: TraceReport;
}
