# Security boundaries

Consensus Trace v0.1 has two deployment modes: a loopback-only local workbench and a public, read-only Vercel website for public contract evidence. The website has a stateless inspection API and browser-private report history; it has no shared saved-report endpoint, signing wallet or blockchain-write capability. These boundaries have automated tests, but this is not an independent security audit or a guarantee of production multi-tenant security.

## Implemented safeguards

- The local server listens on `127.0.0.1`; strict Host and same-origin checks reject rebinding-style hostnames and cross-origin requests. The hosted API rejects cross-origin browser submissions and uses same-origin frontend requests over HTTPS. Its public read-only endpoint is not an authenticated service.
- Only fixed official network endpoints; a fixed localnet endpoint is available locally but forbidden on the website. No user-supplied RPC URL.
- RPC allowlist excludes sends, deploys, writes, appeals, cancels and finalize operations.
- Source retrieval is limited to validated owner/repository, full commit SHA and relative file paths at `raw.githubusercontent.com`, with redirects disabled.
- RPC and source requests have bounded response bodies, validated JSON-RPC response IDs and no automatic retries. Deadlines are 15 seconds locally and eight seconds on the website.
- At most three concurrent inspections; up to eight view assertions; bounded arguments and input bodies.
- Chain, transaction ID and recipient binding precede code/schema and application-state checks. Assertions require recorded finality and successful execution.
- Contradictory status/execution name-number metadata is treated as unknown and an error finding.
- Optional trace retrieval is local-only, opt-in and cannot override stored receipt outcomes. The hosted endpoint rejects trace requests.
- Report text is rendered as React text, never executable HTML. Expression evaluation, shell execution, arbitrary local file access and uploaded archive extraction are not exposed in the API.
- SQL parameters bind identifiers and values. Finished snapshots are not overwritten by a refresh. Transaction IDs survive interruption.
- A second live process does not automatically interrupt another process's active inspection. Dead owners and graceful shutdowns leave resumable interrupted records. PID reuse can leave an old record collecting; manual refresh remains available.
- Bundle verification checks safe filenames, file-list integrity, hashes, count/size limits and an optional external ZIP digest. Verification never extracts files onto the filesystem.
- Credential-like fields and recognized bearer/provider token patterns are redacted before reports are stored and exported. Redaction is idempotent and best-effort, not a guarantee.
- Hosted request bodies are capped at 64 KiB, 24 nesting levels and 4,096 JSON nodes; report responses are capped at 4 MB. Unknown envelope fields and credential fields are rejected. Hosted logs record report identifiers, outcome and timing, not case contents.
- Hosted admission control allows three concurrent inspections and six requests per minute per client key, **per Function instance**. It is not a distributed quota, trusted user identity or complete denial-of-service defense. No custom deployment-level WAF policy has been verified for this release.
- Browser-private IndexedDB records have schema checks, immutable completed snapshots and limits of 200 reports/approximately 32 MiB. A record collecting for over 75 seconds is shown as interrupted. Refresh is manual; old reports are never automatically pruned.
- Vercel previews and unique production deployment URLs remain protected; only the production site alias is public. Source browsing is disabled. Local databases, environment files and generated exports are excluded from upload.

## Not guaranteed

RPC authenticity beyond ordinary HTTPS; independent chain proof; historical state/code provenance; causal attribution of a current value to a particular transaction; correct smart-contract logic; secrecy of public-chain data; perfect detection of leaked credentials; accurate root-cause inference without logs; correctness of external source content; production multi-tenant security.

`gen_call` is read-only at the chain level, but a contract view can still perform computation or external requests. The tool does not promise that every read is resource-free. A debug trace may replay execution and consume additional resources.

Hosted case inputs necessarily pass through Vercel and the relevant fixed RPC/public-source services. Saved browser history and exported bundles are not automatically published or uploaded. Do not enter secrets or private material. Treat source files, logs, assertions and report descriptions as untrusted data. Review the bundle before submission.

Report a vulnerability privately to the repository maintainer. Do not include live credentials in a report or public issue.
