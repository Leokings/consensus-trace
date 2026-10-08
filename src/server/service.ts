import { HttpCollector } from '../adapters/http.js';
import { inspectCase } from '../core/inspect.js';
import { parseCase } from '../core/input.js';
import { FixtureCollector, fixtureCase } from '../fixtures/index.js';
import type { Collector, RunRecord } from '../core/types.js';
import { RunStore } from './store.js';

export class RunService {
  private active = 0;
  constructor(readonly store: RunStore, private readonly collector: Collector = new HttpCollector()) {}
  async inspect(input: unknown, options: { fixtureId?: string; parentId?: string } = {}, onStart?: (run: RunRecord) => void): Promise<RunRecord> {
    if (this.active >= 3) throw new Error('Three inspections are already running. Wait for one to finish.');
    const parsed = options.fixtureId ? fixtureCase(options.fixtureId) : parseCase(input);
    const run = this.store.create(parsed, options.parentId, options.fixtureId);
    this.active++;
    try {
      onStart?.(run);
      const report = await inspectCase(parsed, options.fixtureId ? new FixtureCollector(options.fixtureId) : this.collector, { id: run.id, parentId: options.parentId, origin: options.fixtureId ? 'fixture' : 'live', fixtureId: options.fixtureId });
      this.store.finish(run.id, report);
      return this.store.get(run.id)!;
    } catch (error) { this.store.interrupt(run.id); throw error; }
    finally { this.active--; }
  }
}
