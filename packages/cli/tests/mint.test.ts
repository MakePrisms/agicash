import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ParsedArgs } from '../src/args';
import { handleMintCommand } from '../src/commands/mint';
import { getTestDb } from '../src/db';

// Mock @cashu/cashu-ts so mint validation doesn't make network calls.
// Default: mint supports sat (BTC) with an active keyset.
let mockKeysets = [{ unit: 'sat', active: true, id: 'mock-keyset' }];

mock.module('@cashu/cashu-ts', () => ({
  Mint: class MockMint {
    getInfo() {
      return Promise.resolve({ name: 'Mock Mint' });
    }
    getKeySets() {
      return Promise.resolve({ keysets: mockKeysets });
    }
  },
}));

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

describe('mint add', () => {
  let db: Database;

  beforeEach(() => {
    db = getTestDb();
    mockKeysets = [{ unit: 'sat', active: true, id: 'mock-keyset' }];
  });

  test('adds a mint with default BTC currency', async () => {
    const result = await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com']),
      db,
    );
    expect(result.action).toBe('added');
    expect(result.account).toBeDefined();
    expect(result.account?.mint_url).toBe('https://mint.example.com');
    expect(result.account?.currency).toBe('BTC');
    expect(result.account?.type).toBe('cashu');
    expect(result.account?.name).toBe('BTC Mint');
  });

  test('adds a mint with USD currency', async () => {
    mockKeysets = [{ unit: 'usd', active: true, id: 'mock-usd-keyset' }];
    const result = await handleMintCommand(
      makeArgs(['add', 'https://usd.mint.com'], { currency: 'USD' }),
      db,
    );
    expect(result.action).toBe('added');
    expect(result.account?.currency).toBe('USD');
    expect(result.account?.name).toBe('USD Mint');
  });

  test('adds a mint with custom name', async () => {
    const result = await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com'], { name: 'My Mint' }),
      db,
    );
    expect(result.account?.name).toBe('My Mint');
  });

  test('strips trailing slashes from URL', async () => {
    const result = await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com///']),
      db,
    );
    expect(result.account?.mint_url).toBe('https://mint.example.com');
  });

  test('rejects invalid URL', async () => {
    const result = await handleMintCommand(makeArgs(['add', 'not-a-url']), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('INVALID_URL');
  });

  test('rejects missing URL', async () => {
    const result = await handleMintCommand(makeArgs(['add']), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_URL');
  });

  test('rejects duplicate mint', async () => {
    await handleMintCommand(makeArgs(['add', 'https://mint.example.com']), db);
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
    db = getTestDb();
    mockKeysets = [{ unit: 'sat', active: true, id: 'mock-keyset' }];
  });

  test('returns empty list when no mints', async () => {
    const result = await handleMintCommand(makeArgs(['list']), db);
    expect(result.action).toBe('list');
    expect(result.accounts).toEqual([]);
  });

  test('lists added mints', async () => {
    await handleMintCommand(makeArgs(['add', 'https://mint1.example.com']), db);
    mockKeysets = [{ unit: 'usd', active: true, id: 'mock-usd-keyset' }];
    await handleMintCommand(
      makeArgs(['add', 'https://mint2.example.com'], { currency: 'USD' }),
      db,
    );

    const result = await handleMintCommand(makeArgs(['list']), db);
    expect(result.action).toBe('list');
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts?.[0].mint_url).toBe('https://mint1.example.com');
    expect(result.accounts?.[1].mint_url).toBe('https://mint2.example.com');
  });
});

describe('mint unknown subcommand', () => {
  test('returns error for unknown subcommand', async () => {
    const db = getTestDb();
    const result = await handleMintCommand(makeArgs(['delete']), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('UNKNOWN_SUBCOMMAND');
  });

  test('returns error when no subcommand', async () => {
    const db = getTestDb();
    const result = await handleMintCommand(makeArgs([]), db);
    expect(result.action).toBe('error');
    expect(result.code).toBe('UNKNOWN_SUBCOMMAND');
  });
});
