import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getCliEnvSuffix } from './runtime-config';

const DATA_DIR = join(homedir(), '.agicash');
const suffix = getCliEnvSuffix();
const DB_PATH = join(DATA_DIR, `agicash${suffix}.db`);

let _db: Database | undefined;

export function getDb(): Database {
  if (_db) return _db;

  mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.run('PRAGMA journal_mode = WAL');
  _db.run('PRAGMA foreign_keys = ON');
  _db.run('PRAGMA synchronous = NORMAL');
  _db.run('PRAGMA busy_timeout = 5000');
  migrate(_db);
  return _db;
}

/** For testing — use an in-memory database */
export function getTestDb(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA synchronous = NORMAL');
  db.run('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kv_store (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (namespace, key)
    );
  `);
}

export function closeDb(): void {
  _db?.close();
  _db = undefined;
}
