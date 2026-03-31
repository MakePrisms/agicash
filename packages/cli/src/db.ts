import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DATA_DIR = join(homedir(), '.agicash');
const DB_PATH = join(DATA_DIR, 'agicash.db');

let _db: Database | undefined;

export function getDb(): Database {
  if (_db) return _db;

  mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA foreign_keys = ON');
  migrate(_db);
  return _db;
}

/** For testing — use an in-memory database */
export function getTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('cashu', 'spark')),
      currency TEXT NOT NULL CHECK (currency IN ('BTC', 'USD')),
      purpose TEXT NOT NULL DEFAULT 'transactional' CHECK (purpose IN ('transactional', 'gift-card')),
      mint_url TEXT,
      is_test_mint INTEGER DEFAULT 0,
      keyset_counters TEXT DEFAULT '{}',
      network TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashu_proofs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      amount INTEGER NOT NULL,
      secret TEXT NOT NULL,
      c TEXT NOT NULL,
      keyset_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'UNSPENT' CHECK (state IN ('UNSPENT', 'PENDING', 'SPENT')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function closeDb(): void {
  _db?.close();
  _db = undefined;
}
