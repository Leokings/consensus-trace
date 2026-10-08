# Submission draft — not submitted

## Title

```text
Consensus Trace — Source-Bound Live Test Verification for GenLayer
```

## Notes / Description

```text
Built an MIT-licensed debugging workbench and public Vercel site for GenLayer Intelligent Contracts. Builders enter an existing transaction ID, contract address, pinned public source commit and view assertions. Consensus Trace separates finality, execution, validator votes, source matching and current finalized state.

Includes browser-private history, local SQLite, CLI, stdio MCP tools, bounded read-only APIs and hashed evidence ZIPs. All 154 tests pass. Maintainer audit fixes cover conflicting receipts, full report binding, credential rejection, damaged-history recovery and duplicate ZIP paths.

The hosted UI inspected existing Bradbury and StudioNet receipts. Bradbury source/result checks passed; unavailable StudioNet evidence stayed explicit. Demos are synthetic, not live proof. No keys or new transactions are needed. Reads check current latest-final state, not historical causality. Signed execution and frontend instrumentation are not yet implemented.
```

## Evidence entries

1. **GitHub Repository** — https://github.com/Leokings/consensus-trace (public; MIT license).
2. **Website / Demo** — https://consensus-trace-leokings588-5902s-projects.vercel.app/
3. **Verification evidence** — `docs/hosted-verification.md`, `docs/hosted-deployment-2026-10-08.json` and reviewed live bundles under `docs/evidence/`. Add their actual repository links after publication.
4. **Contract-independent tooling source** — `src/core/inspect.ts` or `tests/hosted.test.ts`, pinned to the actual release commit after publication.

Use the actual contribution date. Choose the portal's relevant developer-tooling/project category; do not present this as a deployed Intelligent Contract.

Do not say the inspected Grounding Verifier or Theater Cue Recovery is a Consensus Trace deployment. Their existing transaction links identify the subjects of read-only checks. Do not submit fixture bundles as live proof. The maintainer audit is documented, but do not claim an independent security audit, fresh AI consensus run, historical-state proof, automatic root-cause diagnosis or working signed test runner.
