import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

// Pattern-based pre-publication check, not a complete secret scanner.
// Print filenames and rule names only, never suspected credential values.
const rules = [
  ['private-key-material', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['provider-token', /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
];
const problems = [];
let textFiles = 0; let archives = 0; let historicalBlobs = 0;
function scan(bytes, path) {
  if (/\.zip$/i.test(path)) {
    if (bytes.length > 8388608) throw new Error(`Oversized archive: ${path}`);
    let size = 0; let entries = 0; const seen = new Set();
    const files = unzipSync(bytes, { filter: file => {
      size += file.originalSize;
      if (++entries > 64 || size > 8388608 || seen.has(file.name)) throw new Error(`Unsafe archive: ${path}`);
      seen.add(file.name); return true;
    } });
    archives++;
    for (const [name, content] of Object.entries(files)) scanText(content, `${path}:${name}`);
  } else if (!/\.(?:jpg|jpeg|png|gif|webp)$/i.test(path)) scanText(bytes, path);
}
function scanText(bytes, path) {
  textFiles++;
  const value = new TextDecoder().decode(bytes);
  for (const [rule, pattern] of rules) if (pattern.test(value)) problems.push({ path, rule });
}
const paths = execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter(Boolean);
for (const path of paths) {
  if (/^(?:\.local|\.vercel|node_modules|exports)\/|(?:^|\/)\.env(?:\.|$)|\.(?:sqlite|db)(?:[.-]|$)/i.test(path)) problems.push({ path, rule: 'private-or-generated-file' });
  scan(readFileSync(path), path);
}
const objects = execFileSync('git', ['rev-list', '--objects', '--all']).toString().trim().split('\n').map(line => { const space = line.indexOf(' '); return { id: line.slice(0, space < 0 ? line.length : space), path: space < 0 ? '' : line.slice(space + 1) }; });
const batch = execFileSync('git', ['cat-file', '--batch'], { input: objects.map(item => item.id).join('\n') + '\n', maxBuffer: 33554432 });
let offset = 0;
for (const object of objects) {
  const end = batch.indexOf(10, offset); const [, type, length] = batch.subarray(offset, end).toString().split(' ');
  const size = Number(length); if (!Number.isSafeInteger(size)) throw new Error('Could not scan Git history.');
  const bytes = batch.subarray(end + 1, end + 1 + size); offset = end + 2 + size;
  if (type === 'blob') { historicalBlobs++; scan(bytes, `history/${object.path}`); }
}
console.log(JSON.stringify({ trackedFiles: paths.length, historicalBlobs, scannedTextFiles: textFiles, archives, problems }, null, 2));
if (problems.length) process.exitCode = 1;
