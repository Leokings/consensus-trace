# Submission draft — not submitted

## Title

```text
Consensus Trace — Source-Bound Live Test Verification for GenLayer
```

## Notes / Description

```text
Built an MIT-licensed, local-first debugging workbench for GenLayer Intelligent Contracts. Builders enter an existing GenLayer transaction ID, contract address, pinned public source commit and view assertions. Consensus Trace separates stored finality, execution outcome, validator votes, source matching and current finalized application state.

Includes a React UI, SQLite report history, CLI, stdio MCP tools and SHA-256 evidence ZIPs. Diagnostics preserve unknowns: client request timeouts are not protocol timeouts, unavailable reads are not stale frontends, and replay traces do not override receipts.

Read-only checks against existing Bradbury and StudioNet transactions are recorded separately from synthetic examples. No keys or new transactions are required. This version verifies current latest-final state, not historical causality. Signed test execution and frontend instrumentation are future work.
```

## Evidence entries to prepare after publication

1. **GitHub Repository** — the standalone Consensus Trace repository. Publication URL not assigned yet.
2. **Website / Demo** — a public hosted deployment only after hosted auth/security work and authorization. The current loopback URL is not public reviewer evidence.
3. **GitHub File** — `docs/verification.md` plus reviewed live observation bundles under `docs/evidence/`.
4. **GitHub File** — `src/core/inspect.ts` or the reproducible test suite, pinned to the actual release commit.

Use the actual contribution date. Choose the portal's relevant developer-tooling/project category; do not present this as a deployed Intelligent Contract.

Do not say the inspected Grounding Verifier or Theater Cue Recovery is a Consensus Trace deployment. Their existing transaction links identify the subjects of read-only checks. Do not submit fixture bundles as live proof. Do not claim a security audit, fresh AI consensus run, historical-state proof, automatic root-cause diagnosis or working signed test runner.
