# Consensus Trace

A **read-only live test verification workbench** for GenLayer Intelligent Contracts, with a Vercel website and a local CLI/MCP edition. It connects a GenLayer transaction ID, the subject contract, a commit-pinned public source file and expected current finalized-state values into one reproducible evidence report.

This is developer tooling, not another Intelligent Contract, an offline determinism fuzzer, or a network-wide health dashboard.

## Website

[Open Consensus Trace](https://consensus-trace-leokings588-5902s-projects.vercel.app/).

The hosted website uses a bounded, stateless Vercel API to inspect StudioNet and Bradbury transactions. Open **Inspect live**, supply an existing transaction and contract, optionally add a pinned public source and view assertions, then inspect the result. The included live example is prefilled.

History stays in that browser's IndexedDB; there is no shared history database or account. Reload to reopen a saved report. **Refresh receipt** makes a new snapshot of the same transaction, not a new blockchain transaction. **Export evidence ZIP** builds the bundle in your browser and displays its independent SHA-256 digest.

Submitted cases are sent to the hosted API and the necessary RPC/public-source services. Clearing browser storage removes that browser's history. Interrupted requests can be refreshed explicitly; they are never automatically resubmitted. Hosted localnet access and optional replay-capable debug traces are disabled.

## Start locally

Requires Node.js **24.11+** (the local store uses built-in SQLite).

```powershell
cd C:\Users\leoki\Genlayer\consensus-trace
npm ci
npm run dev
```

Open <http://127.0.0.1:3910>. The local API binds only to loopback and rejects unexpected Host/Origin headers. SQLite history, localnet and opt-in debug tracing are available in this edition.

Production locally:

```text
npm run build
npm start
```

Do not run development and production servers on the same port at once. `PORT` selects a different loopback port. `TRACE_DATA_DIR` selects a local data directory; default `.local/`. The database, generated exports and dependency folders are ignored by Git.

## What v0.1 does

- Inspects an **existing GenLayer transaction** on StudioNet or Bradbury; the local edition also supports localnet.
- Verifies the RPC chain ID, returned transaction identity and receipt recipient before application-state reads.
- Separates stored lifecycle/finality from leader execution outcome and validator votes.
- Supports modern `gen_getTransactionReceipt` and Studio's `eth_getTransactionByHash` receipt shape.
- Ignores quorum-cancelled validator entries mixed into Studio's `leader_receipt` array when identifying the leader result.
- Compares deployed UTF-8 source with a **full 40-character commit-pinned public GitHub file**. Exact bytes and CRLF-to-LF matches are different outcomes.
- Runs up to eight bounded view assertions against **current `latest-final` state**.
- Saves a transaction ID before collection starts, keeps immutable report snapshots, and refreshes the same transaction without sending it again.
- Exports a redacted ZIP with a Markdown report, JSON report, input, observations, assertion results, source text and SHA-256 manifest.
- Supplies a bundle verifier, CLI, seven explicitly synthetic fixtures and a stdio MCP server.
- Offers opt-in debug tracing in the local edition. The endpoint can reconstruct missing logs by replaying execution; provenance remains explicitly unknown.

**No private keys, wallet connection, transaction submission, deployment, appeal, cancellation or finalization.** No LLM is used to invent a root cause. Public source only; this version never requests GitHub credentials.

## Inspect an existing transaction

The included Bradbury example references an earlier, independently deployed Grounding Verifier. Running this command sends **reads only**; it does not deploy Consensus Trace or reproduce that transaction.

```text
npm run trace -- inspect examples/bradbury-existing.json --out exports/smoke
npm run trace -- inspect examples/studionet-existing.json --out exports/studio
npm run trace -- demo execution-error --out exports/demo
npm run trace -- get REPORT_UUID
```

Do not submit a demo ZIP as live network evidence. A Studio example intentionally has no pinned source or application assertions; it cannot produce `CHECKS_PASSED` even if its execution succeeded.

The CLI writes uniquely named ZIP/hash files with exclusive creation; it does not silently overwrite an existing export.

## Assertions

```json
{
  "label": "Stored verdict for request 1",
  "method": "get_verification",
  "args": [1],
  "pointer": "/verdict",
  "operator": "equals",
  "expected": "SUPPORTED",
  "parseJson": false
}
```

Operators: `equals`, `exists`, `contains`, `gte`, `lte`. Paths are RFC 6901 JSON pointers, not executable expressions. Use `parseJson: true` only for a view returning a JSON **string**. Exact equality preserves types; GenVM big integers are represented as decimal strings. Integer inequalities avoid floating-point conversion. Unsafe-size JSON numbers, duplicate assertion labels, unpinned commits, arbitrary RPC URLs and path traversal are rejected.

`CHECKS_PASSED` requires a verified chain and receipt binding, stored finality, successful execution, exact source match, and at least one assertion with all requested assertions passing. It is **not a security audit**.

## Evidence verification

```text
npm run verify:bundle -- exports/smoke/REPORT_UUID.zip --sha256 TRUSTED_ZIP_SHA256
```

Without an external trusted ZIP digest the verifier checks **internal integrity only**, not authorship/authenticity. Manifest hashes describe exported bytes. Source hashes describe the originally captured text before any redaction. ZIP member timestamps are fixed for reproducible hashes. ZIP validation rejects unsafe paths, unlisted or missing files, wrong hashes and oversized archives.

## MCP

Example server configuration (adjust Node path and working directory for your client):

```json
{
  "mcpServers": {
    "consensus-trace": {
      "command": "node",
      "args": ["--import", "C:/Users/leoki/Genlayer/consensus-trace/node_modules/tsx/dist/loader.mjs", "C:/Users/leoki/Genlayer/consensus-trace/src/mcp/index.ts"],
      "env": { "TRACE_DATA_DIR": "C:/Users/leoki/Genlayer/consensus-trace/.local" }
    }
  }
}
```

From this folder, `npm run mcp --silent` also starts the stdio server. Keep stdout protocol-only.

Tools: `inspect_transaction`, `get_report`, `list_reports`, `evidence_manifest`. Inspection writes a local record but never modifies chain state; its MCP annotation deliberately does **not** claim a completely mutation-free local operation. The other tools read saved evidence. MCP and UI share the same core and can share the same local database.

## Verify the build

```text
npm test
npm run build
npm audit --omit=dev
```

Tests cover receipt parsing, explicit unknowns, incorrect bindings, forbidden RPC mutations, source pins, assertions, archive tampering, redaction, SQLite recovery, HTTP flows, the actual MCP stdio protocol, hosted request boundaries, IndexedDB recovery and browser transport.

## Vercel deployment

`vercel.json` configures the Vite frontend and the stateless `/api/config` and `/api/inspect` Functions. Deploy with Node.js 24; no application secret or database account is required. `.vercelignore` excludes local databases, exports and evidence folders. Do not upload local report history.

The public API accepts at most 64 KiB per request, eight assertions, bounded JSON structure and a 4 MB report. Upstream calls have eight-second deadlines; browser inspection has a 55-second deadline. Each Function instance allows at most three concurrent inspections and six requests per minute per client key. This is **best-effort, per-instance admission control**, not a distributed quota or a complete abuse-prevention system. Add deployment-level controls before higher-volume operation.

Browser storage is limited to 200 reports and approximately 32 MiB. Reaching the limit produces a visible error; old evidence is not silently deleted. Export valuable reports before clearing site data.

See [architecture](docs/architecture.md), [security boundaries](SECURITY.md), [local verification evidence](docs/verification.md), [hosted browser verification](docs/hosted-verification.md) and [submission draft](docs/submission-draft.md).

## Important limits

1. Finalized-state reads are **current**, not historical at the inspected transaction. Later writes can change values. Assertions should include request/case IDs. A passing check does not prove this transaction caused the value.
2. Source matching verifies code currently returned by the RPC, not independently proven transaction-time code.
3. RPC data and self-contained hashes are not independently authenticated chain proofs.
4. A timeout vote does not establish that a long prompt, model provider or node configuration caused the timeout.
5. No stale-frontend diagnosis is made without equivalent, instrumented frontend observations. A failed read is not stale UI.
6. Optional traces may be reconstructed and may consume execution resources. They never override stored receipt outcomes.
7. Studio resets, unavailable RPC methods and schema failures are preserved as limitations, not worked around with guessed outcomes.
8. Automatic credential redaction is best-effort. Review a bundle before sharing. Hosted inspection sends the submitted case to the API; report history and exported bundles are not automatically published.
9. Signed test execution, historical-state proof, frontend instrumentation and network-wide monitoring are **not implemented in v0.1**.

## Related tooling

[genfuzz](https://github.com/SwarupKumarMaity/Genfuzz) mutates mocked response space offline. [Probe.EXE](https://github.com/randyparrs/Probe.EXE) measures live network and per-contract/transaction health and exports observations. Consensus Trace's focus is exact source binding, execution-aware application assertions and a builder's specific review bundle. Do not claim live diagnostics or exports are unique to this project.

GenLayer references: [networks](https://docs.genlayer.com/developers/networks), [transaction querying](https://docs.genlayer.com/developers/decentralized-applications/querying-a-transaction), [receipt API](https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionReceipt), [trace API](https://docs.genlayer.com/api-references/genlayer-node/debug/gen_dbg_traceTransaction).

MIT licensed. Copy, modify and integrate the core, CLI, UI or MCP adapter.
