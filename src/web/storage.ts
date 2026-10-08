import { parseCase } from '../core/input.js';
import type { RunRecord, TraceReport } from '../core/types.js';

export type History = Omit<RunRecord, 'report'> & { conclusion?: TraceReport['conclusion']; origin?: TraceReport['origin'] };
interface StoredRow { schemaVersion: 1; run: RunRecord }
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function unpack(row: StoredRow | undefined): RunRecord | undefined {
  if (!row) return undefined;
  if (row.schemaVersion !== 1 || !row.run || !/^[a-f0-9-]{36}$/.test(row.run.id) || !['collecting', 'complete', 'interrupted'].includes(row.run.status) || !Number.isFinite(Date.parse(row.run.createdAt))) throw new Error('A saved report has an unsupported or damaged storage format. Export other reports before clearing site data.');
  parseCase(row.run.input);
  if (row.run.report && (row.run.report.schemaVersion !== 1 || row.run.report.id !== row.run.id)) throw new Error('Saved report identity does not match its history record.');
  return row.run;
}
export class BrowserRunStore {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly name = 'consensus-trace:v1', private readonly factory: IDBFactory = indexedDB, private readonly maxBytes = 33554432) {}
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('runs')) request.result.createObjectStore('runs', { keyPath: 'run.id' }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Browser history storage is unavailable. Enable site storage or use the local CLI.'));
      request.onblocked = () => reject(new Error('Close another old Consensus Trace tab before opening browser history.'));
    });
  }
  async save(run: RunRecord): Promise<void> {
    unpack({ schemaVersion: 1, run }); const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('runs', 'readwrite'); const store = transaction.objectStore('runs');
      let failure = 'Browser history could not be saved. Your previous reports were preserved.';
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          const rows = request.result as StoredRow[]; const existing = rows.find(row => row.run.id === run.id);
          if (existing?.run.status === 'complete' && JSON.stringify(existing.run) !== JSON.stringify(run)) throw new Error('Completed evidence snapshots cannot be overwritten. Refresh creates a new report.');
          const next: StoredRow = { schemaVersion: 1, run };
          if (rows.filter(row => row.run.id !== run.id).reduce((size, row) => size + bytes(row), bytes(next)) > this.maxBytes || rows.length >= 200 && !existing) throw new Error('Browser history is full. Export your reports before clearing site data; existing reports were not deleted.');
          store.put(next);
        } catch (error) { failure = error instanceof Error ? error.message : failure; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(new Error(failure));
    });
  }
  async get(id: string, now = Date.now()): Promise<RunRecord | undefined> {
    const db = await this.open(); const run = await new Promise<RunRecord | undefined>((resolve, reject) => {
      const request = db.transaction('runs', 'readonly').objectStore('runs').get(id);
      request.onsuccess = () => { try { resolve(unpack(request.result as StoredRow | undefined)); } catch (error) { reject(error); } };
      request.onerror = () => reject(new Error('Saved report could not be read.'));
    });
    if (run?.status === 'collecting' && now - Date.parse(run.createdAt) > 75000) {
      const interrupted: RunRecord = { ...run, status: 'interrupted', failure: 'Collection did not finish in this browser. Resume a new read-only snapshot of the same transaction.' };
      await this.save(interrupted); return interrupted;
    }
    return run;
  }
  async list(): Promise<History[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('runs', 'readonly').objectStore('runs').getAll();
      request.onsuccess = () => { try {
        resolve((request.result as StoredRow[]).map(row => unpack(row)!).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map(({ report, ...run }) => ({ ...run, conclusion: report?.conclusion, origin: report?.origin })));
      } catch (error) { reject(error); } };
      request.onerror = () => reject(new Error('Browser history could not be read.'));
    });
  }
  async close() { if (this.database) (await this.database).close(); this.database = undefined; }
}
