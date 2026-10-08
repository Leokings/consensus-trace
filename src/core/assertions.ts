import { canonicalJson, record } from './json.js';
import type { AssertionResult, AssertionSpec, Evidence, Json } from './types.js';

export function atPointer(value: Json, pointer: string): { found: boolean; value?: Json } {
  if (pointer === '') return { found: true, value };
  let current: Json = value;
  for (const part of pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (['__proto__', 'prototype', 'constructor'].includes(part) || current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) return { found: false };
    current = (current as Record<string, Json>)[part];
  }
  return { found: true, value: current };
}
function integer(value: Json | undefined): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d{1,256}$/.test(value)) return BigInt(value);
  return null;
}
export function evaluateAssertion(spec: AssertionSpec, evidence: Evidence): AssertionResult {
  const base = { spec, evidence, stateVariant: 'latest-final' as const };
  if (evidence.kind === 'skipped') return { ...base, status: 'SKIPPED', reason: evidence.reason };
  if (evidence.kind === 'error') return { ...base, status: 'UNAVAILABLE', reason: evidence.error.message };
  let value = evidence.value;
  if (spec.parseJson) {
    if (typeof value !== 'string') return { ...base, status: 'UNAVAILABLE', reason: 'parseJson requires a string return value.' };
    try { value = JSON.parse(value) as Json; } catch { return { ...base, status: 'UNAVAILABLE', reason: 'Read returned a string, but it was not valid JSON.' }; }
  }
  const found = atPointer(value, spec.pointer);
  if (!found.found) return { ...base, status: 'FAIL', reason: `Pointer ${spec.pointer} is absent.` };
  const actual = found.value!;
  let pass = false;
  if (spec.operator === 'exists') pass = true;
  if (spec.operator === 'equals') pass = canonicalJson(actual) === canonicalJson(spec.expected);
  if (spec.operator === 'contains') pass = typeof actual === 'string' && typeof spec.expected === 'string' ? actual.includes(spec.expected) : Array.isArray(actual) && actual.some(item => canonicalJson(item) === canonicalJson(spec.expected));
  if (spec.operator === 'gte' || spec.operator === 'lte') {
    const left = integer(actual); const right = integer(spec.expected);
    if (left === null || right === null) return { ...base, actual, status: 'UNAVAILABLE', reason: 'Numeric comparison requires safe integers or decimal integer strings.' };
    pass = spec.operator === 'gte' ? left >= right : left <= right;
  }
  return { ...base, actual, status: pass ? 'PASS' : 'FAIL', reason: pass ? 'Expected assertion matches the current latest-final read.' : 'Expected assertion does not match the current latest-final read; later transactions may have changed state.' };
}

export function decodeCallDataEnvelope(raw: Json): string {
  const object = record(raw);
  const status = record(object.status);
  if (status.code !== undefined && status.code !== 0) throw new Error(`gen_call failed: ${String(status.message ?? status.code)}`);
  const data = typeof raw === 'string' ? raw : object.data;
  if (typeof data !== 'string' || !/^(?:0x)?(?:[0-9a-fA-F]{2})+$/.test(data)) throw new Error('gen_call did not return valid hex calldata.');
  return data.startsWith('0x') ? data.slice(2) : data;
}
