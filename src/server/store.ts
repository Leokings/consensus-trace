import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../core/json.js';
import { redactReport } from '../core/redact.js';
import type { RunRecord, TraceCase, TraceReport } from '../core/types.js';

export class RunStore {
  private readonly db: DatabaseSync;
  private readonly owned = new Set<string>();
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, parent_id TEXT, created_at TEXT NOT NULL, status TEXT NOT NULL, input TEXT NOT NULL, report TEXT, fixture_id TEXT, owner_pid INTEGER)');
    const columns = this.db.prepare('PRAGMA table_info(runs)').all().map(row => row.name);
    if (!columns.includes('fixture_id')) this.db.exec('ALTER TABLE runs ADD COLUMN fixture_id TEXT');
    if (!columns.includes('owner_pid')) this.db.exec('ALTER TABLE runs ADD COLUMN owner_pid INTEGER');
    for (const row of this.db.prepare("SELECT id, owner_pid FROM runs WHERE status='collecting'").all()) {
      let alive = false;
      if (typeof row.owner_pid === 'number' && row.owner_pid > 0) {
        try { process.kill(row.owner_pid, 0); alive = true; } catch { /* Dead process: preserve the case for an explicit refresh. */ }
      }
      if (!alive) this.interrupt(String(row.id));
    }
  }
  create(input: TraceCase, parentId?: string, fixtureId?: string): RunRecord {
    const run: RunRecord = { id: randomUUID(), parentId, fixtureId, createdAt: new Date().toISOString(), status: 'collecting', input };
    this.db.prepare('INSERT INTO runs (id, parent_id, created_at, status, input, report, fixture_id, owner_pid) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(run.id, parentId ?? null, run.createdAt, run.status, canonicalJson(input), fixtureId ?? null, process.pid);
    this.owned.add(run.id);
    return run;
  }
  finish(id: string, report: TraceReport): TraceReport {
    const safe = redactReport(report);
    this.db.prepare("UPDATE runs SET status='complete', report=? WHERE id=? AND status='collecting'").run(canonicalJson(safe), id);
    this.owned.delete(id);
    return safe;
  }
  interrupt(id: string): void { this.db.prepare("UPDATE runs SET status='interrupted' WHERE id=? AND status='collecting'").run(id); this.owned.delete(id); }
  get(id: string): RunRecord | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id);
    return row ? this.decode(row) : null;
  }
  list(): RunRecord[] { return this.db.prepare('SELECT * FROM runs ORDER BY created_at DESC, rowid DESC LIMIT 50').all().map(row => this.decode(row)); }
  private decode(row: Record<string, unknown>): RunRecord {
    return { id: String(row.id), createdAt: String(row.created_at), status: row.status as RunRecord['status'], input: JSON.parse(String(row.input)) as TraceCase,
      ...(row.parent_id ? { parentId: String(row.parent_id) } : {}), ...(row.fixture_id ? { fixtureId: String(row.fixture_id) } : {}), ...(row.report ? { report: JSON.parse(String(row.report)) as TraceReport } : {}),
    };
  }
  close(): void { for (const id of this.owned) this.interrupt(id); this.db.close(); }
}
