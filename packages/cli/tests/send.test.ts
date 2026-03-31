import { describe, expect, test, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { handleSendCommand } from '../src/commands/send';
import { getTestDb } from '../src/db';
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

function addProof(db: Database, accountId: string, amount: number): void {
  db.prepare(
    `INSERT INTO cashu_proofs (account_id, amount, secret, c, keyset_id, state)
     VALUES (?, ?, ?, ?, ?, 'UNSPENT')`,
  ).run(accountId, amount, `secret-${Math.random()}`, `c-${Math.random()}`, 'keyset1');
}

describe('send (ecash token) validation', () => {
  let db: Database;

  beforeEach(() => {
    db = getTestDb();
  });

  test('rejects missing amount', async () => {
    const result = await handleSendCommand(makeArgs(), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_AMOUNT');
  });

  test('rejects invalid amount', async () => {
    const result = await handleSendCommand(makeArgs(['abc']), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('INVALID_AMOUNT');
  });

  test('rejects zero amount', async () => {
    const result = await handleSendCommand(makeArgs(['0']), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('INVALID_AMOUNT');
  });

  test('rejects when no account with sufficient balance', async () => {
    const id = addAccount(db);
    addProof(db, id, 10);
    const result = await handleSendCommand(makeArgs(['1000']), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('NO_ACCOUNT');
  });

  test('rejects when specified account not found', async () => {
    const result = await handleSendCommand(
      makeArgs(['100'], { account: 'nonexistent' }),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('NO_ACCOUNT');
  });

  test('detects insufficient balance with explicit account', async () => {
    const id = addAccount(db);
    addProof(db, id, 10);
    const result = await handleSendCommand(
      makeArgs(['1000'], { account: id }),
      db,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('INSUFFICIENT_BALANCE');
  });

  test('accepts amount via --amount flag', async () => {
    const result = await handleSendCommand(
      makeArgs([], { amount: '100' }),
      db,
    );
    expect(result.action).toBe('error');
    // Should get past amount parsing
    expect(result.code).not.toBe('MISSING_AMOUNT');
    expect(result.code).not.toBe('INVALID_AMOUNT');
  });
});
