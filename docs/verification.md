# v0.1 verification evidence

Verified locally on **2026-10-08**, with Node.js 24.19.0 and npm 11.17.0. This is a first-party build verification, **not an independent security audit**.

## Automated checks

| Check | Result |
| --- | --- |
| `npm test` | 106 tests passed across 6 files |
| `npm run build` | TypeScript checking and production Vite build passed |
| `npm audit --omit=dev` | 0 reported production-dependency vulnerabilities |
| Real MCP stdio integration | Tool discovery, synthetic inspection, saved-report retrieval and manifest retrieval passed |
| Local HTTP integration | Inspection, refresh, history, ZIP download and loopback-origin restrictions passed |
| Published SDK calldata | GenLayer JS 1.1.8 read encoding/decoding exercised by the Bradbury check below |

The test suite covers incorrect chain/transaction/recipient binding, unavailable evidence, conflicting receipt fields, finalized execution errors, timeout/disagreement votes, exact versus normalized source matches, typed assertions, archive tampering, redaction, interrupted SQLite runs and synthetic/live provenance. Synthetic fixtures are **not live consensus proof**.

## Read-only live checks

These checks inspect **existing transactions**. No contract was deployed, no new AI transaction was submitted, and no wallet or private key was used. Observation timestamps are not the original transaction dates. Optional execution traces were not requested.

### Bradbury — all requested checks passed

- Report: `fa2ad0ee-09e5-4714-8ed5-e30be7f09d4a`
- Report assembled: `2026-10-08T19:43:17.233Z`
- Chain ID: `4221`, verified against the configured endpoint.
- Subject: [Agent Output Grounding Verifier](https://explorer-bradbury.genlayer.com/address/0xb08773A551302B816F6bF3cce914D266b5C1a461).
- Existing [GenLayer transaction](https://explorer-bradbury.genlayer.com/tx/0x7e72eb0d3673b4e7fde739437c21931009751dc9b3129b3921285b5ad8ed00ba): receipt identity and recipient both matched.
- Stored status: `FINALIZED`; execution: `SUCCESS`; observed votes: 5 `AGREE`, 0 timeouts or disagreements.
- Current deployed code exactly matched [this pinned public source](https://github.com/Leokings/agent-output-grounding-verifier/blob/b95bc1f8a7c41a2c880b7da8fbeef2247cd1a99f/contracts/AgentOutputGroundingVerifier.py).
- Both original source SHA-256 digests: `9edcde9acd1f9206a9bd4ef4b9f491a4d39ece605597c109f3172ba7916c2d33`.
- Current `latest-final` assertion: `get_verification(1)` → `/verdict` exactly equals `"SUPPORTED"`: `PASS`.
- Conclusion: `CHECKS_PASSED` for these requested layers, **not** a security certification or transaction-causality proof.
- Optional lifecycle projection returned JSON-RPC `-32601` (unsupported method). That missing projection was preserved; stored receipt finality remained separately available.

[Evidence ZIP](evidence/fa2ad0ee-09e5-4714-8ed5-e30be7f09d4a.zip) · [ZIP SHA-256](evidence/fa2ad0ee-09e5-4714-8ed5-e30be7f09d4a.zip.sha256)

```text
460db3fbfa2b967014f251f25d1d9ce6640406806cac5299304bd58835dfc1f0
```

Bundle verification passed with the separately supplied digest: 13 manifest-listed files checked, no errors.

### StudioNet — intentionally incomplete evidence

- Report: `ee42298e-9500-42bf-94f9-b0be6f7773e8`
- Report assembled: `2026-10-08T19:43:39.376Z`
- Chain ID: `61999`, verified against the configured endpoint.
- Subject: [Theater Cue Recovery](https://explorer-studio.genlayer.com/address/0x62122cb6486bc664084dec8c93ec6a61f1c51016).
- Existing [deployment transaction](https://explorer-studio.genlayer.com/tx/0x786d6828903e6b37e82d94e7b7ea94575369d8d34d7008b837157581658f5059): receipt identity and recipient both matched.
- Stored status: `FINALIZED`; leader execution: `SUCCESS`; observed votes: 3 `AGREE`, 2 `NOT_VOTED` (idle).
- A cancelled **validator** entry appeared inside `leader_receipt` with `CONSENSUS_VALIDATOR_QUORUM_REACHED`. The parser did not mistake it for a failed leader or count idle as agreement.
- No public source pin or application assertions were supplied. This is not a full functional verification of Theater Cue Recovery.
- Schema retrieval returned JSON-RPC `-32001`, `Contract ... not found`. The cause is unproven; the workbench does not label this stale frontend state or erase the successful stored receipt.
- Optional lifecycle projection was unsupported (`-32601`).
- Conclusion: `INCOMPLETE`; findings: `SOURCE_UNVERIFIED`, `SCHEMA_UNAVAILABLE`, `NO_ASSERTIONS`.
- Best-effort redaction removed 12 recognized configuration fields. Review the entire bundle before any publication, including its contract source and public-chain payloads.

[Evidence ZIP](evidence/ee42298e-9500-42bf-94f9-b0be6f7773e8.zip) · [ZIP SHA-256](evidence/ee42298e-9500-42bf-94f9-b0be6f7773e8.zip.sha256)

```text
ef89eb68b2536fe41ff4d3877a2338206f2ccf2d15f2017cafe7206a86d8fe9f
```

Bundle verification passed with the separately supplied digest: 10 manifest-listed files checked, no errors.

## Reproduce and verify

```text
npm ci
npm test
npm run build
npm audit --omit=dev
npm run trace -- inspect examples/bradbury-existing.json --out exports/recheck-bradbury
npm run trace -- inspect examples/studionet-existing.json --out exports/recheck-studio
npm run verify:bundle -- docs/evidence/fa2ad0ee-09e5-4714-8ed5-e30be7f09d4a.zip --sha256 460db3fbfa2b967014f251f25d1d9ce6640406806cac5299304bd58835dfc1f0
npm run verify:bundle -- docs/evidence/ee42298e-9500-42bf-94f9-b0be6f7773e8.zip --sha256 ef89eb68b2536fe41ff4d3877a2338206f2ccf2d15f2017cafe7206a86d8fe9f
```

New inspections receive different IDs and observation timestamps, so their ZIP hashes will differ. Re-exporting the **same saved report** produces the same ZIP bytes. A self-contained manifest is not a signature; trust in the external digest and RPC remains a separate issue.

## Delivery boundaries

The local production UI was browser-checked with both saved live reports and the clearly labelled finalized-execution-error demo. Assertion values, source results and incomplete findings remain separate panels. A browser-downloaded Bradbury ZIP passed the bundle verifier with the same SHA-256 digest as the CLI export. The app runs on loopback only.

This folder has not been published, submitted to the portal or deployed as an Intelligent Contract. Localnet live testing, signed test execution, historical-state proof and instrumented frontend-staleness detection remain outside v0.1. See [security boundaries](../SECURITY.md) and [the submission draft](submission-draft.md).
