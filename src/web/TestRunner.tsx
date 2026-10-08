import { useEffect, useRef, useState } from 'react';
import { canonicalJson, jsonSafe, record } from '../core/json.js';
import { parseTestDraft, resolveSubmission, traceCaseForTest, type PreparedTest, type Resolution, type TestDraft } from '../core/execution.js';
import type { Evidence, RunRecord, TraceReport } from '../core/types.js';
import { BrowserTestStore, newAttempt, type TestAttempt } from './test-store.js';
import { connectWallet, injectedWallet, prepareBrowserTest, submitTest } from './wallet.js';
import { request } from './client.js';
import { Badge, ReportView } from './ReportView.js';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export async function resolveBrowserAttempt(attempt: TestAttempt, fetcher: typeof fetch = fetch): Promise<Resolution> {
  if (!attempt.outerHash || !attempt.account || !attempt.transactionData || !attempt.gas) throw new Error('Submission identity is incomplete. Check wallet activity; do not resubmit.');
  const input = { draft: attempt.draft, sender: attempt.account, outerHash: attempt.outerHash, data: attempt.transactionData, gas: attempt.gas };
  const response = await fetcher('/api/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(45000) });
  const value: unknown = await response.json(); if (!response.ok) throw new Error(String(record(value).error ?? 'Submission resolution failed.'));
  const evidence = record(value).observations; if (!Array.isArray(evidence) || evidence.length > 2) throw new Error('Invalid submission resolution evidence.');
  let index = 0;
  const derived = await resolveSubmission(input, { rpc: async (_network, method) => { const item = evidence[index++] as Evidence; if (!item || item.method !== method) throw new Error('Resolution evidence is not bound to the requested RPC sequence.'); return item; }, source: async () => { throw new Error('Unexpected source read.'); } });
  if (canonicalJson(derived) !== canonicalJson(value)) throw new Error('Returned submission resolution is inconsistent.');
  return derived;
}

export function TestRunner({ initial, onReport }: { initial: Partial<TestDraft>; onReport: (run: RunRecord) => void }) {
  const [text, setText] = useState(() => JSON.stringify({ name: 'Authorized contract test', network: initial.network ?? 'bradbury', contractAddress: initial.contractAddress ?? '', source: initial.source ?? { repository: '', commit: '', path: '' }, method: '', args: [], assertions: [], gasLimit: 500000 }, null, 2));
  const [prepared, setPrepared] = useState<PreparedTest | null>(null);
  const [attempt, setAttempt] = useState<TestAttempt | null>(null); const [history, setHistory] = useState<TestAttempt[]>([]);
  const [report, setReport] = useState<TraceReport | null>(null);
  const [wallet, setWallet] = useState(''); const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false); const [tracking, setTracking] = useState(false); const [error, setError] = useState('');
  const [attachHash, setAttachHash] = useState(''); const [exportHash, setExportHash] = useState('');
  const store = useRef<BrowserTestStore | null>(null); if (!store.current) store.current = new BrowserTestStore();
  const stop = useRef(false); const trackingLock = useRef(false);
  const reload = async () => setHistory(await store.current!.list());
  useEffect(() => {
    let active = true;
    const fragment = location.hash.match(/^#test=([A-Za-z0-9_-]+)$/);
    void store.current!.list().then(rows => { if (active) { setHistory(rows); if (rows[0] && !fragment) { setAttempt(rows[0]); setPrepared(rows[0].prepared); setText(JSON.stringify(rows[0].draft, null, 2)); } } }).catch(error => { if (active) setError(error instanceof Error ? error.message : 'Test history unavailable.'); });
    if (fragment && fragment[1].length <= 10000) { try { const decoded = atob(fragment[1].replaceAll('-', '+').replaceAll('_', '/')); const draft = parseTestDraft(JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, char => char.charCodeAt(0))))); setText(JSON.stringify(draft, null, 2)); } catch { setError('The agent handoff contains an invalid test. No wallet request was made.'); } }
    return () => { active = false; stop.current = true; };
  }, []);
  async function prepare() {
    setError(''); setBusy(true); setApproved(false); setReport(null); setPrepared(null); setAttempt(null);
    try { const result = await prepareBrowserTest(parseTestDraft(JSON.parse(text))); setPrepared(result); if (result.status === 'READY') { const row = newAttempt(result); await store.current!.save(row); setAttempt(row); await reload(); } }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Preparation failed.'); }
    finally { setBusy(false); }
  }
  async function connect() {
    setError(''); setBusy(true); setApproved(false);
    try { const provider = injectedWallet(); if (!provider) throw new Error('No injected EIP-1193 wallet found. Open this site in a browser with MetaMask or another compatible wallet. No private keys are requested.'); const draft = prepared?.draft ?? parseTestDraft(JSON.parse(text)); setWallet(await connectWallet(provider, draft.network)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Wallet connection failed.'); }
    finally { setBusy(false); }
  }
  async function track(row: TestAttempt) {
    if (trackingLock.current || !row.outerHash || ['FINALIZED', 'REVERTED', 'REJECTED'].includes(row.status)) return;
    trackingLock.current = true; stop.current = false; setTracking(true); setError(''); const deadline = Date.now() + 900000;
    try {
      while (!stop.current && Date.now() < deadline) {
        let next = (await store.current!.get(row.id))!;
        if (!next.transactionHash) {
          const resolution = await resolveBrowserAttempt(next);
          if (resolution.status === 'REVERTED') { next = { ...next, status: 'REVERTED', updatedAt: new Date().toISOString(), message: resolution.reason, events: [...next.events, { at: new Date().toISOString(), event: 'evm_reverted', detail: resolution.reason }] }; await store.current!.save(next); setAttempt(next); await reload(); break; }
          if (resolution.status !== 'RESOLVED') { setError(resolution.reason); for (let i = 0; i < 30 && !stop.current; i++) await sleep(1000); continue; }
          next = { ...next, status: 'TRACKING', transactionHash: resolution.transactionHash!, updatedAt: new Date().toISOString(), message: 'GenLayer ID resolved. Tracking stored finality and execution.', events: [...next.events, { at: new Date().toISOString(), event: 'id_resolved', detail: resolution.transactionHash! }] }; await store.current!.save(next); setAttempt(next);
        }
        const input = traceCaseForTest(next.draft, next.transactionHash!);
        let run = await request<RunRecord>('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
        const collectionDeadline = Date.now() + 70000;
        while (run.status === 'collecting' && Date.now() < collectionDeadline && !stop.current) { await sleep(1000); run = await request<RunRecord>(`/api/runs/${run.id}`); }
        if (stop.current) break;
        if (!run.report || run.status !== 'complete') throw new Error(run.failure ?? 'Inspection did not complete. Resume read-only tracking; do not resend.');
        if (canonicalJson(run.report.input) !== canonicalJson(input) || run.report.origin !== 'live') throw new Error('Tracking report does not match this test.');
        const final = run.report.network.chainVerified && run.report.identity.transactionMatches && run.report.identity.recipientMatches && run.report.receipt.finalized && !run.report.receipt.inconsistencies.length;
        next = { ...next, status: final ? 'FINALIZED' : 'TRACKING', reportId: run.id, updatedAt: new Date().toISOString(), message: final ? `Stored finality recorded. Execution: ${run.report.receipt.execution}; result checks: ${run.report.conclusion}.` : `Stored status: ${run.report.receipt.storedStatus}. This observation timeout is not a protocol verdict.`, events: final ? [...next.events, { at: new Date().toISOString(), event: 'finalized', detail: `${run.report.receipt.execution} / ${run.report.conclusion}` }] : next.events };
        await store.current!.save(next); setAttempt(next); setReport(run.report); onReport(run); await reload();
        if (final) break;
        for (let i = 0; i < 30 && !stop.current; i++) await sleep(1000);
      }
      if (Date.now() >= deadline) setError('Tracking paused after 15 minutes. The transaction is not resubmitted. Resume this same ID later; this is not proof of a protocol timeout.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Read-only tracking failed.'); }
    finally { trackingLock.current = false; setTracking(false); await reload().catch(() => undefined); }
  }
  async function send() {
    if (!attempt || !approved || !wallet || busy || tracking) return; setBusy(true); setError('');
    try { const provider = injectedWallet(); if (!provider) throw new Error('Wallet provider is unavailable.'); const next = await submitTest(attempt, provider, store.current!, { onChange: setAttempt, expectedAccount: wallet }); setAttempt(next); await reload(); if (next.outerHash) void track(next); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Wallet request failed.'); const current = await store.current!.get(attempt.id); if (current) setAttempt(current); }
    finally { setBusy(false); }
  }
  async function attach() {
    if (!attempt || !/^0x[a-f0-9]{64}$/i.test(attachHash) || /^0x0{64}$/i.test(attachHash)) { setError('Enter the exact outer transaction hash from wallet activity.'); return; }
    try { const next: TestAttempt = { ...attempt, outerHash: attachHash, status: 'SUBMITTED', updatedAt: new Date().toISOString(), message: 'Manually attached hash must be verified against the persisted test before tracking.', events: [...attempt.events, { at: new Date().toISOString(), event: 'hash_attached', detail: attachHash }] }; await store.current!.save(next); setAttempt(next); void track(next); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to attach hash.'); }
  }
  async function exportRun() {
    if (!attempt || !report || report.input.transactionHash.toLowerCase() !== attempt.transactionHash?.toLowerCase() || canonicalJson(report.input) !== canonicalJson(traceCaseForTest(attempt.draft, attempt.transactionHash!))) { setError('Select the matching completed report before exporting this test.'); return; }
    try { const { buildBundle } = await import('../core/bundle.js'); const bundle = buildBundle(report, jsonSafe(attempt)); const url = URL.createObjectURL(new Blob([new Uint8Array(bundle.bytes)], { type: 'application/zip' })); const link = document.createElement('a'); link.href = url; link.download = `consensus-trace-test-${attempt.id}.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setExportHash(bundle.sha256); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Test evidence export failed.'); }
  }
  async function select(row: TestAttempt) { if (tracking || busy) return; setText(JSON.stringify(row.draft, null, 2)); setAttempt(row); setPrepared(row.prepared); setApproved(false); setReport(null); setExportHash(''); setError(''); if (row.reportId) { try { const run = await request<RunRecord>(`/api/runs/${row.reportId}`); setReport(run.report ?? null); } catch { setError('The saved report is unavailable. Preserve this transaction ID and make a new read-only inspection.'); } } }
  async function refreshReport() {
    if (!attempt?.transactionHash || busy || tracking) return;
    setBusy(true); setError('');
    try { let run = await request<RunRecord>('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(traceCaseForTest(attempt.draft, attempt.transactionHash)) }); const deadline = Date.now() + 70000; while (run.status === 'collecting' && Date.now() < deadline) { await sleep(1000); run = await request<RunRecord>(`/api/runs/${run.id}`); } if (!run.report) throw new Error(run.failure ?? 'Inspection incomplete. Retry a read-only refresh.'); setReport(run.report); onReport(run); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Refresh failed.'); }
    finally { setBusy(false); }
  }
  const currentPreparation = prepared ?? attempt?.prepared;
  return <section className="test-runner" aria-label="Authorized test runner">
    <div className="provenance live"><span className="status-dot" />WALLET-AUTHORIZED TEST · ZERO USER-VALUE · NO PRIVATE KEYS</div>
    <div className="report-heading"><div><div className="eyebrow">PREPARE → REVIEW → APPROVE → TRACK</div><h2>Run the exact test.</h2><p>Only your wallet sends the call. The server collects read-only evidence.</p></div><Badge value={attempt?.status ?? 'DRAFT'} tone={attempt?.status === 'FINALIZED' ? 'green' : 'amber'} /></div>
    {error ? <div className="error-banner" role="alert"><span>{error}</span></div> : null}
    {store.current.notices.map(notice => <div className="error-banner" role="alert" key={notice}>{notice}</div>)}
    <label htmlFor="test-draft">Contract test case · public JSON</label><textarea id="test-draft" className="mono test-json" value={text} disabled={busy || tracking} spellCheck={false} onChange={event => { setText(event.target.value); setPrepared(null); setAttempt(null); setReport(null); setApproved(false); }} />
    <p className="field-note">method and args are a state-changing public-write call. source must pin the exact deployed file. Wallet-displayed fees require approval; transferred user value is fixed at zero. No deployments, appeals or automatic finalize calls are sent.</p>
    <div className="button-row"><button className="secondary" disabled={busy || tracking} onClick={() => { void prepare(); }}>{busy ? 'Working…' : '1. Prepare & verify source'}</button><button className="secondary" disabled={busy || tracking || currentPreparation?.status !== 'READY'} onClick={() => { void connect(); }}>2. Connect & switch wallet</button></div>
    {currentPreparation ? <div className="test-review"><div className="finding-title"><h3>Exact call review</h3><Badge value={currentPreparation.status} tone={currentPreparation.status === 'READY' ? 'green' : 'red'} /></div><p>{currentPreparation.draft.network} · {currentPreparation.draft.contractAddress}</p><pre>{currentPreparation.draft.method}({JSON.stringify(currentPreparation.draft.args)}){currentPreparation.draft.kwargs ? ` kwargs=${JSON.stringify(currentPreparation.draft.kwargs)}` : ''}</pre><div className="hash-block"><span>TEST DIGEST</span><code>{currentPreparation.digest}</code><span>DEPLOYED / PINNED SOURCE SHA-256</span><code>{currentPreparation.sourceSha256 ?? 'Unverified'}</code><span>GAS LIMIT / ZERO USER VALUE</span><code>{currentPreparation.draft.gasLimit} / 0</code><span>CONNECTED ACCOUNT</span><code>{wallet || 'Not connected'}</code></div>{currentPreparation.reasons.map(reason => <p key={reason}>{reason}</p>)}<p className="small-note">Annotations identify the method; this is not a contract security audit. Even a zero-value call can change consequential application state. Inspect its code and arguments.</p><label className="checkbox-label"><input type="checkbox" checked={approved} disabled={attempt?.status !== 'PREPARED' || busy || tracking} onChange={event => setApproved(event.target.checked)} />I authorize this exact test call and its wallet-displayed fees.</label><button className="primary" disabled={!approved || !wallet || attempt?.status !== 'PREPARED' || busy || tracking || currentPreparation.status !== 'READY'} onClick={() => { void send(); }}>3. Approve one wallet transaction</button></div> : null}
    {attempt ? <div className="test-tracking"><h3>Submission tracking</h3><p role="status">{attempt.message}</p><div className="hash-block"><span>OUTER EVM SUBMISSION HASH</span><code>{attempt.outerHash ?? 'Not reliably returned'}</code><span>GENLAYER TRANSACTION ID</span><code>{attempt.transactionHash ?? 'Awaiting verified resolution'}</code></div>{!attempt.outerHash && ['AWAITING_WALLET', 'UNCERTAIN'].includes(attempt.status) ? <div><label htmlFor="attach-hash">Recover an already-sent outer hash from wallet activity</label><input id="attach-hash" className="mono" value={attachHash} onChange={event => setAttachHash(event.target.value)} /><button className="secondary" onClick={() => { void attach(); }}>Attach hash · read-only verification</button></div> : null}<div className="button-row">{tracking ? <button className="secondary" onClick={() => { stop.current = true; }}>Pause tracking · never resend</button> : <button className="secondary" disabled={!attempt.outerHash || ['FINALIZED', 'REVERTED', 'REJECTED'].includes(attempt.status)} onClick={() => { void track(attempt); }}>Resume same transaction · read-only</button>}<button className="secondary" disabled={!report} onClick={() => { void exportRun(); }}>Export test + report evidence ZIP</button></div><details><summary>Attempt event trail</summary><pre>{JSON.stringify(attempt.events, null, 2)}</pre></details></div> : null}
    {exportHash ? <div className="hash-block"><span>TEST ZIP SHA-256 · preserve separately</span><code>{exportHash}</code></div> : null}
    {report ? <ReportView report={report} busy={tracking || busy} onRefresh={() => { void refreshReport(); }} onExport={() => { void exportRun(); }} /> : null}
    <details className="test-history"><summary>Saved test attempts · {history.length}</summary>{history.map(row => <button className="history-item" key={row.id} disabled={busy || tracking} onClick={() => { void select(row); }}><span><strong>{row.draft.name}</strong><small>{row.status} · {row.id.slice(0, 8)}</small></span></button>)}</details>
  </section>;
}
