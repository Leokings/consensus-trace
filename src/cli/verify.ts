import { readFile } from 'node:fs/promises';
import { verifyBundle } from '../core/bundle.js';

async function main() {
  const [path, flag, anchor, ...extra] = process.argv.slice(2);
  if (!path || extra.length || (flag && (flag !== '--sha256' || !anchor || !/^[a-fA-F0-9]{64}$/.test(anchor)))) throw new Error('Usage: npm run verify:bundle -- evidence.zip [--sha256 trusted-digest]');
  const result = verifyBundle(await readFile(path), anchor);
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Verification failed.'); process.exitCode = 1; });
