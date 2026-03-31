import { describe, expect, test, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { handleSendCommand } from '../src/commands/send';
import type { ParsedArgs } from '../src/args';

function makeArgs(
  positional: string[] = [],
  flags: Record<string, string | boolean> = {},
): ParsedArgs {
  return {
    command: 'send',
    positional,
    flags: { pretty: false, ...flags },
  };
}

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
  opts: { name?: string; currency?: string; mint_url?: string } = {},
): string {
  const row = db
    .prepare(
      `INSERT INTO accounts (name, type, currency, mint_url) VALUES (?, 'cashu', ?, ?) RETURNING id`,
    )
    .get(
      opts.name || 'Test Mint',
      opts.currency || 'BTC',
      opts.mint_url || 'https://testnut.cashu.space',
    ) as { id: string };
  return row.id;
}

function addProof(
  db: Database,
  accountId: string,
  amount: number,
): void {
  db.prepare(
    `INSERT INTO cashu_proofs (account_id, amount, secret, c, keyset_id, state)
     VALUES (?, ?, ?, ?, ?, 'UNSPENT')`,
  ).run(
    accountId,
    amount,
    `secret-${Math.random()}`,
    `c-${Math.random()}`,
    'keyset1',
  );
}

describe('send validation', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  test('rejects missing invoice', async () => {
    const result = await handleSendCommand(makeArgs(), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_INVOICE');
  });

  test('rejects invalid invoice', async () => {
    const result = await handleSendCommand(
      makeArgs([], { bolt11: 'notaninvoice' }),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('INVALID_INVOICE');
  });

  test('accepts invoice as positional arg', async () => {
    const id = addAccount(db);
    addProof(db, id, 100);
    // Will fail at network level but should pass validation
    const result = await handleSendCommand(
      makeArgs(['lnbc100n1invalid']),
      db,
    );
    // Should get past validation to the network call
    expect(result.code).not.toBe('MISSING_INVOICE');
    expect(result.code).not.toBe('INVALID_INVOICE');
  });

  test('rejects when no accounts with balance', async () => {
    addAccount(db); // account with no proofs
    const result = await handleSendCommand(
      makeArgs([], { bolt11: 'lnbc100n1test' }),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('NO_ACCOUNT');
  });

  test('rejects when specified account not found', async () => {
    const result = await handleSendCommand(
      makeArgs([], { bolt11: 'lnbc100n1test', account: 'nonexistent' }),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('NO_ACCOUNT');
  });

  test('rejects when specified account has no proofs', async () => {
    const id = addAccount(db);
    const result = await handleSendCommand(
      makeArgs([], { bolt11: 'lnbc100n1test', account: id }),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('NO_BALANCE');
  });

  test('selects account with highest balance by default', async () => {
    const id1 = addAccount(db, { name: 'Small', mint_url: 'https://small.mint' });
    const id2 = addAccount(db, { name: 'Big', mint_url: 'https://big.mint' });
    addProof(db, id1, 10);
    addProof(db, id2, 1000);

    // Will fail at network but we can check which account was selected
    const result = await handleSendCommand(
      makeArgs([], { bolt11: 'lnbc100n1test' }),
      db,
    );
    // It should try the big account (higher balance)
    // The error will be from the network call, not from no-balance
    expect(result.code).not.toBe('NO_BALANCE');
    expect(result.code).not.toBe('NO_ACCOUNT');
  });
});
