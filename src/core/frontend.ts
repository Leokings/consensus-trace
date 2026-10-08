import { canonicalJson } from './json.js';
import type { AssertionResult, FrontendComparison, FrontendSnapshot, TraceCase } from './types.js';

/** Compare equivalent reads. A submitted capture is not independent proof of a third-party UI. */
export function compareFrontend(input: TraceCase, results: AssertionResult[]): FrontendComparison[] {
  return (input.frontend ?? []).map(snapshot => {
    const index = results.findIndex(result => result.spec.label === snapshot.label);
    const base = { snapshot, ...(index >= 0 ? { assertionIndex: index } : {}) };
    const result = results[index];
    if (!result || snapshot.network !== input.network || snapshot.contractAddress.toLowerCase() !== input.contractAddress.toLowerCase() || snapshot.method !== result.spec.method || canonicalJson(snapshot.args) !== canonicalJson(result.spec.args) || snapshot.pointer !== result.spec.pointer || snapshot.parseJson !== result.spec.parseJson) return { ...base, status: 'NOT_COMPARABLE', reason: 'Capture must match the exact network, contract, view method, arguments, pointer, parsing mode and assertion label.' };
    if (result.evidence.kind !== 'ok' || result.actual === undefined) return { ...base, status: 'UNAVAILABLE', reason: 'No equivalent finalized read was obtained. Unavailable data is not evidence of a stale UI.' };
    const captured = Date.parse(snapshot.capturedAt);
    const fetched = Date.parse(result.evidence.capturedAt);
    if (captured > fetched + 5000 || fetched - captured > 300000) return { ...base, status: 'NOT_COMPARABLE', reason: 'Capture must precede or be within five seconds of this read, and be no older than five minutes. A new capture is needed.' };
    if (canonicalJson(snapshot.displayedValue) === canonicalJson(result.actual)) return { ...base, status: 'MATCH', reason: 'The captured display matches the equivalent current finalized read.' };
    if (snapshot.readValue !== undefined && canonicalJson(snapshot.readValue) === canonicalJson(result.actual)) return { ...base, status: 'DISPLAY_STALE', reason: 'The supplied frontend read and the independent finalized read agree, but the captured display differs. This supports a display/cache-update fault in the supplied capture; capture authenticity and historical causality are not proven.' };
    return { ...base, status: 'DIVERGENCE', reason: 'The captured display differs from current finalized state. A different read, later write, or cache may explain it; frontend staleness is not established without an agreeing instrumented read.' };
  });
}

/** Integration helper: values must be the selected value at pointer, not the full response. */
export function captureFrontend(snapshot: Omit<FrontendSnapshot, 'capturedAt' | 'stateVariant'>, now = new Date()): FrontendSnapshot {
  return { ...snapshot, stateVariant: 'latest-final', capturedAt: now.toISOString() };
}
