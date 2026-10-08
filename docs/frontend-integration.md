# Frontend-state comparison

Provide a small, public snapshot of the value your application displays and, when available, the value its own finalized read returned. Consensus Trace independently performs an equivalent view read and compares selected values, not the whole response.

```ts
import { captureFrontend } from './src/core/frontend.js';

const snapshot = captureFrontend({
  label: 'Stored verdict for verification 1',
  network: 'bradbury',
  contractAddress: '0xb08773A551302B816F6bF3cce914D266b5C1a461',
  method: 'get_verification', args: [1], pointer: '/verdict', parseJson: false,
  displayedValue: displayedVerdict,
  readValue: lastRead.verdict,
});
```

Do not copy sample variables as a claim that an actual UI was observed. Instrument your real app or enter an accurately captured public snapshot. The helper sets `stateVariant: "latest-final"` and an ISO timestamp. Paste an array of snapshots in **Inspect existing → Frontend snapshots**, or include `frontend` in a CLI/MCP inspection case. The assertion must have the same label and identical read identity, pointer and parsing mode.

- `MATCH`: captured display equals the independent current read.
- `DISPLAY_STALE`: supplied instrumented frontend read equals the independent read while the captured display differs. This supports a display/cache-update fault **in the supplied capture**, not proof of a third-party UI's authenticity.
- `DIVERGENCE`: display differs without an agreeing frontend read; a later write or different read may explain it.
- `NOT_COMPARABLE`: read identities differ, capture is over five minutes old, or it is more than five seconds ahead of the independent read.
- `UNAVAILABLE`: no equivalent successful read was obtained. Missing RPC data is not stale UI.

Values preserve JSON types. False, zero and null are legitimate values; an absent value is different. Only eight recent, bounded snapshots are accepted. Keep secrets and private UI content out of captures. This is opt-in instrumentation, not automatic scraping of arbitrary websites.

The report has a Frontend tab and includes comparison findings and `frontend/*.json` evidence in the ZIP. Runtime validation recomputes comparison results before accepting a report. Current finalized reads are not historical transaction-state or causality proofs, and submitted timestamps/values are not independently authenticated.
