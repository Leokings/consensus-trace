# Submission draft — not submitted

## Title

```text
Consensus Trace — Source-Bound Live Test Verification for GenLayer
```

## Notes / Description

```text
Built an MIT-licensed debugging workbench and public Vercel website for GenLayer Intelligent Contracts. Builders enter an existing transaction ID, contract address, pinned public source commit and view assertions. Consensus Trace separates finality, execution outcome, validator votes, source matching and current finalized application state.

Includes browser-private history, a local SQLite edition, CLI, stdio MCP tools, bounded read-only APIs and SHA-256 evidence ZIPs. All 130 tests pass. The hosted UI inspected real Bradbury and StudioNet receipts; reload, refresh and downloaded ZIP verification were checked.

Bradbury source and result checks passed. StudioNet's missing schema/source/assertion evidence remained explicit. Synthetic demos are not live proof. No keys or new transactions are required. Reads verify current latest-final state, not historical causality; signed execution and frontend instrumentation remain future work.
```

## Evidence entries

1. **GitHub Repository** — standalone source is committed locally; a remote repository URL has not been assigned. Publish only to the approved visibility before filling this entry.
2. **Website / Demo** — https://consensus-trace-leokings588-5902s-projects.vercel.app/
3. **Verification evidence** — `docs/hosted-verification.md`, `docs/hosted-deployment-2026-10-08.json` and reviewed live bundles under `docs/evidence/`. Add their actual repository links after publication.
4. **Contract-independent tooling source** — `src/core/inspect.ts` or `tests/hosted.test.ts`, pinned to the actual release commit after publication.

Use the actual contribution date. Choose the portal's relevant developer-tooling/project category; do not present this as a deployed Intelligent Contract.

Do not say the inspected Grounding Verifier or Theater Cue Recovery is a Consensus Trace deployment. Their existing transaction links identify the subjects of read-only checks. Do not submit fixture bundles as live proof. Do not claim a security audit, fresh AI consensus run, historical-state proof, automatic root-cause diagnosis or working signed test runner.
