import { describe, expect, test, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { handleReceiveCommand } from '../src/commands/receive';
import { getTestDb } from '../src/db';
import type { ParsedArgs } from '../src/args';

function makeArgs(flags: Record<string, string | boolean> = {}): ParsedArgs {
  return {
    command: 'receive',
    positional: [],
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

  test('rejects missing --amount', async () => {
    addAccount(db);
    const result = await handleReceiveCommand(makeArgs(), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_AMOUNT');
  });

  test('rejects invalid amount', async () => {
    addAccount(db);
    const result = await handleReceiveCommand(
      makeArgs({ amount: 'abc' }),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('INVALID_AMOUNT');
  });

  test('rejects zero amount', async () => {
    addAccount(db);
    const result = await handleReceiveCommand(
      makeArgs({ amount: '0' }),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('INVALID_AMOUNT');
  });

  test('rejects negative amount', async () => {
    addAccount(db);
    const result = await handleReceiveCommand(
      makeArgs({ amount: '-10' }),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('INVALID_AMOUNT');
  });

  test('rejects when no accounts configured', async () => {
    const result = await handleReceiveCommand(
      makeArgs({ amount: '100' }),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('NO_ACCOUNT');
  });

  test('rejects when specified account not found', async () => {
    addAccount(db);
    const result = await handleReceiveCommand(
      makeArgs({ amount: '100', account: 'nonexistent' }),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('NO_ACCOUNT');
  });
});

describe('receive E2E (requires network)', () => {
  let db: Database;

  beforeEach(() => {
    db = getTestDb();
  });

  test('creates mint quote from real testnut', async () => {
    addAccount(db, { mint_url: 'https://testnut.cashu.space' });
    const result = await handleReceiveCommand(
      makeArgs({ amount: '1' }),
      db,
    );

    expect(result.action).toBe('invoice');
    expect(result.quote).toBeDefined();
    expect(result.quote!.bolt11).toMatch(/^ln/);
    expect(result.quote!.amount).toBe(1);
    expect(result.quote!.currency).toBe('BTC');
    expect(result.quote!.mint_url).toBe('https://testnut.cashu.space');
  });
});
