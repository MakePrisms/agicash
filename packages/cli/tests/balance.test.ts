import { describe, expect, test, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { handleBalanceCommand } from '../src/commands/balance';

function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      currency TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'transactional',
      mint_url TEXT,
      is_test_mint INTEGER DEFAULT 0,
      keyset_counters TEXT DEFAULT '{}',
      network TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE cashu_proofs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      amount INTEGER NOT NULL,
      secret TEXT NOT NULL,
      c TEXT NOT NULL,
      keyset_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'UNSPENT',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function addAccount(
  db: Database,
  opts: { name: string; currency: string; mint_url: string },
): string {
  const row = db
    .prepare(
      `INSERT INTO accounts (name, type, currency, mint_url) VALUES (?, 'cashu', ?, ?) RETURNING id`,
    )
    .get(opts.name, opts.currency, opts.mint_url) as { id: string };
  return row.id;
}

function addProof(
  db: Database,
  accountId: string,
  amount: number,
  state = 'UNSPENT',
): void {
  db.prepare(
    `INSERT INTO cashu_proofs (account_id, amount, secret, c, keyset_id, state)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(accountId, amount, `secret-${Math.random()}`, `c-${Math.random()}`, 'keyset1', state);
}

describe('balance', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  test('returns empty when no accounts', () => {
    const result = handleBalanceCommand(db);
    expect(result.accounts).toEqual([]);
    expect(result.totals).toEqual({});
  });

  test('returns zero balance for account with no proofs', () => {
    addAccount(db, {
      name: 'Test',
      currency: 'BTC',
      mint_url: 'https://mint.example.com',
    });
    const result = handleBalanceCommand(db);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].balance).toBe(0);
    expect(result.accounts[0].proof_count).toBe(0);
  });

  test('sums unspent proof amounts', () => {
    const id = addAccount(db, {
      name: 'Test',
      currency: 'BTC',
      mint_url: 'https://mint.example.com',
    });
    addProof(db, id, 100);
    addProof(db, id, 200);
    addProof(db, id, 50);

    const result = handleBalanceCommand(db);
    expect(result.accounts[0].balance).toBe(350);
    expect(result.accounts[0].proof_count).toBe(3);
  });

  test('excludes spent proofs from balance', () => {
    const id = addAccount(db, {
      name: 'Test',
      currency: 'BTC',
      mint_url: 'https://mint.example.com',
    });
    addProof(db, id, 100);
    addProof(db, id, 200, 'SPENT');
    addProof(db, id, 50, 'PENDING');

    const result = handleBalanceCommand(db);
    expect(result.accounts[0].balance).toBe(100);
    expect(result.accounts[0].proof_count).toBe(1);
  });

  test('computes totals per currency', () => {
    const btc1 = addAccount(db, {
      name: 'BTC 1',
      currency: 'BTC',
      mint_url: 'https://mint1.com',
    });
    const btc2 = addAccount(db, {
      name: 'BTC 2',
      currency: 'BTC',
      mint_url: 'https://mint2.com',
    });
    const usd1 = addAccount(db, {
      name: 'USD 1',
      currency: 'USD',
      mint_url: 'https://usd.mint.com',
    });

    addProof(db, btc1, 100);
    addProof(db, btc2, 200);
    addProof(db, usd1, 5000);

    const result = handleBalanceCommand(db);
    expect(result.totals.BTC).toBe(300);
    expect(result.totals.USD).toBe(5000);
  });

  test('groups accounts by currency then name', () => {
    addAccount(db, { name: 'Zebra', currency: 'BTC', mint_url: 'https://z.com' });
    addAccount(db, { name: 'Alpha', currency: 'BTC', mint_url: 'https://a.com' });
    addAccount(db, { name: 'USD Mint', currency: 'USD', mint_url: 'https://u.com' });

    const result = handleBalanceCommand(db);
    expect(result.accounts[0].name).toBe('Alpha');
    expect(result.accounts[1].name).toBe('Zebra');
    expect(result.accounts[2].name).toBe('USD Mint');
  });
});
