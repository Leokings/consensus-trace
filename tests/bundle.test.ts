import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { buildBundle, verifyBundle } from '../src/core/bundle.js';
import { redactReport } from '../src/core/redact.js';
import { inspectCase } from '../src/core/inspect.js';
import { fixtureCase, FixtureCollector } from '../src/fixtures/index.js';

async function report() { return inspectCase(fixtureCase('successful'), new FixtureCollector('successful'), { origin: 'fixture', fixtureId: 'successful' }); }
describe('review-ready evidence bundle', () => {
  it('exports a valid hashed bundle with an explicit fixture label', async () => {
    const bundle = buildBundle(await report()); const files = unzipSync(bundle.bytes);
    expect(verifyBundle(bundle.bytes, bundle.sha256)).toMatchObject({ valid: true, anchored: true });
    expect(new TextDecoder().decode(files['report.md'])).toContain('SYNTHETIC FIXTURE'); expect(bundle.manifest.origin).toBe('fixture');
  });
  it('is byte-stable for the same report', async () => { const input = await report(); expect(buildBundle(input).sha256).toBe(buildBundle(input).sha256); });
  it('catches modified report bytes', async () => { const bundle = buildBundle(await report()); const files = unzipSync(bundle.bytes); files['report.json'] = strToU8('{}'); expect(verifyBundle(zipSync(files)).valid).toBe(false); });
  it('catches an unlisted file', async () => { const bundle = buildBundle(await report()); const files = unzipSync(bundle.bytes); files['unexpected.txt'] = strToU8('unexpected'); expect(verifyBundle(zipSync(files)).errors).toContain('Unlisted file: unexpected.txt'); });
  it('catches a missing manifest-listed file', async () => { const bundle = buildBundle(await report()); const files = unzipSync(bundle.bytes); delete files['report.md']; expect(verifyBundle(zipSync(files)).valid).toBe(false); });
  it('catches an external ZIP-hash mismatch before decompression', async () => { const bundle = buildBundle(await report()); expect(verifyBundle(bundle.bytes, '0'.repeat(64)).valid).toBe(false); });
  it('rejects traversal archive entries', () => { expect(verifyBundle(zipSync({ '../escape.txt': strToU8('x') })).valid).toBe(false); });
  it('rejects absent and malformed manifests', () => { expect(verifyBundle(zipSync({ 'report.json': strToU8('{}') })).valid).toBe(false); expect(verifyBundle(zipSync({ 'manifest.json': strToU8('{') })).valid).toBe(false); });
  it('redacts credential fields before export', async () => {
    const input = await report(); input.observations.receipt = { kind: 'ok', method: 'x', durationMs: 0, capturedAt: '', value: { node_config: { api_key: 'very-secret' }, api_key: 'also-secret', stdout: 'Bearer abcdefghijk12345' } };
    const redacted = redactReport(input); expect(redacted.redaction?.applied).toBe(true);
    const text = new TextDecoder().decode(unzipSync(buildBundle(input).bytes)['report.json']);
    expect(text).not.toContain('very-secret'); expect(text).not.toContain('also-secret'); expect(text).not.toContain('abcdefghijk12345');
  });
  it('does not present self-contained hashes as an authenticity signature', async () => { const bundle = buildBundle(await report()); expect(verifyBundle(bundle.bytes).anchored).toBe(false); expect(bundle.manifest.notice).toContain('do not authenticate'); });
  it('keeps redaction idempotent for saved reports', async () => { const input = await report(); input.observations.receipt = { kind: 'ok', method: 'x', capturedAt: '', durationMs: 0, value: { api_key: 'private' } }; expect(redactReport(redactReport(input))).toEqual(redactReport(input)); });
});
