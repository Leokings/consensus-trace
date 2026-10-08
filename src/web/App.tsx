import { useCallback, useEffect, useRef, useState } from 'react';
import type { NetworkId, RunRecord } from '../core/types.js';
import { Badge, ReportView } from './ReportView.js';
import { configureClient, request, type Config } from './client.js';
import type { History } from './storage.js';

const defaultAssertions = JSON.stringify([{ label: 'Stored verdict for verification 1', method: 'get_verification', args: [1], pointer: '/verdict', operator: 'equals', expected: 'SUPPORTED' }], null, 2);

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState<{ id: string; sha256: string } | null>(null);
  const [mode, setMode] = useState<'live' | 'demo'>('demo');
  const [fixture, setFixture] = useState('execution-error');
  const [network, setNetwork] = useState<NetworkId>('bradbury');
  const [caseName, setCaseName] = useState('Grounding verifier · current finalized verdict');
  const [address, setAddress] = useState('0xb08773A551302B816F6bF3cce914D266b5C1a461');
  const [transaction, setTransaction] = useState('0x7e72eb0d3673b4e7fde739437c21931009751dc9b3129b3921285b5ad8ed00ba');
  const [repo, setRepo] = useState('Leokings/agent-output-grounding-verifier');
  const [commit, setCommit] = useState('b95bc1f8a7c41a2c880b7da8fbeef2247cd1a99f');
  const [file, setFile] = useState('contracts/AgentOutputGroundingVerifier.py');
  const [assertions, setAssertions] = useState(defaultAssertions);
  const [includeTrace, setIncludeTrace] = useState(false);
  const [traceRound, setTraceRound] = useState('0');
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshHistory = useCallback(async () => { setHistory(await request<History[]>('/api/runs')); }, []);

  useEffect(() => {
    const controller = new AbortController();
    void request<Config>('/api/config', { signal: controller.signal }).then(async settings => {
      if (controller.signal.aborted) return;
      configureClient(settings); const rows = await request<History[]>('/api/runs', { signal: controller.signal });
      if (controller.signal.aborted) return;
      setConfig(settings); setHistory(rows); if (rows[0]) setSelectedId(rows[0].id);
      if (settings.storage === 'browser') setMode('live');
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load the workbench API.'); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setRun(null);
    const poll = async () => {
      try {
        const next = await request<RunRecord>(`/api/runs/${selectedId}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setRun(next);
        if (next.status === 'collecting') pollTimer.current = setTimeout(() => { void poll(); }, 1200);
        else { await refreshHistory(); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Report fetch failed.'); }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(pollTimer.current); };
  }, [selectedId, refreshHistory]);

  async function inspect(event: React.FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const input = mode === 'demo' ? { fixtureId: fixture } : { name: caseName, network, contractAddress: address.trim(), transactionHash: transaction.trim(),
        ...(repo.trim() || commit.trim() || file.trim() ? { source: { repository: repo.trim(), commit: commit.trim(), path: file.trim() } } : {}),
        assertions: JSON.parse(assertions), includeTrace, traceRound: Number(traceRound),
      };
      const next = await request<RunRecord>(mode === 'demo' ? '/api/fixtures' : '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      setSelectedId(next.id); await refreshHistory();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Inspection failed.'); }
    finally { setBusy(false); }
  }
  async function refresh() {
    if (!selectedId) return; setBusy(true); setError('');
    try { const next = await request<RunRecord>(`/api/runs/${selectedId}/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); setSelectedId(next.id); await refreshHistory(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Refresh failed.'); }
    finally { setBusy(false); }
  }
  async function exportEvidence() {
    if (!run?.report) return; setBusy(true); setError('');
    try {
      const { buildBundle } = await import('../core/bundle.js'); const bundle = buildBundle(run.report);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bundle.bytes)], { type: 'application/zip' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `consensus-trace-${run.id}.zip`; document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setExported({ id: run.id, sha256: bundle.sha256 });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Evidence export failed.'); }
    finally { setBusy(false); }
  }
  const collecting = run?.status === 'collecting';
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="/" aria-label="Consensus Trace home"><span className="brand-symbol">⌘</span><span>CONSENSUS<span className="brand-light"> TRACE</span></span><span className="version">v0.1</span></a><div className="topbar-right"><span className="read-only"><span className="status-dot" /> READ-ONLY WORKBENCH</span><a href="https://docs.genlayer.com/developers/decentralized-applications/querying-a-transaction" target="_blank" rel="noreferrer">Protocol docs ↗</a></div></header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-heading"><span className="eyebrow">INVESTIGATE A RUN</span><span className="tiny">01 — 04</span></div>
        <div className="mode-switch" aria-label="Inspection mode"><button type="button" aria-pressed={mode === 'demo'} className={mode === 'demo' ? 'active' : ''} onClick={() => setMode('demo')}>Demo fixtures</button><button type="button" aria-pressed={mode === 'live'} className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}>Live transaction</button></div>
        <form onSubmit={event => { void inspect(event); }}>
          {mode === 'demo' ? <div className="demo-setup"><label htmlFor="fixture">Choose a diagnostic scenario</label><select id="fixture" value={fixture} onChange={event => setFixture(event.target.value)}>{config?.fixtures.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><p>{config?.fixtures.find(item => item.id === fixture)?.detail}</p><div className="demo-label">SYNTHETIC ONLY</div><p className="small-note">Fixtures demonstrate the workbench. They never contact GenLayer and must not be submitted as network evidence.</p></div> : <>
            <label htmlFor="network">Network</label><select id="network" value={network} onChange={event => setNetwork(event.target.value as NetworkId)}>{config?.networks.map(item => <option value={item.id} key={item.id}>{item.name} · {item.chainId}</option>)}</select>
            <label htmlFor="case-name">Case name</label><input id="case-name" value={caseName} maxLength={100} required onChange={event => setCaseName(event.target.value)} />
            <label htmlFor="contract">Contract address</label><input id="contract" className="mono" value={address} required spellCheck={false} onChange={event => setAddress(event.target.value)} />
            <label htmlFor="transaction">GenLayer transaction ID</label><textarea id="transaction" className="mono short" value={transaction} required spellCheck={false} onChange={event => setTransaction(event.target.value)} /><p className="field-note">Use the GenLayer ID, not the outer EVM hash.</p>
            <details className="form-section" open><summary>Source provenance <span>OPTIONAL</span></summary><label htmlFor="repo">Public GitHub repository</label><input id="repo" value={repo} placeholder="owner/repository" spellCheck={false} onChange={event => setRepo(event.target.value)} /><label htmlFor="commit">Full commit SHA</label><input id="commit" className="mono" value={commit} spellCheck={false} onChange={event => setCommit(event.target.value)} /><label htmlFor="file">Exact contract file</label><input id="file" className="mono" value={file} spellCheck={false} onChange={event => setFile(event.target.value)} /><p className="field-note">Public source only. No GitHub credentials are requested.</p></details>
            <details className="form-section"><summary>Result assertions <span>JSON</span></summary><label htmlFor="assertions">View assertions</label><textarea id="assertions" className="mono json-input" value={assertions} onChange={event => setAssertions(event.target.value)} spellCheck={false} /><p className="field-note">Up to 8 checks. Reads use current latest-final state. Exact equality preserves types; large integers are strings.</p></details>
            {config?.tracesEnabled === false ? <p className="field-note">Replay-capable debug traces and localnet are disabled on the public site. They remain available in the local CLI.</p> : <details className="form-section"><summary>Optional debug trace</summary><label className="checkbox-label"><input type="checkbox" checked={includeTrace} onChange={event => setIncludeTrace(event.target.checked)} /> Request execution trace</label><p className="field-note">Opt-in: the node may replay execution to reconstruct missing logs. This can consume node/model resources.</p><label htmlFor="round">Round</label><input id="round" type="number" min="0" max="255" value={traceRound} onChange={event => setTraceRound(event.target.value)} /></details>}
          </>}
          <button className="primary inspect-button" type="submit" disabled={!config || busy || collecting}>{busy || collecting ? 'Collecting evidence…' : mode === 'demo' ? 'Inspect demo fixture' : 'Inspect live transaction'}<span>↗</span></button>
        </form>
        <div className="history"><div className="sidebar-heading"><span className="eyebrow">SAVED INSPECTIONS</span><span className="tiny">{history.length}</span></div>{history.length ? history.map(item => <button key={item.id} className={`history-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => { setError(''); setSelectedId(item.id); }}><span className={`history-dot ${item.conclusion?.toLowerCase() ?? ''}`} /><span><strong>{item.input.name}</strong><small>{item.origin === 'fixture' ? 'DEMO' : item.input.network.toUpperCase()} · {item.status === 'complete' ? item.id.slice(0, 8) : item.status}</small></span></button>) : <p className="small-note">Your reports stay on this computer. Refreshes create new snapshots of the same transaction.</p>}</div>
        <div className="sidebar-bottom"><span className="eyebrow">NO KEYS. NO WRITES.</span><p>Observe first.<br />Never guess the cause.</p>{config?.storage === 'browser' ? <p className="small-note">History stays in this browser. Export evidence before clearing site data. No account or shared database is required.</p> : null}</div>
      </aside>
      <main className="main-panel">
        <div className="workspace-heading"><div><span className="eyebrow">GENLAYER / DEVELOPER TOOLING</span><h1>Follow the evidence.</h1><p>Source → consensus → execution → finalized state.</p></div><span className="workspace-mark">CT / 001</span></div>
        {error ? <div className="error-banner" role="alert"><strong>Inspection needs attention.</strong><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div> : null}
        {collecting ? <section className="loading-panel" role="status"><div className="loader" /><h2>Collecting bounded evidence.</h2><p>The transaction ID is already saved. Requests have time and size limits; no transaction will be resubmitted.</p></section> : run?.report ? <><ReportView key={run.id} report={run.report} onRefresh={() => { void refresh(); }} onExport={config?.storage === 'browser' ? () => { void exportEvidence(); } : undefined} busy={busy} />{exported?.id === run.id ? <div className="hash-block"><span>EXPORTED ZIP SHA-256 · preserve separately</span><code>{exported.sha256}</code></div> : null}</> : run?.status === 'interrupted' ? <section className="empty-panel"><Badge value="INTERRUPTED" tone="amber" /><h2>The inspection was interrupted.</h2><p>{run.failure ?? 'The transaction ID was preserved. Resume a fresh read-only snapshot without sending a transaction.'}</p><button className="primary" disabled={busy} onClick={() => { void refresh(); }}>Resume inspection</button></section> : <section className="empty-panel"><div className="trace-illustration" aria-hidden="true"><span className="trace-node">01</span><i /><span className="trace-node">02</span><i /><span className="trace-node alert-node">!</span><i /><span className="trace-node hollow">04</span></div><div className="eyebrow">A RECEIPT IS NOT THE WHOLE STORY</div><h2>Accepted doesn’t always<br />mean it worked.</h2><p>Connect the exact source, the recorded execution result and your expected finalized values. Get a report that separates what happened from what is still unknown.</p><div className="empty-capabilities"><span>✓ Commit-pinned source</span><span>✓ Execution-aware diagnostics</span><span>✓ Review-ready evidence ZIP</span></div><p className="empty-hint">Choose a demo fixture on the left, or inspect an existing live transaction.</p></section>}
        <footer className="page-footer"><span>CONSENSUS TRACE</span><span>Observed failures. Explicit unknowns. Reproducible evidence.</span><span>LOCAL-FIRST · MIT</span></footer>
      </main>
    </div>
  </div>;
}
