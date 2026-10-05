import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Job } from './model.js';
export async function atomicJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}
export class Store {
  db: DatabaseSync;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, 'state.sqlite');
    this.db = new DatabaseSync(path, { timeout: 5000 });
    chmodSync(path, 0o600);
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS lock (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL);',
    );
  }
  save(job: Job) {
    job.updatedAt = new Date().toISOString();
    this.db
      .prepare('INSERT INTO jobs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(job.id, JSON.stringify(job));
  }
  get(id: string): Job | undefined {
    const row = this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id) as
      | { data: string }
      | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  list(): Job[] {
    return (
      this.db.prepare('SELECT data FROM jobs ORDER BY rowid DESC').all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  lock(pid: number) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT pid FROM lock').get() as { pid: number } | undefined;
      if (row) {
        let alive = true;
        try {
          process.kill(row.pid, 0);
        } catch (e) {
          alive = (e as NodeJS.ErrnoException).code !== 'ESRCH';
        }
        if (alive) throw new Error('Another worker is active');
        this.db.exec('DELETE FROM lock');
      }
      this.db.prepare('INSERT INTO lock VALUES (1,?)').run(pid);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  unlock(pid: number) {
    this.db.prepare('DELETE FROM lock WHERE pid=?').run(pid);
  }
  close() {
    this.db.close();
  }
}
