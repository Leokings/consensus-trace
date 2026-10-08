import { sha256 } from './json.js';
import type { SourceRef, TraceReport } from './types.js';

export function githubRawUrl(ref: SourceRef): string {
  return `https://raw.githubusercontent.com/${ref.repository}/${ref.commit}/${ref.path.split('/').map(encodeURIComponent).join('/')}`;
}
export function githubFileUrl(ref: SourceRef): string {
  return `https://github.com/${ref.repository}/blob/${ref.commit}/${ref.path.split('/').map(encodeURIComponent).join('/')}`;
}
export function decodeSource(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw.length > 524288 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) throw new Error('The RPC did not return bounded base64-encoded contract source.');
  const bytes = Buffer.from(raw, 'base64');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!text.trim()) throw new Error('Contract source is empty.');
  return text;
}
export function compareSource(deployed: string, pinned: string): TraceReport['source'] {
  const deployedSha256 = sha256(deployed);
  const pinnedSha256 = sha256(pinned);
  const deployedLfSha256 = sha256(deployed.replace(/\r\n/g, '\n'));
  const pinnedLfSha256 = sha256(pinned.replace(/\r\n/g, '\n'));
  return { comparison: deployedSha256 === pinnedSha256 ? 'EXACT' : deployedLfSha256 === pinnedLfSha256 ? 'LINE_ENDINGS_ONLY' : 'MISMATCH', deployedSha256, pinnedSha256, deployedLfSha256, pinnedLfSha256 };
}
