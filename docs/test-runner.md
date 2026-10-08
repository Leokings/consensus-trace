# Authorized test runner and recovery

Version 0.2 implements the original prepare, approve, run, diagnose and export workflow. No contract is deployed by this tool. The server, CLI and MCP cannot sign. You approve a state-changing call through your own browser wallet.

## Use it

1. Open **Run a test** on the website. Paste a draft with network, address, exact public source commit/path, public-write method, JSON arguments, optional assertions and a gas-unit limit.
2. **Prepare & verify source** performs official chain-ID and deployed-code reads and compares exact bytes with the pinned public GitHub file. Missing source, a different chain or an unrecognized public-write annotation blocks submission.
3. **Connect & switch wallet** requests a public account and selects the fixed official network. No key is read or stored.
4. Review the exact call, source hash, test digest, account and gas limit. Check the authorization box, then request one transaction. You must approve its actual fees in your wallet.
5. The app saves the returned outer hash, verifies its exact call binding, resolves the GenLayer ID and tracks read-only receipt evidence. Stored finality and execution are separate. A finalized contract error is not a successful test.
6. Export the test/report ZIP. Keep the displayed ZIP SHA-256 separately. It includes `test-execution.json`, observations, source comparison, assertions and the report. Integrity hashes are not independent chain proofs.

Arguments are limited to public, non-sensitive JSON and the draft to 8 KiB. Only StudioNet and Bradbury are supported for signing; transferred user value is fixed at zero. The limit of 21,000–2,000,000 gas units is **not a monetary fee cap**. A zero-value call can still change important state. Annotation recognition does not establish correct argument types or safe contract logic.

## Safe recovery

The attempt is atomically marked before the wallet boundary, preventing duplicate prompts for that attempt across tabs. Each attempt can issue only one submission request. The SDK's alternate-ABI retry is deliberately not used. Separately preparing duplicate drafts creates separate attempts; applications should still implement their own request idempotency.

After reload, select the saved attempt and resume the same hash. Reload does not request a wallet or send a transaction. A wallet rejection is terminal. If a wallet timeout/error has no reliable hash, inspect wallet activity and attach the hash of the already-sent call. An outer EVM receipt revert is reported separately. Missing/ambiguous events do not justify resending.

Bradbury resolution checks outer hash, sender, configured consensus destination and exact encoded calldata, then accepts one nonzero GenLayer ID from its consensus emitter. StudioNet checks its direct ID, sender, recipient and full call data. Missing evidence pauses binding. Neither path claims RPC-independent authentication.

Read-only tracking pauses after 15 minutes and can be resumed manually. API limits, observation deadlines and missing reads are not protocol timeout verdicts. Copy hashes if browser storage fails. Saved attempts have a separate 100-record/16 MiB UTF-8 budget; damaged records remain preserved and visible as a warning. Do not clear site data until evidence/hashes are exported.

## CLI and MCP

`npm run trace -- prepare examples/authorized-grounding-test.json` returns preflight evidence and a browser-review URL. MCP `prepare_test` does the same. The URL fragment contains public test arguments and never auto-submits. `resolve_submission` and CLI `resolve` accept draft, sender, outerHash, data and gas copied from a saved attempt and perform reads only. Agent handoffs do not inherit an unrelated old attempt.

Use request-bound view assertions when possible. A positive count is only a sanity check on current state; it cannot prove that the test caused that value. After finality, inspect the contract's returned request ID/digest and its record to validate application-specific results.

## Verification status

Automated tests exercise single submission, cross-tab claims, rejection, uncertain outcomes, source/account changes, encoded-call substitution and receipt recovery. Live source preflight and hosted inspection do not prove a newly signed transaction worked. The release evidence distinguishes verified reads from the first wallet-signed end-to-end run, which requires human approval.
