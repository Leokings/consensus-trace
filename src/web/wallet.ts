import { encodeWalletTransaction, SDK_CHAINS, validatePreparation, validateWalletTransaction, type TestDraft, type PreparedTest } from '../core/execution.js';
import { NETWORKS } from '../core/networks.js';
import { record } from '../core/json.js';
import { BrowserTestStore, type TestAttempt } from './test-store.js';

export interface WalletProvider { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
export function injectedWallet(): WalletProvider | undefined {
  const candidate = (window as unknown as { ethereum?: WalletProvider }).ethereum;
  return candidate && typeof candidate.request === 'function' ? candidate : undefined;
}
function account(value: unknown): string {
  if (!Array.isArray(value) || typeof value[0] !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value[0])) throw new Error('The wallet did not expose a usable account. Connect and approve account access first.');
  return value[0];
}
export async function connectWallet(provider: WalletProvider, network: TestDraft['network']): Promise<string> {
  const sender = account(await provider.request({ method: 'eth_requestAccounts' })); const chain = SDK_CHAINS[network]; const chainId = `0x${chain.id.toString(16)}`;
  if (Number(BigInt(String(await provider.request({ method: 'eth_chainId' })))) !== chain.id) {
    try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
    catch (error) { if (record(error).code !== 4902) throw error; await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: NETWORKS[network].name, rpcUrls: [NETWORKS[network].rpc], nativeCurrency: chain.nativeCurrency, blockExplorerUrls: [NETWORKS[network].explorer] }] }); await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
  }
  if (Number(BigInt(String(await provider.request({ method: 'eth_chainId' })))) !== chain.id) throw new Error('Wallet chain identity does not match the selected test network.');
  return sender;
}
export async function prepareBrowserTest(draft: TestDraft, fetcher: typeof fetch = fetch): Promise<PreparedTest> {
  const response = await fetcher('/api/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft), signal: AbortSignal.timeout(45000) });
  const value: unknown = await response.json(); if (!response.ok) throw new Error(String(record(value).error ?? 'Test preparation failed.'));
  return validatePreparation(value, draft);
}
/** No key access, no server signing, no submission retry. Claim is persisted before the wallet boundary. */
export async function submitTest(attempt: TestAttempt, provider: WalletProvider, store: BrowserTestStore, options: { prepare?: typeof prepareBrowserTest; onChange?: (value: TestAttempt) => void; expectedAccount: string }): Promise<TestAttempt> {
  validatePreparation(attempt.prepared, attempt.draft);
  const fresh = await (options.prepare ?? prepareBrowserTest)(attempt.draft);
  if (fresh.status !== 'READY' || fresh.sourceSha256 !== attempt.prepared.sourceSha256 || fresh.digest !== attempt.digest) throw new Error('Source, chain or test changed since review. No wallet transaction was requested; prepare again.');
  const sender = account(await provider.request({ method: 'eth_accounts' }));
  if (sender.toLowerCase() !== options.expectedAccount.toLowerCase()) throw new Error('Wallet account changed after review. Connect again before approving a test.');
  const chainId = Number(BigInt(String(await provider.request({ method: 'eth_chainId' }))));
  if (chainId !== NETWORKS[attempt.draft.network].chainId) throw new Error('Wallet is on the wrong chain. Connect and switch before approving this test.');
  const transaction = encodeWalletTransaction(attempt.draft, sender); validateWalletTransaction(transaction, attempt.draft, sender);
  let next = await store.claim(attempt.id, sender, transaction.data, transaction.gas); options.onChange?.(next);
  let hash: unknown;
  try {
    // This is the only state-changing provider call. Never wrap it in a retry loop.
    hash = await provider.request({ method: 'eth_sendTransaction', params: [transaction] });
  } catch (error) {
    const rejected = record(error).code === 4001;
    next = { ...next, status: rejected ? 'REJECTED' : 'UNCERTAIN', updatedAt: new Date().toISOString(), message: rejected ? 'Wallet explicitly rejected the transaction. No automatic retry was performed.' : 'Wallet submission did not return a reliable hash. Check wallet activity and attach the outer hash if sent. Do not send this test again.', events: [...next.events, { at: new Date().toISOString(), event: rejected ? 'wallet_rejected' : 'submission_uncertain', detail: 'No automatic resubmission.' }] };
    await store.save(next); options.onChange?.(next); return next;
  }
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash) || /^0x0{64}$/.test(hash)) {
    next = { ...next, status: 'UNCERTAIN', updatedAt: new Date().toISOString(), message: 'Wallet returned an invalid submission hash. Check wallet activity; do not resend.', events: [...next.events, { at: new Date().toISOString(), event: 'submission_uncertain', detail: 'Returned hash was not usable.' }] };
  } else {
    next = { ...next, status: 'SUBMITTED', outerHash: hash, updatedAt: new Date().toISOString(), message: 'Submission hash saved. Only read-only tracking will follow.', events: [...next.events, { at: new Date().toISOString(), event: 'submitted', detail: hash }] };
  }
  // Surface the hash even if storage fails, so it can be copied out of the browser.
  options.onChange?.(next);
  try { await store.save(next); } catch { throw new Error(`Wallet returned ${String(hash)} but browser persistence failed. COPY THIS HASH and inspect wallet activity. Do not resubmit.`); }
  return next;
}
