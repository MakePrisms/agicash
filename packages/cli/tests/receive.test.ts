import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import type { ParsedArgs } from '../src/args';
import { handleReceiveCommand } from '../src/commands/receive';
import { getTestDb } from '../src/db';

function makeArgs(
  positional: string[] = [],
  flags: Record<string, string | boolean> = {},
): ParsedArgs {
  return {
    command: 'receive',
    positional,
    flags: { pretty: false, ...flags },
  };
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

describe('receive validation', () => {
  let db: Database;

  beforeEach(() => {
    db = getTestDb();
  });

  test('rejects missing input', async () => {
    addAccount(db);
    const result = await handleReceiveCommand(makeArgs(), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_INPUT');
  });

  test('rejects invalid input', async () => {
    addAccount(db);
    const result = await handleReceiveCommand(makeArgs(['abc']), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('INVALID_AMOUNT');
  });

  test('rejects zero amount', async () => {
    addAccount(db);
    const result = await handleReceiveCommand(makeArgs(['0']), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('INVALID_AMOUNT');
  });

  test('rejects when no accounts configured', async () => {
    const result = await handleReceiveCommand(makeArgs(['100']), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('NO_ACCOUNT');
  });

  test('rejects when specified account not found', async () => {
    addAccount(db);
    const result = await handleReceiveCommand(
      makeArgs(['100'], { account: 'nonexistent' }),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('NO_ACCOUNT');
  });

  test('detects cashu token input', async () => {
    // Will fail to decode but should enter token path
    const result = await handleReceiveCommand(
      makeArgs(['cashuAinvalidtoken']),
      db,
    );
    // Should try token path, not amount path
    expect(result.code).not.toBe('INVALID_AMOUNT');
  });
});

describe('receive list', () => {
  let db: Database;

  beforeEach(() => {
    db = getTestDb();
  });

  test('returns empty array on fresh DB', async () => {
    const result = await handleReceiveCommand(makeArgs(['list']), db);
    expect(result.action).toBe('list');
    expect(result.quotes).toEqual([]);
  });

  test('returns stored quotes', async () => {
    const accountId = addAccount(db);
    db.prepare(
      'INSERT INTO mint_quotes (id, bolt11, amount, account_id, mint_url, currency, state) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'q1',
      'lnbc1...',
      100,
      accountId,
      'https://testnut.cashu.space',
      'BTC',
      'UNPAID',
    );

    const result = await handleReceiveCommand(makeArgs(['list']), db);
    expect(result.action).toBe('list');
    expect(result.quotes).toHaveLength(1);
    expect(result.quotes?.[0].id).toBe('q1');
    expect(result.quotes?.[0].amount).toBe(100);
    expect(result.quotes?.[0].state).toBe('UNPAID');
  });
});

describe('receive --check-all', () => {
  let db: Database;

  beforeEach(() => {
    db = getTestDb();
  });

  test('returns zero summary when no pending quotes', async () => {
    const result = await handleReceiveCommand(
      makeArgs([], { 'check-all': true }),
      db,
    );
    expect(result.action).toBe('checked');
    expect(result.checked).toEqual({
      total: 0,
      minted: 0,
      pending: 0,
      expired: 0,
    });
  });

  test('marks expired quotes based on expiry timestamp', async () => {
    const accountId = addAccount(db);
    const pastExpiry = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    db.prepare(
      'INSERT INTO mint_quotes (id, bolt11, amount, account_id, mint_url, currency, state, expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'q-expired',
      'lnbc1...',
      50,
      accountId,
      'https://testnut.cashu.space',
      'BTC',
      'UNPAID',
      pastExpiry,
    );

    const result = await handleReceiveCommand(
      makeArgs([], { 'check-all': true }),
      db,
    );
    expect(result.action).toBe('checked');
    expect(result.checked?.expired).toBe(1);
    expect(result.checked?.total).toBe(1);

    // Verify DB was updated
    const row = db
      .query("SELECT state FROM mint_quotes WHERE id = 'q-expired'")
      .get() as { state: string };
    expect(row.state).toBe('EXPIRED');
  });
});

describe('receive Lightning E2E (requires network)', () => {
  let db: Database;

  beforeEach(() => {
    db = getTestDb();
  });

  test('creates mint quote for amount', async () => {
    addAccount(db, { mint_url: 'https://testnut.cashu.space' });
    const result = await handleReceiveCommand(makeArgs(['1']), db);

    expect(result.action).toBe('invoice');
    expect(result.quote).toBeDefined();
    expect(result.quote?.bolt11).toMatch(/^ln/);
    expect(result.quote?.amount).toBe(1);
  });

  test('accepts amount via --amount flag (backwards compat)', async () => {
    addAccount(db, { mint_url: 'https://testnut.cashu.space' });
    const result = await handleReceiveCommand(
      makeArgs([], { amount: '1' }),
      db,
    );

    expect(result.action).toBe('invoice');
    expect(result.quote?.bolt11).toMatch(/^ln/);
  });
});
