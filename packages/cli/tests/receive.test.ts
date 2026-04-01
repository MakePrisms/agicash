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
