# Consensus Trace v0.2 release verification

The original wallet-authorized test workflow is implemented and deployed. This release adds exact source preflight, one reviewed wallet submission per persisted attempt, read-only hash recovery/tracking, equivalent frontend comparison, expanded evidence ZIPs, and CLI/MCP human-wallet handoffs.

The first new signed end-to-end test is **pending human authorization**. The live page has verified the source and connected a wallet, but the human must authorize the exact call and review its wallet-displayed fees. Do not report a fresh AI consensus run until its actual new transaction/outcome is recorded.

## Release identity

- Public site: [Consensus Trace](https://consensus-trace-leokings588-5902s-projects.vercel.app/).
- Deployed application commit: [`2217e7e2e94f76af47a9276b25523dbfde881cb8`](https://github.com/Leokings/consensus-trace/commit/2217e7e2e94f76af47a9276b25523dbfde881cb8).
- Production deployment: `dpl_EyDpE5eBhCrU5U3rUmqYHromXiYC`, independently confirmed READY in the intended project and region. The CLI lost its polling connection after upload; this did not fail the deployment.
- [GitHub CI](https://github.com/Leokings/consensus-trace/actions/runs/37854119720) passed. Local tests: **226/226**, production build passed, full npm audit: **0 known vulnerabilities**.
- [Machine-readable record](release-v0.2-2026-10-08.json), [maintainer audit](audit-v0.2-2026-10-08.md), [runner instructions](test-runner.md), [frontend integration](frontend-integration.md).

## Observed live checks

Production `/api/config` returns v0.2 with wallet tests enabled and server APIs read-only. Both local and hosted browser source preparation returned READY with the exact deployed source hash. Signing remained disabled until wallet connection and the authorization checkbox; no automatic send occurred on page load or handoff navigation.

The hosted API inspected an existing finalized Bradbury transaction and obtained exact source matching and a passing current-state verdict assertion. Read-only outer-hash recovery independently resolved a real historical Bradbury submission to its expected GenLayer ID. A separate frontend comparison test used deliberately supplied integration values and a real equivalent finalized read; its expected DISPLAY_STALE classification is **not evidence of an actual third-party frontend defect**.

The new read-only CLI ZIP was independently verified using its externally supplied SHA-256:

- [Live observation ZIP](evidence/v0.2-live/39836a19-9578-4075-bb23-e2d995e89e9d.zip)
- SHA-256: `609bccbaef7230e474085d5feb5d2166e15742fa497528142ad6b519ceec5601`
- Verifier: valid, anchored, 13 files checked, no errors.

This ZIP inspects an existing transaction. It is not a fresh signed test. [Production call-review screenshot](evidence/v0.2-wallet-review-2026-10-08.jpg) shows source readiness before submission. A connected-account screenshot stays local and is excluded from publication.

No runtime errors were reported in the project's queried one-hour window. That does not guarantee complete telemetry or error-free operation. Per-instance quota limits, unauthenticated public captures, current-state provenance and missing provider logs remain explicit limitations. No platform firewall publication or portal submission was performed.
