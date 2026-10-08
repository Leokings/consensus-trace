import { z } from 'zod';
import { parseTestDraft, SDK_CHAINS, testDigest, validatePreparation, validateWalletTransaction, type PreparedTest, type TestDraft } from '../core/execution.js';
import { assertComplexity } from '../core/bounds.js';
import { canonicalJson } from '../core/json.js';

const timestamp = z.string().datetime({ offset: true });
const transactionHash = z.string().regex(/^0x[a-fA-F0-9]{64}$/).refine(value => !/^0x0{64}$/.test(value));
const schema = z.object({
  schemaVersion: z.literal(1), id: z.uuid(), createdAt: timestamp, updatedAt: timestamp,
  status: z.enum(['PREPARED', 'AWAITING_WALLET', 'SUBMITTED', 'TRACKING', 'FINALIZED', 'REJECTED', 'UNCERTAIN', 'REVERTED']),
  draft: z.unknown(), prepared: z.unknown(), digest: z.string().regex(/^[a-f0-9]{64}$/),
  account: z.string().regex(/^0x[a-fA-F0-9]{40}$/).refine(value => !/^0x0{40}$/.test(value)).optional(), outerHash: transactionHash.optional(), transactionHash: transactionHash.optional(),
  transactionData: z.string().regex(/^0x[0-9a-f]+$/i).max(150000).optional(), gas: z.string().regex(/^0x[0-9a-f]+$/i).max(20).optional(),
  reportId: z.uuid().optional(), message: z.string().max(1000),
  events: z.array(z.object({ at: timestamp, event: z.string().max(80), detail: z.string().max(1000) }).strict()).max(256),
}).strict();
export interface TestAttempt extends Omit<z.infer<typeof schema>, 'draft' | 'prepared'> { draft: TestDraft; prepared: PreparedTest }
export function parseAttempt(value: unknown): TestAttempt {
  assertComplexity(value); const data = schema.parse(value); const draft = parseTestDraft(data.draft);
  const prepared = validatePreparation(data.prepared, draft, Date.parse((data.prepared as PreparedTest).preparedAt));
  if (data.digest !== testDigest(draft) || data.digest !== prepared.digest) throw new Error('Saved test attempt does not match its immutable test digest.');
  if (prepared.status !== 'READY') throw new Error('Saved test attempt has no verified preparation.');
  if (data.status === 'PREPARED' && [data.account, data.transactionData, data.gas, data.outerHash, data.transactionHash].some(item => item !== undefined)) throw new Error('An unsent attempt cannot contain a previous submission identity.');
  if (data.status !== 'PREPARED') {
    if (!data.account || !data.transactionData || !data.gas) throw new Error('Saved wallet attempt is missing its exact submission identity.');
    validateWalletTransaction({ from: data.account, to: SDK_CHAINS[draft.network].consensusMainContract!.address, data: data.transactionData, gas: data.gas, value: '0x0' }, draft, data.account, true);
  }
  if (['SUBMITTED', 'TRACKING', 'FINALIZED', 'REVERTED'].includes(data.status) && !data.outerHash || data.transactionHash && !data.outerHash) throw new Error('Submitted test is missing its outer transaction hash.');
  return { ...data, draft, prepared };
}
export function newAttempt(prepared: PreparedTest): TestAttempt {
  if (prepared.status !== 'READY') throw new Error('Only a verified preparation can become a test attempt.');
  return { schemaVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'PREPARED', draft: prepared.draft, prepared, digest: prepared.digest, message: 'Review the exact call before authorizing a wallet transaction.', events: [] };
}
export class BrowserTestStore {
  private database?: Promise<IDBDatabase>;
  notices: string[] = [];
  constructor(private readonly name = 'consensus-trace:tests:v1', private readonly factory: IDBFactory = indexedDB) {}
  private open(): Promise<IDBDatabase> { return this.database ??= new Promise((resolve, reject) => { const request = this.factory.open(this.name, 1); request.onupgradeneeded = () => request.result.createObjectStore('attempts', { keyPath: 'id' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Test tracking storage is unavailable. No wallet transaction can be started.')); request.onblocked = () => reject(new Error('Close an older Consensus Trace tab before starting a test.')); }); }
  async save(attempt: TestAttempt): Promise<void> {
    const checked = parseAttempt(attempt); const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('attempts', 'readwrite'); const store = tx.objectStore('attempts'); let failure = 'Test attempt could not be saved.';
      const query = store.getAll(); query.onsuccess = () => { try {
        const rows = query.result as TestAttempt[]; const existing = rows.find(row => row.id === checked.id);
        if (existing && (existing.digest !== checked.digest || existing.createdAt !== checked.createdAt || canonicalJson(existing.prepared) !== canonicalJson(checked.prepared) || existing.account && existing.account !== checked.account || existing.transactionData && existing.transactionData !== checked.transactionData || existing.gas && existing.gas !== checked.gas || existing.outerHash && existing.outerHash !== checked.outerHash || existing.transactionHash && existing.transactionHash !== checked.transactionHash || ['FINALIZED', 'REVERTED', 'REJECTED'].includes(existing.status) && canonicalJson(existing) !== canonicalJson(checked))) throw new Error('Immutable test identity, submission hash or terminal state cannot be overwritten.');
        if (existing && existing.status !== 'PREPARED' && checked.status === 'PREPARED') throw new Error('A submitted or attempted test cannot return to an unsent state.');
        const bytes = (row: unknown) => new TextEncoder().encode(JSON.stringify(row)).byteLength;
        const size = rows.filter(row => row.id !== checked.id).reduce((total, row) => total + bytes(row), bytes(checked));
        if (size > 16777216 || rows.length >= 100 && !existing) throw new Error('Test tracking history is full. Export evidence before clearing site data; no records were deleted.');
        store.put(checked);
      } catch (error) { failure = error instanceof Error ? error.message : failure; tx.abort(); } };
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error(failure));
    });
  }
  /** Atomic cross-tab claim: an attempt can reach the signing boundary only once. */
  async claim(id: string, account: string, data: string, gas: string): Promise<TestAttempt> {
    const db = await this.open(); return new Promise((resolve, reject) => {
      const tx = db.transaction('attempts', 'readwrite'); const store = tx.objectStore('attempts'); let next: TestAttempt; let failure = 'Unable to claim the test attempt.';
      const query = store.get(id); query.onsuccess = () => { try {
        const existing = parseAttempt(query.result); if (existing.status !== 'PREPARED') throw new Error('This attempt already reached wallet approval. Track it or inspect wallet activity; do not resend it.');
        next = { ...existing, account, transactionData: data, gas, status: 'AWAITING_WALLET', updatedAt: new Date().toISOString(), message: 'Wallet approval is pending. Reloading or timing out must not send another transaction.', events: [...existing.events, { at: new Date().toISOString(), event: 'wallet_requested', detail: 'One zero-user-value call authorized for this immutable test digest.' }] };
        store.put(parseAttempt(next));
      } catch (error) { failure = error instanceof Error ? error.message : failure; tx.abort(); } };
      tx.oncomplete = () => resolve(next!); tx.onabort = tx.onerror = () => reject(new Error(failure));
    });
  }
  async get(id: string): Promise<TestAttempt | undefined> { const db = await this.open(); return new Promise((resolve, reject) => { const query = db.transaction('attempts').objectStore('attempts').get(id); query.onsuccess = () => { try { resolve(query.result ? parseAttempt(query.result) : undefined); } catch (error) { reject(error); } }; query.onerror = () => reject(new Error('Unable to read test tracking history.')); }); }
  async list(): Promise<TestAttempt[]> { const db = await this.open(); return new Promise((resolve, reject) => { const query = db.transaction('attempts').objectStore('attempts').getAll(); query.onsuccess = () => { const valid: TestAttempt[] = []; let damaged = 0; for (const row of query.result) { try { valid.push(parseAttempt(row)); } catch { damaged++; /* Preserve damaged rows; never submit them. */ } } this.notices = damaged ? [`${damaged} damaged test attempt(s) were preserved but cannot be resumed. Check wallet activity before preparing another call.`] : []; resolve(valid.sort((a, b) => b.createdAt.localeCompare(a.createdAt))); }; query.onerror = () => reject(new Error('Unable to list test tracking history.')); }); }
  async close() { if (this.database) (await this.database).close(); this.database = undefined; }
}
