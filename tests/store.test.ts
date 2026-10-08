import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { RunStore } from '../src/server/store.js';
import { RunService } from '../src/server/service.js';
import { fixtureCase, FixtureCollector } from '../src/fixtures/index.js';

function cleanup(directory: string) {
  const target = resolve(directory);
  const allowed = `${resolve(tmpdir())}${sep}consensus-trace-test-`;
  if (!target.startsWith(allowed)) throw new Error('Refusing to delete outside the explicitly created test directory.');
  rmSync(target, { recursive: true, force: true });
}

describe('durable, non-resubmitting run records', () => {
  it('persists the transaction ID before the collector runs', async () => {
    const store = new RunStore(':memory:'); const service = new RunService(store); let startId = '';
    const run = await service.inspect(null, { fixtureId: 'successful' }, started => { startId = started.id; expect(store.get(started.id)?.input.transactionHash).toBe(fixtureCase('successful').transactionHash); expect(store.get(started.id)?.status).toBe('collecting'); });
    expect(run.id).toBe(startId); expect(run.status).toBe('complete'); store.close();
  });
  it('keeps fixture identity through saved runs and refreshes', async () => {
    const store = new RunStore(':memory:'); const service = new RunService(store);
    const original = await service.inspect(null, { fixtureId: 'execution-error' }); const refresh = await service.inspect(original.input, { parentId: original.id, fixtureId: original.fixtureId });
    expect(refresh.fixtureId).toBe('execution-error'); expect(refresh.report?.origin).toBe('fixture'); expect(refresh.parentId).toBe(original.id); expect(store.get(original.id)?.report?.id).toBe(original.id); store.close();
  });
  it('recovers a gracefully interrupted fixture without turning it into a live run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'consensus-trace-test-')); const path = join(directory, 'runs.sqlite');
    try { const first = new RunStore(path); const run = first.create(fixtureCase('successful'), undefined, 'successful'); first.close(); const second = new RunStore(path); expect(second.get(run.id)?.status).toBe('interrupted'); expect(second.get(run.id)?.fixtureId).toBe('successful'); second.close(); }
    finally { cleanup(directory); }
  });
  it('does not interrupt another live store/process when opened', () => {
    const directory = mkdtempSync(join(tmpdir(), 'consensus-trace-test-')); const path = join(directory, 'runs.sqlite');
    try { const first = new RunStore(path); const run = first.create(fixtureCase('successful')); const second = new RunStore(path); expect(second.get(run.id)?.status).toBe('collecting'); second.close(); expect(first.get(run.id)?.status).toBe('collecting'); first.close(); }
    finally { cleanup(directory); }
  });
  it('returns bounded history and uses parameterized identifiers', async () => {
    const store = new RunStore(':memory:'); expect(store.get("' OR 1=1 --")).toBeNull(); const service = new RunService(store, new FixtureCollector('successful')); await service.inspect(fixtureCase('successful')); expect(store.list().length).toBe(1); store.close();
  });
});
