import { describe, expect, test, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { handleMintCommand } from '../src/commands/mint';
import type { ParsedArgs } from '../src/args';

function makeArgs(
  positional: string[],
  flags: Record<string, string | boolean> = {},
): ParsedArgs {
  return {
    command: 'mint',
    positional,
    flags: { pretty: false, ...flags },
  };
}

function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
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
  return db;
}

describe('mint add', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  test('adds a mint with default BTC currency', async () => {
    const result = await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com']),
      db,
    );
    expect(result.action).toBe('added');
    expect(result.account).toBeDefined();
    expect(result.account!.mint_url).toBe('https://mint.example.com');
    expect(result.account!.currency).toBe('BTC');
    expect(result.account!.type).toBe('cashu');
    expect(result.account!.name).toBe('BTC Mint');
  });

  test('adds a mint with USD currency', async () => {
    const result = await handleMintCommand(
      makeArgs(['add', 'https://usd.mint.com'], { currency: 'USD' }),
      db,
    );
    expect(result.action).toBe('added');
    expect(result.account!.currency).toBe('USD');
    expect(result.account!.name).toBe('USD Mint');
  });

  test('adds a mint with custom name', async () => {
    const result = await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com'], { name: 'My Mint' }),
      db,
    );
    expect(result.account!.name).toBe('My Mint');
  });

  test('strips trailing slashes from URL', async () => {
    const result = await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com///']),
      db,
    );
    expect(result.account!.mint_url).toBe('https://mint.example.com');
  });

  test('rejects invalid URL', async () => {
    const result = await handleMintCommand(
      makeArgs(['add', 'not-a-url']),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('INVALID_URL');
  });

  test('rejects missing URL', async () => {
    const result = await handleMintCommand(makeArgs(['add']), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_URL');
  });

  test('rejects duplicate mint', async () => {
    await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com']),
      db,
    );
    const result = await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com']),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('DUPLICATE_MINT');
  });

  test('rejects invalid currency', async () => {
    const result = await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com'], { currency: 'EUR' }),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('INVALID_CURRENCY');
  });
});

describe('mint list', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  test('returns empty list when no mints', async () => {
    const result = await handleMintCommand(makeArgs(['list']), db);
    expect(result.action).toBe('list');
    expect(result.accounts).toEqual([]);
  });

  test('lists added mints', async () => {
    await handleMintCommand(
      makeArgs(['add', 'https://mint1.example.com']),
      db,
    );
    await handleMintCommand(
      makeArgs(['add', 'https://mint2.example.com'], { currency: 'USD' }),
      db,
    );

    const result = await handleMintCommand(makeArgs(['list']), db);
    expect(result.action).toBe('list');
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts![0].mint_url).toBe('https://mint1.example.com');
    expect(result.accounts![1].mint_url).toBe('https://mint2.example.com');
  });
});

describe('mint unknown subcommand', () => {
  test('returns error for unknown subcommand', async () => {
    const db = freshDb();
    const result = await handleMintCommand(makeArgs(['delete']), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('UNKNOWN_SUBCOMMAND');
  });

  test('returns error when no subcommand', async () => {
    const db = freshDb();
    const result = await handleMintCommand(makeArgs([]), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('UNKNOWN_SUBCOMMAND');
  });
});
