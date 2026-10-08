# Architecture

```text
React workbench ─┐
CLI ────────────┼─> validated case -> shared inspector -> deterministic findings -> evidence bundle
MCP stdio ──────┘                         |
                       fixed-network HTTP collector / explicit fixture collector
                                         |
                         local SQLite / browser IndexedDB snapshots
```

The UI is presentation, not a second diagnostic implementation. There is no consensus-critical LLM inside this tool; it inspects the outputs of actual Intelligent Contract consensus.

## Collection sequence

1. Validate bounded case inputs and persist a collecting record containing the existing transaction ID.
2. Retrieve chain ID, receipt, optional lifecycle projection and pinned public source independently in parallel.
3. Normalize stored status, authoritative leader execution, available rounds and votes. Do not equate consensus acceptance with successful execution.
4. Verify chain ID, receipt transaction ID and recipient. Do not make subject-contract reads if these bindings fail.
5. Retrieve deployed source and schema. Compare exact source hashes and separately compare CRLF-to-LF hashes.
6. If the bound receipt records finalized success, collect bounded `latest-final` view results. Evaluate assertions deterministically; no arbitrary expressions.
7. Retrieve a debug trace only when explicitly requested. Mark replay provenance unknown.
8. Derive multiple evidence-linked findings, redact recognized credentials, and persist a completed snapshot.
9. Export a reproducible ZIP with an integrity manifest. Never publish automatically.

Refreshing creates a new report referencing the previous report ID and preserving the transaction ID. It does not mutate the old report or resubmit the transaction.

## Data distinctions

- Stored receipt status is separate from projected lifecycle/action.
- Leader execution is separate from round agreement.
- Client retrieval deadline is separate from protocol timeout evidence.
- Current finalized state is separate from historical transaction-time state.
- Current deployed source is separate from independently proven transaction-time source.
- Observed timeout/disagreement is separate from suspected prompt/provider/node causes.
- Missing RPC evidence is separate from frontend staleness.
- Live observations are separate from synthetic fixture examples.
- Exported-file hashes are separate from authenticity or truth proofs.

## Interfaces

`core/inspect.ts` exposes `inspectCase(input, collector, options)`. Collectors implement only bounded `rpc(network, method, params)` and `source(ref)` operations. Evidence is an explicit `ok`, `error` or `skipped` union.

The local Node API exposes config, saved runs, new inspections, explicit fixtures, refresh and bundle download. No generic RPC proxy, file browser or blockchain-write endpoint exists.

The Vercel website exposes only configuration and a bounded stateless inspection Function. The browser persists the existing transaction ID before invoking the Function, validates returned report identity, stores the redacted result in IndexedDB and generates ZIP exports locally. Refresh creates another browser record and re-inspects the same transaction. Neither SQLite nor browser history is uploaded with a deployment. No hosted localnet or debug replay endpoint exists.

Hosted request concurrency/rate tracking is in memory per Function instance, not a global quota. Response-size and deadline failures leave an explicitly interrupted browser record, rather than claiming a protocol timeout. Large reports and full browser storage fail visibly instead of silently truncating or deleting evidence.

The published npm GenLayer SDK is pinned to 1.1.8 for calldata encode/decode and read-call serialization. Receipt/lifecycle collection uses documented JSON-RPC methods directly so newer execution codes are not silently dropped by older SDK maps. Older Studio methods are handled by explicit network-specific receipt collection, not by substituting Bradbury ABIs or guessing protocol projections.

## Next release boundaries

- Wallet-authorized test runner with explicit network, contract, method, value, fee cap and test authorization.
- Persist returned transaction ID immediately; resume collection without auto-resubmission.
- Equivalent frontend instrumentation before introducing a stale-frontend finding.
- Opt-in external network-health context, potentially using Probe.EXE data.
- Additional verified receipt fixtures as GenLayer's API evolves.

No one of these is implied to be implemented in v0.1.
