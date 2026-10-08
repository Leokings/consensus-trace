import { z } from 'zod';
import { abi } from 'genlayer-js';
import { studionet, testnetBradbury } from 'genlayer-js/chains';
import { decodeFunctionData, encodeFunctionData, parseEventLogs, type Abi, type Hex } from 'viem';
import { assertionSchema, CaseInputError, jsonValue, parseCase, sourceSchema } from './input.js';
import { assertComplexity } from './bounds.js';
import { canonicalJson, jsonSafe, record, sha256 } from './json.js';
import { NETWORKS } from './networks.js';
import { compareSource, decodeSource } from './source.js';
import { redact } from './redact.js';
import type { Collector, Evidence, Json, TraceCase } from './types.js';

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).refine(value => !/^0x0{40}$/.test(value));
const hash = z.string().regex(/^0x[a-fA-F0-9]{64}$/).refine(value => !/^0x0{64}$/.test(value));
export const testDraftSchema = z.object({
  name: z.string().min(1).max(100), network: z.enum(['studionet', 'bradbury']), contractAddress: address,
  source: sourceSchema, method: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/),
  args: z.array(jsonValue).max(16), kwargs: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/), jsonValue).optional(),
  assertions: z.array(assertionSchema).max(8).default([]), gasLimit: z.number().int().min(21000).max(2000000).default(500000),
}).strict();
export type TestDraft = z.infer<typeof testDraftSchema>;
export interface PreparedTest {
  schemaVersion: 1; draft: TestDraft; digest: string; preparedAt: string; expiresAt: string;
  status: 'READY' | 'BLOCKED'; sourceSha256?: string; methods: string[]; reasons: string[];
  observations: { chain: Evidence; deployedCode: Evidence; pinnedSource: Evidence<string> };
}
export const SDK_CHAINS = { studionet, bradbury: testnetBradbury } as const;
export function parseTestDraft(value: unknown): TestDraft {
  assertComplexity(value, 24, 4096);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 8192) throw new CaseInputError('Test draft exceeds 8 KiB.');
  if (redact(value).replacements) throw new CaseInputError('Only public, non-sensitive test arguments are accepted. Credentials are not allowed.');
  const draft = testDraftSchema.parse(value);
  if (new Set(draft.assertions.map(item => item.label)).size !== draft.assertions.length) throw new CaseInputError('Assertion labels must be unique.');
  return draft;
}
export const testDigest = (draft: TestDraft) => sha256(canonicalJson(parseTestDraft(draft)));
/** Source annotations identify the selected public write; they are not a Python security audit. */
export function publicWriteMethods(code: string): string[] {
  return [...code.matchAll(/^[ \t]*@gl\.public\.write(?:\.payable)?(?:\([^\n]*\))?[ \t]*\r?\n(?:[ \t]*@[^\n]+\r?\n)*[ \t]*def[ \t]+([A-Za-z][A-Za-z0-9_]*)[ \t]*\(/gm)].map(match => match[1]);
}
export async function prepareTest(value: unknown, collector: Collector, now = Date.now()): Promise<PreparedTest> {
  const draft = parseTestDraft(value); const net = NETWORKS[draft.network];
  const [chain, deployedCode, pinnedSource] = await Promise.all([
    collector.rpc(draft.network, 'eth_chainId', []),
    collector.rpc(draft.network, 'gen_getContractCode', net.studio ? [draft.contractAddress] : [{ address: draft.contractAddress }]),
    collector.source(draft.source),
  ]);
  return derivePreparation(draft, { chain, deployedCode, pinnedSource }, now);
}
function derivePreparation(draft: TestDraft, observations: PreparedTest['observations'], now: number): PreparedTest {
  const { chain, deployedCode, pinnedSource } = observations; const reasons: string[] = [];
  const chainValue = chain.kind === 'ok' ? chain.value : null;
  const chainId = typeof chainValue === 'string' && /^0x[0-9a-f]{1,12}$/i.test(chainValue) ? Number(BigInt(chainValue)) : chainValue;
  if (chainId !== NETWORKS[draft.network].chainId) reasons.push('The official RPC chain identity could not be verified.');
  let sourceSha256: string | undefined; let methods: string[] = [];
  if (deployedCode.kind !== 'ok' || pinnedSource.kind !== 'ok') reasons.push('Both deployed code and commit-pinned public source must be available.');
  else {
    try {
      const code = decodeSource(deployedCode.value);
      if (compareSource(code, pinnedSource.value).comparison !== 'EXACT') reasons.push('Deployed code does not exactly match the pinned source bytes.');
      sourceSha256 = sha256(code); methods = publicWriteMethods(code);
      if (!methods.includes(draft.method)) reasons.push('Selected method is not a recognized public-write annotation in the pinned deployed source.');
    } catch { reasons.push('Deployed source could not be decoded safely.'); }
  }
  return { schemaVersion: 1, draft, digest: testDigest(draft), preparedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600000).toISOString(),
    status: reasons.length ? 'BLOCKED' : 'READY', ...(sourceSha256 ? { sourceSha256 } : {}), methods, reasons, observations };
}
export function validatePreparation(value: unknown, expected: TestDraft, now = Date.now()): PreparedTest {
  assertComplexity(value); const raw = record(value);
  if (raw.schemaVersion !== 1 || typeof raw.preparedAt !== 'string' || !Number.isFinite(Date.parse(raw.preparedAt)) || !raw.observations) throw new Error('Invalid preparation response.');
  if (canonicalJson(parseTestDraft(raw.draft)) !== canonicalJson(expected)) throw new Error('Preparation is not bound to the complete selected test.');
  const observations = raw.observations as PreparedTest['observations'];
  for (const item of [observations.chain, observations.deployedCode, observations.pinnedSource]) if (!item || !['ok', 'error', 'skipped'].includes(item.kind)) throw new Error('Preparation omitted source or chain evidence.');
  const prepared = derivePreparation(expected, observations, Date.parse(raw.preparedAt));
  if (canonicalJson(raw) !== canonicalJson(prepared) || now > Date.parse(prepared.expiresAt) || Date.parse(prepared.preparedAt) > now + 5000) throw new Error('Preparation is inconsistent, expired or from the future. Prepare the test again.');
  return prepared;
}
export function traceCaseForTest(draft: TestDraft, transactionHash: string): TraceCase {
  return parseCase({ name: draft.name, network: draft.network, contractAddress: draft.contractAddress, source: draft.source,
    assertions: draft.assertions, transactionHash, includeTrace: false, traceRound: 0 });
}
/** SDK chain ABI + SDK calldata serializers; no alternate encoding or automatic resubmission. */
export function encodeWalletTransaction(draft: TestDraft, sender: string, now = Date.now()): Record<string, string> {
  address.parse(sender); const chain = SDK_CHAINS[draft.network]; const consensusAbi = chain.consensusMainContract!.abi as Abi;
  const method = consensusAbi.find(item => item.type === 'function' && item.name === 'addTransaction');
  if (!method || method.type !== 'function' || ![5, 6].includes(method.inputs.length)) throw new Error('Unsupported consensus ABI. No transaction can be submitted.');
  const data = abi.transactions.serialize([abi.calldata.encode(abi.calldata.makeCalldataObject(draft.method, draft.args, draft.kwargs)), false]);
  const args = [sender, draft.contractAddress, BigInt(chain.defaultNumberOfInitialValidators!), BigInt(chain.defaultConsensusMaxRotations!), data];
  if (method.inputs.length === 6) args.push(BigInt(Math.floor(now / 1000) + 3600));
  return { from: sender, to: chain.consensusMainContract!.address, data: encodeFunctionData({ abi: consensusAbi, functionName: 'addTransaction', args }), value: '0x0', gas: `0x${draft.gasLimit.toString(16)}`, chainId: `0x${chain.id.toString(16)}` };
}
/** Verify the SDK's wallet request against the reviewed method, exact calldata, chain and zero user value. */
export function validateWalletTransaction(value: unknown, draft: TestDraft, sender: string, allowExpired = false): Record<string, unknown> {
  const tx = record(value); const chain = SDK_CHAINS[draft.network];
  if (typeof tx.from !== 'string' || tx.from.toLowerCase() !== sender.toLowerCase() || typeof tx.to !== 'string' || tx.to.toLowerCase() !== chain.consensusMainContract!.address.toLowerCase()) throw new Error('Wallet transaction sender or consensus destination does not match the approved test.');
  if (tx.chainId !== undefined && Number(BigInt(String(tx.chainId))) !== chain.id || BigInt(String(tx.value ?? '0x0')) !== 0n) throw new Error('Test transactions must use the selected chain and zero transferred user value.');
  if (typeof tx.data !== 'string' || !/^0x[0-9a-f]+$/i.test(tx.data) || tx.data.length > 150000) throw new Error('Invalid encoded wallet transaction.');
  const decoded = decodeFunctionData({ abi: chain.consensusMainContract!.abi as Abi, data: tx.data as Hex });
  if (decoded.functionName !== 'addTransaction' || !decoded.args) throw new Error('Only the reviewed Intelligent Contract test call may be sent.');
  const args = decoded.args as readonly unknown[];
  const callData = abi.transactions.serialize([abi.calldata.encode(abi.calldata.makeCalldataObject(draft.method, draft.args, draft.kwargs)), false]);
  if (String(args[0]).toLowerCase() !== sender.toLowerCase() || String(args[1]).toLowerCase() !== draft.contractAddress.toLowerCase() || BigInt(String(args[2])) !== BigInt(chain.defaultNumberOfInitialValidators!) || BigInt(String(args[3])) !== BigInt(chain.defaultConsensusMaxRotations!) || String(args[4]).toLowerCase() !== callData.toLowerCase()) throw new Error('Encoded contract, method, arguments or consensus parameters differ from the reviewed test.');
  if (!allowExpired && args.length > 5 && (BigInt(String(args[5])) < BigInt(Math.floor(Date.now() / 1000)) || BigInt(String(args[5])) > BigInt(Math.floor(Date.now() / 1000) + 7200))) throw new Error('Transaction validity window is unsafe.');
  const gas = tx.gas === undefined ? 0n : BigInt(String(tx.gas));
  if (gas < 21000n || gas > BigInt(draft.gasLimit)) throw new Error('SDK gas allocation exceeds the reviewed gas limit. Adjust the limit and prepare again.');
  return tx;
}

