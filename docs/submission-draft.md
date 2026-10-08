# Submission draft — not submitted

## Title

```text
Consensus Trace — Wallet-Authorized Test & Debugging Workbench for GenLayer
```

## Notes / Description

```text
Built Consensus Trace, an MIT-licensed GenLayer debugging workbench and public Vercel site. Builders prepare a source-pinned contract call, review it and approve one transaction in their browser wallet. The app tracks its GenLayer ID and separates finality, execution, validator votes, exact source matching and current finalized-state assertions.

Includes equivalent frontend-capture comparison, browser-private history, safe pause/resume and uncertain-hash recovery, CLI, six stdio MCP tools and hashed evidence ZIPs with an immutable test digest. Server APIs are read-only; no keys or automatic submission retries. Maintainer audit and regression tests cover signing boundaries, receipt binding and false stale-UI diagnoses.

Live reads are verified separately from wallet-signed tests. Demos are synthetic. Reads/captures are not historical causality or independent chain proofs. First new signed end-to-end verification requires human wallet approval.
```

## Evidence entries

1. **GitHub Repository** — https://github.com/Leokings/consensus-trace (public; MIT license).
2. **Website / Demo** — https://consensus-trace-leokings588-5902s-projects.vercel.app/
3. **GitHub File — runner audit and verification** — https://github.com/Leokings/consensus-trace/blob/codex/hosted-release/docs/audit-v0.2-2026-10-08.md
4. **GitHub File — exact execution tooling source** — https://github.com/Leokings/consensus-trace/blob/codex/hosted-release/src/core/execution.ts

Contribution date: **10/08/2026**. Notes: **957/1000 characters** with LF paragraph breaks; verify the portal's counter before submission. Choose the relevant developer-tooling/project category; this is not a deployed Intelligent Contract. No portal submission has been sent.

Do not say the inspected Grounding Verifier or Theater Cue Recovery is a Consensus Trace deployment. Existing transaction links identify read-only test subjects. Do not submit fixtures as live proof. The signed runner is implemented; until a human approves and its new outcome is recorded, do not claim a newly verified signed AI consensus run. Do not claim independent certification, historical-state proof or provider-root-cause diagnosis.
