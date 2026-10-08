import type { TraceReport } from './types.js';

const sensitiveKey = /^(?:authorization|cookie|set-cookie|password|passwd|secret|private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|bearer|headers|node_config)$/i;
export function redact<T>(value: T): { value: T; replacements: number } {
  let replacements = 0;
  function walk(item: unknown): unknown {
    if (typeof item === 'string') return item
      .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g, () => { replacements++; return '[REDACTED_TOKEN]'; })
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, () => { replacements++; return 'Bearer [REDACTED]'; });
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => {
      if (sensitiveKey.test(key)) { if (entry !== '[REDACTED_FIELD]') replacements++; return [key, '[REDACTED_FIELD]']; }
      return [key, walk(entry)];
    }));
    return item;
  }
  return { value: walk(value) as T, replacements };
}
export function redactReport(report: TraceReport): TraceReport {
  const scrubbed = redact(report);
  const replacements = (report.redaction?.replacements ?? 0) + scrubbed.replacements;
  return { ...scrubbed.value, redaction: { applied: replacements > 0, replacements, note: 'Best-effort credential-field and token-pattern redaction. Review before sharing. Original source digests were calculated before redaction; manifest hashes cover the exported, redacted bytes.' } };
}
