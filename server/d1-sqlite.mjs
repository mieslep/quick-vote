// A small stand-in for Cloudflare D1, built on Node's built-in SQLite (node:sqlite).
// The Worker code only uses prepare().bind().first()/all()/run() and batch(), so it runs unchanged on Node.
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

function statement(db, sql, params = []) {
  return {
    bind: (...values) => statement(db, sql, values),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params), success: true }),
    run: async () => {
      const info = db.prepare(sql).run(...params);
      return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
    },
  };
}

// D1 runs a batch as one transaction. So does this.
export function asD1(db) {
  return {
    prepare: (sql) => statement(db, sql),
    batch: async (statements) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
