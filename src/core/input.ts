import { z } from 'zod';
import type { Json, TraceCase } from './types.js';
import { assertComplexity } from './bounds.js';
import { redact } from './redact.js';

export class CaseInputError extends Error {}

export const jsonValue: z.ZodType<Json> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite().refine(Number.isSafeInteger, 'Use safe integer JSON numbers; encode larger integers as strings.'),
  z.string().max(65536), z.array(jsonValue).max(256), z.record(z.string(), jsonValue),
]));
const path = z.string().min(1).max(240).refine(value =>
  /^[A-Za-z0-9_./-]+$/.test(value) && !value.startsWith('/') && value.split('/').every(segment => segment !== '.' && segment !== '..' && segment !== ''),
  'Use a repository-relative file path without traversal or URL escapes.');
export const sourceSchema = z.object({
  repository: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/),
  commit: z.string().regex(/^[a-fA-F0-9]{40}$/, 'Pin a full 40-character Git commit, not a branch or tag.'),
  path,
}).strict();
export const assertionSchema = z.object({
  label: z.string().min(1).max(80),
  method: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/),
  args: z.array(jsonValue).max(16).default([]),
  pointer: z.string().max(256).refine(value => value === '' || value.startsWith('/'), 'Use an RFC 6901 JSON pointer.').default(''),
  operator: z.enum(['equals', 'exists', 'contains', 'gte', 'lte']).default('equals'),
  expected: jsonValue.optional(),
  parseJson: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.operator !== 'exists' && !Object.hasOwn(value, 'expected')) context.addIssue({ code: 'custom', message: 'This operator requires an expected value.' });
  if (value.pointer.includes('~') && /~(?![01])/u.test(value.pointer)) context.addIssue({ code: 'custom', message: 'Invalid JSON pointer escape.' });
});
export const frontendSchema = z.object({
  label: z.string().min(1).max(80), network: z.enum(['studionet', 'bradbury', 'localnet']),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  method: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/), args: z.array(jsonValue).max(16),
  pointer: z.string().max(256).refine(value => value === '' || value.startsWith('/')).refine(value => !/~(?![01])/u.test(value)),
  parseJson: z.boolean(), stateVariant: z.literal('latest-final'),
  capturedAt: z.string().datetime({ offset: true }), displayedValue: jsonValue, readValue: jsonValue.optional(),
}).strict();
export const caseSchema = z.object({
  name: z.string().min(1).max(100).default('Contract verification'),
  network: z.enum(['studionet', 'bradbury', 'localnet']),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).refine(value => !/^0x0{40}$/.test(value), 'A zero address cannot identify the subject contract.'),
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).refine(value => !/^0x0{64}$/.test(value), 'Use the GenLayer transaction ID, not an empty hash.'),
  source: sourceSchema.optional(),
  assertions: z.array(assertionSchema).max(8).default([]),
  includeTrace: z.boolean().default(false),
  traceRound: z.number().int().min(0).max(255).default(0),
  frontend: z.array(frontendSchema).max(8).optional(),
}).strict();

export function parseCase(input: unknown): TraceCase {
  try { assertComplexity(input, 24, 4096); } catch { throw new CaseInputError('Test case is too deeply nested or complex.'); }
  const serialized = JSON.stringify(input);
  if (!serialized || new TextEncoder().encode(serialized).byteLength > 262144) throw new CaseInputError('Test case exceeds 256 KiB.');
  if (redact(input).replacements > 0) throw new CaseInputError('Credential-like fields or tokens are not accepted in test cases. Use public, non-sensitive inputs.');
  const value = caseSchema.parse(input);
  if (new Set(value.assertions.map(assertion => assertion.label)).size !== value.assertions.length) throw new CaseInputError('Assertion labels must be unique.');
  if (value.frontend && new Set(value.frontend.map(item => item.label)).size !== value.frontend.length) throw new CaseInputError('Frontend snapshot labels must be unique.');
  return value;
}
