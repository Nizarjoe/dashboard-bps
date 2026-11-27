// Adaptor D1 minimal di atas node:sqlite, hanya untuk uji lokal (data sintetis, in-memory).
import { DatabaseSync } from 'node:sqlite';

export function createD1(schemaSql) {
  const db = new DatabaseSync(':memory:');
  if (schemaSql) db.exec(schemaSql);
  const stats = { queries: 0 };
  const norm = v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);
  function stmt(sql, args) {
    const runSync = () => {
      stats.queries++;
      const r = db.prepare(sql).run(...args.map(norm));
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    };
    return {
      bind: (...a) => stmt(sql, a),
      async first() { stats.queries++; const r = db.prepare(sql).get(...args.map(norm)); return r ? { ...r } : null; },
      async all() { stats.queries++; return { success: true, results: db.prepare(sql).all(...args.map(norm)).map(r => ({ ...r })) }; },
      async run() { return runSync(); },
      _runSync: runSync,
    };
  }
  return {
    prepare: sql => stmt(sql, []),
    async batch(list) {
      db.exec('BEGIN');
      try {
        const out = list.map(s => s._runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    stats,
    raw: db,
  };
}
