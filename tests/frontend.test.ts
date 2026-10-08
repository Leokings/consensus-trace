import { describe, expect, it } from 'vitest';
import { compareFrontend, captureFrontend } from '../src/core/frontend.js';
import { parseCase } from '../src/core/input.js';
import { inspectCase } from '../src/core/inspect.js';
import { FixtureCollector, fixtureCase } from '../src/fixtures/index.js';
import { parseReport } from '../src/core/report.js';
import { buildBundle, verifyBundle } from '../src/core/bundle.js';
import { evaluateAssertion } from '../src/core/assertions.js';
import type { FrontendSnapshot, TraceCase } from '../src/core/types.js';

const input = (): TraceCase => parseCase(fixtureCase('successful'));
function capture(extra: Partial<FrontendSnapshot> = {}): FrontendSnapshot { const test = input(); const spec = test.assertions[0]; return { ...captureFrontend({ label: spec.label, network: test.network, contractAddress: test.contractAddress, method: spec.method, args: spec.args, pointer: spec.pointer, parseJson: spec.parseJson, displayedValue: 'SUPPORTED' }), ...extra }; }
const result = () => { const spec = input().assertions[0]; return evaluateAssertion({ ...spec, pointer: '', parseJson: false }, { kind: 'ok', method: 'gen_call', capturedAt: new Date().toISOString(), durationMs: 1, value: 'SUPPORTED' }); };
function compare(extra: Partial<FrontendSnapshot> = {}) { const assertion = result(); const snapshot = capture({ pointer: '', parseJson: false, ...extra }); return compareFrontend({ ...input(), assertions: [assertion.spec], frontend: [snapshot] }, [assertion])[0]; }
describe('equivalent instrumented frontend comparisons', () => {
  it('matches exact display types and values', () => { expect(compare().status).toBe('MATCH'); });
  it('identifies a supplied display-update fault only with an agreeing instrumented read', () => { expect(compare({ displayedValue: 'PENDING', readValue: 'SUPPORTED' }).status).toBe('DISPLAY_STALE'); });
  it('a display mismatch alone is divergence, not stale-UI proof', () => { expect(compare({ displayedValue: 'PENDING' }).status).toBe('DIVERGENCE'); expect(compare({ displayedValue: 'PENDING', readValue: 'PENDING' }).status).toBe('DIVERGENCE'); });
  it.each([{ network: 'studionet' as const }, { contractAddress: `0x${'9'.repeat(40)}` }, { method: 'other' }, { args: ['different'] }, { pointer: '/other' }, { parseJson: true }, { label: 'other' }])('refuses mismatched read identity: %j', extra => { expect(compare(extra).status).toBe('NOT_COMPARABLE'); });
  it('rejects old and future captures', () => { expect(compare({ capturedAt: new Date(Date.now() - 360000).toISOString() }).status).toBe('NOT_COMPARABLE'); expect(compare({ capturedAt: new Date(Date.now() + 10000).toISOString() }).status).toBe('NOT_COMPARABLE'); });
  it('missing backend data is unavailable, never a stale UI', () => { const assertion = result(); const failed = { ...assertion, evidence: { kind: 'error' as const, method: 'gen_call', capturedAt: new Date().toISOString(), durationMs: 1, error: { category: 'unsupported', message: 'No read' } }, actual: undefined }; expect(compareFrontend({ ...input(), frontend: [capture({ pointer: '', parseJson: false })] }, [failed])[0].status).toBe('UNAVAILABLE'); });
  it('keeps selected-value zero, false and null comparisons meaningful', () => { const assertion = result(); for (const value of [0, false, null]) { const modified = { ...assertion, actual: value }; expect(compareFrontend({ ...input(), frontend: [capture({ pointer: '', parseJson: false, displayedValue: value })] }, [modified])[0].status).toBe('MATCH'); } });
  it('rejects credential-like captures and duplicate labels', () => { expect(() => parseCase({ ...input(), frontend: [capture({ displayedValue: { api_key: 'synthetic' } })] })).toThrow(); expect(() => parseCase({ ...input(), frontend: [capture(), capture()] })).toThrow('unique'); });
  it('binds computed frontend findings into reports and exported evidence', async () => { const test = input(); const collector = new FixtureCollector('successful'); const plain = await inspectCase(test, collector, { origin: 'fixture' }); const actual = plain.assertions[0].actual!; const snapshot = capture({ displayedValue: 'not-current', readValue: actual }); const report = await inspectCase({ ...test, frontend: [snapshot] }, new FixtureCollector('successful'), { origin: 'fixture' }); expect(report.frontend?.[0].status).toBe('DISPLAY_STALE'); expect(report.findings.map(item => item.code)).toContain('FRONTEND_DISPLAY_STALE'); expect(report.conclusion).toBe('ISSUES_FOUND'); expect(parseReport(report).frontend).toEqual(report.frontend); const bundle = buildBundle(report); expect(bundle.manifest.files.map(item => item.path)).toContain('frontend/0.json'); expect(verifyBundle(bundle.bytes, bundle.sha256).valid).toBe(true); });
  it('rejects a forged comparison independently of JSON shape', async () => { const report = await inspectCase({ ...input(), frontend: [capture()] }, new FixtureCollector('successful'), { origin: 'fixture' }); report.frontend![0].status = 'DISPLAY_STALE'; expect(() => parseReport(report)).toThrow('not bound'); });
  it('v0.1-shaped records remain readable', async () => { const report = await inspectCase(input(), new FixtureCollector('successful'), { origin: 'fixture' }); report.toolVersion = '0.1.0'; expect(parseReport(report).toolVersion).toBe('0.1.0'); });
});
