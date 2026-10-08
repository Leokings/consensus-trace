import { strToU8, unzipSync, zipSync } from 'fflate';
import { canonicalJson, sha256 } from './json.js';
import { redactReport } from './redact.js';
import type { TraceReport } from './types.js';

export interface Manifest {
  schemaVersion: 1;
  tool: 'consensus-trace';
  toolVersion: '0.1.0';
  reportId: string;
  origin: 'live' | 'fixture';
  createdAt: string;
  files: { path: string; bytes: number; sha256: string }[];
  notice: string;
}
const MAX_ARCHIVE = 8388608;
function safePath(path: string): boolean { return /^[A-Za-z0-9_./-]+$/.test(path) && !path.startsWith('/') && path.split('/').every(part => part !== '..' && part !== '.' && part !== ''); }

export function markdownReport(report: TraceReport): string {
  const safe = (text: string) => text.replace(/[\r\n\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/[<>&]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char]!).replace(/[\\`*_{}\[\]()#+!|]/g, '\\$&');
  const lines = [
    '# Consensus Trace', '', report.origin === 'fixture' ? '**SYNTHETIC FIXTURE — NOT LIVE SUBMISSION EVIDENCE**' : '**LIVE RPC OBSERVATION — READ-ONLY**', '',
    `Case: ${safe(report.input.name)}`, `Report: ${report.id}`, `Captured: ${report.createdAt}`, `Conclusion: ${report.conclusion}`, '',
    `Network: ${report.network.id}; configured chain ID ${report.network.chainId}; chain verified: ${report.network.chainVerified}`, '',
    `Contract: ${report.links.contract}`, `Transaction: ${report.links.transaction}`, ...(report.links.source ? [`Pinned source: ${report.links.source}`] : []), '',
    '## Verified layers', '',
    `- Receipt binding: transaction=${report.identity.transactionMatches}; recipient=${report.identity.recipientMatches}`,
    `- Stored lifecycle: ${report.receipt.storedStatus}; finalized=${report.receipt.finalized}`,
    `- Execution: ${report.receipt.execution} (${report.receipt.executionBasis})`,
    `- Source comparison: ${report.source.comparison}`,
    `- Assertions: ${report.assertions.filter(item => item.status === 'PASS').length}/${report.assertions.length} passed against current latest-final state`, '',
    '## Findings', '',
  ];
  for (const finding of report.findings) lines.push(`### ${finding.severity.toUpperCase()}: ${safe(finding.title)}`, '', `Code: ${finding.code}; classification: ${finding.certainty}`, '', safe(finding.detail), '', `Evidence: ${finding.evidencePaths.join(', ')}`, `Next check: ${safe(finding.nextCheck)}`, '');
  lines.push('## Assertion results', '');
  for (const assertion of report.assertions) lines.push(`- ${safe(assertion.spec.label)}: ${assertion.status} — ${safe(assertion.reason)}`);
  lines.push('', '## Limitations', '', ...report.limitations.map(item => `- ${safe(item)}`), '', '## Integrity and redaction', '', report.redaction?.note ?? 'Review public-chain observations before sharing.', '', 'Verify file hashes against manifest.json. A self-contained manifest is not a signature or proof of authenticity. Preserve the ZIP SHA-256 separately if you need a trusted integrity anchor.', '');
  return lines.join('\n');
}

export class EvidenceBundleLimitError extends Error {}
function bundleFiles(original: TraceReport): { files: Record<string, Uint8Array>; manifest: Manifest } {
  const report = redactReport(original);
  const files: Record<string, Uint8Array> = {};
  const addJson = (path: string, value: unknown) => { files[path] = strToU8(`${canonicalJson(value)}\n`); };
  addJson('report.json', report);
  addJson('input.json', report.input);
  files['report.md'] = strToU8(markdownReport(report));
  for (const [key, evidence] of Object.entries(report.observations)) addJson(`observations/${key}.json`, evidence);
  report.assertions.forEach((assertion, i) => addJson(`assertions/${i}.json`, assertion));
  if (report.observations.deployedCode.kind === 'ok') files['source/deployed.py'] = strToU8(report.observations.deployedCode.value);
  if (report.observations.pinnedSource.kind === 'ok') files['source/pinned.py'] = strToU8(report.observations.pinnedSource.value);
  const manifest: Manifest = { schemaVersion: 1, tool: 'consensus-trace', toolVersion: '0.1.0', reportId: report.id, origin: report.origin, createdAt: report.createdAt,
    files: Object.entries(files).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) })),
    notice: 'Hashes verify the exported bytes only. They do not authenticate the author or prove chain truth. Source hashes in report.json describe original captured text before any redaction.',
  };
  addJson('manifest.json', manifest);
  const totalBytes = Object.values(files).reduce((sum, value) => sum + value.length, 0);
  if (totalBytes > MAX_ARCHIVE) throw new EvidenceBundleLimitError('Evidence bundle exceeds the 8 MiB uncompressed limit.');
  return { files, manifest };
}
export function assertBundleFits(report: TraceReport): void { bundleFiles(report); }
export function buildBundle(original: TraceReport): { bytes: Uint8Array; sha256: string; manifest: Manifest } {
  const { files, manifest } = bundleFiles(original);
  const bytes = zipSync(files, { level: 6, mtime: new Date(2000, 0, 1) });
  return { bytes, sha256: sha256(bytes), manifest };
}

export function verifyBundle(bytes: Uint8Array, expectedZipSha256?: string): { valid: boolean; filesChecked: number; errors: string[]; anchored: boolean; sha256: string } {
  const errors: string[] = []; const digest = sha256(bytes); let checked = 0;
  if (expectedZipSha256 && digest !== expectedZipSha256.toLowerCase()) errors.push('ZIP hash differs from the supplied external integrity anchor.');
  if (bytes.length > MAX_ARCHIVE) errors.push('Compressed ZIP is too large.');
  try {
    if (errors.length) throw new Error('Archive rejected before decompression.');
    let size = 0; let entries = 0; const paths = new Set<string>();
    const files = unzipSync(bytes, { filter: file => {
      entries++; size += file.originalSize;
      if (!safePath(file.name) || entries > 64 || size > MAX_ARCHIVE) throw new Error('Unsafe archive path, too many entries, or excessive uncompressed size.');
      if (paths.has(file.name)) throw new Error('Duplicate physical archive path.');
      paths.add(file.name);
      return true;
    } });
    if (!files['manifest.json']) throw new Error('manifest.json is missing.');
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['manifest.json'])) as Manifest;
    if (manifest.tool !== 'consensus-trace' || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 63) throw new Error('Manifest schema is unsupported.');
    const listed = new Set<string>();
    for (const file of manifest.files) {
      if (!safePath(file.path) || file.path === 'manifest.json' || listed.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error('Manifest contains an invalid or duplicate file entry.');
      listed.add(file.path); const content = files[file.path];
      if (!content) errors.push(`Missing file: ${file.path}`);
      else { checked++; if (content.length !== file.bytes || sha256(content) !== file.sha256) errors.push(`Integrity mismatch: ${file.path}`); }
    }
    for (const path of Object.keys(files)) if (path !== 'manifest.json' && !listed.has(path)) errors.push(`Unlisted file: ${path}`);
    if (!listed.has('report.json') || !listed.has('input.json') || !listed.has('report.md')) errors.push('Required report files are missing from the manifest.');
  } catch (error) { errors.push(error instanceof Error ? error.message : 'Unable to verify ZIP.'); }
  return { valid: errors.length === 0, filesChecked: checked, errors, anchored: Boolean(expectedZipSha256), sha256: digest };
}