export const resolutionSchema = z.object({ draft: testDraftSchema, sender: address, outerHash: hash, data: z.string().regex(/^0x[0-9a-f]+$/i).max(150000), gas: z.string().regex(/^0x[0-9a-f]+$/i).max(20) }).strict();
export type ResolutionInput = z.infer<typeof resolutionSchema>;
export interface Resolution { status: 'PENDING' | 'RESOLVED' | 'REVERTED' | 'UNAVAILABLE'; transactionHash?: string; reason: string; observations: Evidence[] }
export async function resolveSubmission(value: unknown, collector: Collector): Promise<Resolution> {
  assertComplexity(value, 24, 4096); const input = resolutionSchema.parse(value); const draft = parseTestDraft(input.draft); const net = NETWORKS[draft.network];
  validateWalletTransaction({ from: input.sender, to: SDK_CHAINS[draft.network].consensusMainContract!.address, data: input.data, gas: input.gas, value: '0x0', chainId: `0x${net.chainId.toString(16)}` }, draft, input.sender, true);
  if (net.studio) {
    const transaction = await collector.rpc(draft.network, 'eth_getTransactionByHash', [input.outerHash]); const observations = [transaction];
    if (transaction.kind !== 'ok') return { status: 'UNAVAILABLE', reason: 'StudioNet submission evidence is unavailable. Preserve this hash; do not resend.', observations };
    if (!transaction.value) return { status: 'PENDING', reason: 'StudioNet has not returned the submitted transaction yet. Resume this hash without resending.', observations };
    const tx = record(transaction.value); const data = record(tx.data);
    const identities = [[tx.hash, input.outerHash], [tx.from_address ?? tx.sender, input.sender], [tx.to_address ?? tx.recipient, draft.contractAddress]];
    if (tx.sender !== undefined) identities.push([tx.sender, input.sender]);
    if (tx.recipient !== undefined) identities.push([tx.recipient, draft.contractAddress]);
    if (identities.some(([actual, expected]) => typeof actual !== 'string' || actual.toLowerCase() !== String(expected).toLowerCase())) throw new Error('StudioNet transaction is not bound to the submitted test.');
    if (typeof data.calldata !== 'string') return { status: 'UNAVAILABLE', reason: 'StudioNet omitted call data. This hash cannot yet be bound to the reviewed call.', observations };
    let actual: string;
    try { actual = `0x${[...atob(data.calldata)].map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`; }
    catch { throw new Error('StudioNet call data is not recognizable.'); }
    const expected = `0x${[...abi.calldata.encode(abi.calldata.makeCalldataObject(draft.method, draft.args, draft.kwargs))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
    if (actual.toLowerCase() !== expected || tx.value !== undefined && BigInt(String(tx.value)) !== 0n || tx.leader_only === true) throw new Error('StudioNet method, arguments or user value differ from the reviewed test.');
    return { status: 'RESOLVED', transactionHash: input.outerHash, reason: 'StudioNet submission ID, sender, recipient and exact call data are bound to the reviewed test.', observations };
  }
  const [transaction, receipt] = await Promise.all([collector.rpc(draft.network, 'eth_getTransactionByHash', [input.outerHash]), collector.rpc(draft.network, 'eth_getTransactionReceipt', [input.outerHash])]);
  const observations = [transaction, receipt];
  if (transaction.kind !== 'ok' || receipt.kind !== 'ok') return { status: 'UNAVAILABLE', reason: 'Submission evidence could not be fetched. Resume this same outer hash; do not resend.', observations };
  if (!transaction.value || !receipt.value) return { status: 'PENDING', reason: 'Outer EVM receipt is not yet available. No duplicate write is needed.', observations };
  const tx = record(transaction.value); const rc = record(receipt.value); const consensus = SDK_CHAINS[draft.network].consensusMainContract!.address;
  if (String(tx.hash).toLowerCase() !== input.outerHash.toLowerCase() || String(rc.transactionHash).toLowerCase() !== input.outerHash.toLowerCase() || String(tx.from).toLowerCase() !== input.sender.toLowerCase() || String(tx.to).toLowerCase() !== consensus.toLowerCase() || String(tx.input ?? tx.data).toLowerCase() !== input.data.toLowerCase()) throw new Error('Outer receipt or transaction is not bound to the submitted test.');
  if (rc.status === '0x0') return { status: 'REVERTED', reason: 'Outer EVM submission reverted. No successful GenLayer test is inferred.', observations };
  if (rc.status !== '0x1' || !Array.isArray(rc.logs)) return { status: 'UNAVAILABLE', reason: 'Outer receipt status or logs are not recognizable.', observations };
  const events = parseEventLogs({ abi: SDK_CHAINS[draft.network].consensusMainContract!.abi as Abi,
    eventName: ['NewTransaction', 'CreatedTransaction'], logs: rc.logs.filter(log => String(record(log).address).toLowerCase() === consensus.toLowerCase()) as Parameters<typeof parseEventLogs>[0]['logs'], strict: true });
  const candidates = new Set(events.map(event => record(event.args).txId).filter(id => typeof id === 'string' && /^0x[0-9a-f]{64}$/i.test(id) && !/^0x0{64}$/i.test(id)).map(id => String(id).toLowerCase()));
  if (candidates.size !== 1) return { status: 'UNAVAILABLE', reason: 'Receipt did not identify one unambiguous GenLayer transaction. Preserve this outer hash and investigate; do not resend.', observations };
  return { status: 'RESOLVED', transactionHash: [...candidates][0] as string, reason: 'GenLayer transaction ID resolved from the bound consensus event.', observations };
}
export function walletLaunchUrl(draft: TestDraft): string | undefined {
  const encoded = Buffer.from(canonicalJson(parseTestDraft(draft))).toString('base64url');
  return encoded.length <= 10000 ? `https://consensus-trace.vercel.app/#test=${encoded}` : undefined;
}
export function preparedEvidence(prepared: PreparedTest): Json { return jsonSafe(prepared); }
