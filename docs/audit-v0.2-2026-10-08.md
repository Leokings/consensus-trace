# v0.2 runner and frontend-comparison maintainer audit

Scope: added wallet execution, preparation/resolution Functions, browser attempt storage, frontend capture comparison, CLI/MCP handoffs and evidence exports. This is a maintainer review, not independent certification. The v0.1 audit and release artifacts remain historical records.

## Findings addressed

| Boundary | Risk identified | Implemented fix and regression coverage |
|---|---|---|
| Submission | SDK alternate-ABI fallback could issue another wallet submission | SDK serializers/static ABI plus one direct EIP-1193 send; no fallback or retry |
| Cross-tab execution | Two tabs could both approve an unsent attempt | Atomic persisted claim before the wallet boundary; concurrent-claim tests |
| Review freshness | Changed account, chain or source could invalidate the reviewed call | Exact account/chain checks and fresh source preflight; changes block signing |
| Uncertain send | Transport errors or missing hashes could encourage duplicate writes | Explicit UNCERTAIN recovery; saved outer hash surfaced even if persistence fails |
| Receipt recovery | A supplied hash alone could refer to a different call | Bradbury outer-call/event binding; StudioNet exact sender/recipient/calldata binding |
| Saved identity | Substituted calldata, zero hashes or resetting to unsent could undermine recovery | Runtime validation, immutable metadata/hashes/gas, terminal states and no unsent rollback |
| Agent handoff | New draft could inherit an unrelated old saved attempt | Handoff draft does not restore an old attempt; selecting history synchronizes reviewed draft |
| Frontend diagnosis | Any mismatch or failed read could be mislabeled stale | Equivalent bounded reads, freshness checks and explicit divergence/unavailable states |
| Report import | Claimed frontend results could be forged independently of evidence | Recomputed comparison and complete case binding, old report compatibility tests |
| Resource/UI recovery | Multibyte attempt quota counted characters; damaged rows lacked warning | UTF-8 byte budget, preserved damaged-row notices, pausable read-only tracking |
| Browser/server parity | Source preflight used Node-only Buffer; absent optional fields changed after JSON transport | Portable bounded base64 decoder, omitted undefined fields and no-Buffer/wire-round-trip tests |

## Verification and release gates

- All **226 tests** pass across ten test files. Coverage includes original inspection boundaries, wallet encoding/submission/recovery, frontend comparisons, hosted same-origin protection and actual MCP stdio tools.
- `npm run build` passes and the full `npm audit` reports **zero known vulnerabilities**. These checks are not a security certification.
- TypeScript/Vite production build and npm audit are release gates. Wallet functionality is lazy-loaded.
- Public source preflight, existing network receipt inspection and production browser checks are recorded separately from a new signed test.
- No maintainer automated wallet confirmation, new secret collection or server signer was used. A first newly signed end-to-end test remains pending until the human approves the actual transaction; do not substitute historical receipts or synthetic tests for it.

## Remaining limitations / review blockers

The APIs use ordinary HTTPS RPC observations, not independent chain proofs. Method annotation recognition is not a Python AST/security audit. Gas units do not cap monetary fees. Source/time-state reads are current, not historical proofs. Supplied frontend captures are not authenticated. A zero-value call can affect consequential contract state, and separately prepared duplicate calls remain possible.

Per-instance admission limits are implemented, not a distributed quota. A scoped platform firewall read returned no active custom configuration; no new deployment-level WAF policy is claimed. Platform WAF rollout requires staging/review and publication by its owner. Provider timeout root causes remain unknown without provider logs. Site publication is not portal submission.
