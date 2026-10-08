import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildBundle } from '../core/bundle.js';
import { RunStore } from '../server/store.js';
import { RunService } from '../server/service.js';

async function main() {
  const [command, argument, ...flags] = process.argv.slice(2);
  if (!['inspect', 'demo', 'get'].includes(command) || !argument) throw new Error('Usage: npm run trace -- inspect case.json [--out directory] | demo fixture-id [--out directory] | get report-id');
  if (flags.length && (flags.length !== 2 || flags[0] !== '--out' || !flags[1])) throw new Error('Only --out directory is supported.');
  const store = new RunStore(resolve(process.env.TRACE_DATA_DIR ?? '.local', 'runs.sqlite'));
  try {
    const service = new RunService(store);
    const run = command === 'get' ? store.get(argument) : await service.inspect(command === 'inspect' ? JSON.parse(await readFile(resolve(argument), 'utf8')) : null, command === 'demo' ? { fixtureId: argument } : {});
    if (!run?.report) throw new Error('A completed report was not found.');
    const bundle = buildBundle(run.report);
    if (flags[1]) {
      const directory = resolve(flags[1]); await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, `${run.id}.zip`), bundle.bytes, { flag: 'wx' });
      await writeFile(resolve(directory, `${run.id}.zip.sha256`), `${bundle.sha256}\n`, { flag: 'wx' });
    }
    console.log(JSON.stringify({ report: run.report, bundleSha256: bundle.sha256 }, null, 2));
  } finally { store.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Command failed.'); process.exitCode = 1; });
