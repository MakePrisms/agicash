import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ParsedArgs } from '../src/args';
import { handleMintCommand } from '../src/commands/mint';
import type { SdkContext } from '../src/sdk-context';

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

// Track accounts created via the mock service
let createdAccounts: Array<{
  id: string;
  name: string;
  type: 'cashu';
  currency: string;
  mintUrl: string;
  isTestMint: boolean;
  createdAt: string;
  purpose: string;
  isOnline: boolean;
  version: number;
  keysetCounters: Record<string, number>;
  proofs: never[];
  wallet: unknown;
}>;

function makeMockCtx(): SdkContext {
  return {
    userId: 'test-user',
    accountService: {
      addCashuAccount: async ({
        account,
      }: {
        userId: string;
        account: {
          name: string;
          currency: string;
          mintUrl: string;
          purpose: string;
        };
      }) => {
        // Check for duplicate
        const existing = createdAccounts.find(
          (a) =>
            a.mintUrl === account.mintUrl && a.currency === account.currency,
        );
        if (existing) {
          throw new Error('Account for this mint and currency already exists');
        }
        const created = {
          id: `acc-${createdAccounts.length + 1}`,
          name: account.name,
          type: 'cashu' as const,
          currency: account.currency,
          mintUrl: account.mintUrl,
          isTestMint: false,
          createdAt: new Date().toISOString(),
          purpose: account.purpose,
          isOnline: true,
          version: 1,
          keysetCounters: {},
          proofs: [] as never[],
          wallet: {},
        };
        createdAccounts.push(created);
        return created;
      },
    },
    accountRepo: {
      getAll: async () => createdAccounts,
    },
  } as unknown as SdkContext;
}

describe('mint add', () => {
  beforeEach(() => {
    mockKeysets = [{ unit: 'sat', active: true, id: 'mock-keyset' }];
    createdAccounts = [];
  });

  test('adds a mint with default BTC currency', async () => {
    const ctx = makeMockCtx();
    const result = await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com']),
      ctx,
    );
    expect(result.action).toBe('added');
    expect(result.account).toBeDefined();
    expect(result.account?.mintUrl).toBe('https://mint.example.com');
    expect(result.account?.currency).toBe('BTC');
    expect(result.account?.type).toBe('cashu');
    expect(result.account?.name).toBe('BTC Mint');
  });

  test('adds a mint with USD currency', async () => {
    mockKeysets = [{ unit: 'usd', active: true, id: 'mock-usd-keyset' }];
    const ctx = makeMockCtx();
    const result = await handleMintCommand(
      makeArgs(['add', 'https://usd.mint.com'], { currency: 'USD' }),
      ctx,
    );
    expect(result.action).toBe('added');
    expect(result.account?.currency).toBe('USD');
    expect(result.account?.name).toBe('USD Mint');
  });

  test('adds a mint with custom name', async () => {
    const ctx = makeMockCtx();
    const result = await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com'], { name: 'My Mint' }),
      ctx,
    );
    expect(result.account?.name).toBe('My Mint');
  });

  test('strips trailing slashes from URL', async () => {
    const ctx = makeMockCtx();
    const result = await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com///']),
      ctx,
    );
    expect(result.account?.mintUrl).toBe('https://mint.example.com');
  });

  test('rejects invalid URL', async () => {
    const ctx = makeMockCtx();
    const result = await handleMintCommand(makeArgs(['add', 'not-a-url']), ctx);
    expect(result.action).toBe('error');
    expect(result.code).toBe('INVALID_URL');
  });

  test('rejects missing URL', async () => {
    const ctx = makeMockCtx();
    const result = await handleMintCommand(makeArgs(['add']), ctx);
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_URL');
  });

  test('rejects duplicate mint', async () => {
    const ctx = makeMockCtx();
    await handleMintCommand(makeArgs(['add', 'https://mint.example.com']), ctx);
    const result = await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com']),
      ctx,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('CREATE_FAILED');
  });

  test('rejects invalid currency', async () => {
    const ctx = makeMockCtx();
    const result = await handleMintCommand(
      makeArgs(['add', 'https://mint.example.com'], { currency: 'EUR' }),
      ctx,
    );
    expect(result.action).toBe('error');
    expect(result.code).toBe('INVALID_CURRENCY');
  });
});

describe('mint list', () => {
  beforeEach(() => {
    mockKeysets = [{ unit: 'sat', active: true, id: 'mock-keyset' }];
    createdAccounts = [];
  });

  test('returns empty list when no mints', async () => {
    const ctx = makeMockCtx();
    const result = await handleMintCommand(makeArgs(['list']), ctx);
    expect(result.action).toBe('list');
    expect(result.accounts).toEqual([]);
  });

  test('lists added mints', async () => {
    const ctx = makeMockCtx();
    await handleMintCommand(
      makeArgs(['add', 'https://mint1.example.com']),
      ctx,
    );
    mockKeysets = [{ unit: 'usd', active: true, id: 'mock-usd-keyset' }];
    await handleMintCommand(
      makeArgs(['add', 'https://mint2.example.com'], { currency: 'USD' }),
      ctx,
    );

    const result = await handleMintCommand(makeArgs(['list']), ctx);
    expect(result.action).toBe('list');
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts?.[0].mintUrl).toBe('https://mint1.example.com');
    expect(result.accounts?.[1].mintUrl).toBe('https://mint2.example.com');
  });
});

describe('mint unknown subcommand', () => {
  test('returns error for unknown subcommand', async () => {
    const ctx = makeMockCtx();
    const result = await handleMintCommand(makeArgs(['delete']), ctx);
    expect(result.action).toBe('error');
    expect(result.code).toBe('UNKNOWN_SUBCOMMAND');
  });

  test('returns error when no subcommand', async () => {
    const ctx = makeMockCtx();
    const result = await handleMintCommand(makeArgs([]), ctx);
    expect(result.action).toBe('error');
    expect(result.code).toBe('UNKNOWN_SUBCOMMAND');
  });
});
