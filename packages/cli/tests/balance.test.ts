import { describe, expect, test } from 'bun:test';
import { handleBalanceCommand } from '../src/commands/balance';
import type { SdkContext } from '../src/sdk-context';

function makeMockCtx(
  accounts: Array<{
    id: string;
    name: string;
    type: 'cashu' | 'spark';
    currency: 'BTC' | 'USD';
    mintUrl?: string;
    proofs?: Array<{ amount: number }>;
  }>,
): SdkContext {
  const mapped = accounts.map((a) => {
    if (a.type === 'cashu') {
      return {
        id: a.id,
        name: a.name,
        type: 'cashu' as const,
        currency: a.currency,
        purpose: 'transactional' as const,
        isOnline: true,
        createdAt: new Date().toISOString(),
        version: 1,
        mintUrl: a.mintUrl ?? 'https://mint.example.com',
        isTestMint: false,
        keysetCounters: {},
        proofs: (a.proofs ?? []).map((p, i) => ({
          id: `proof-${i}`,
          accountId: a.id,
          userId: 'test-user',
          keysetId: 'keyset1',
          amount: p.amount,
          secret: `secret-${i}`,
          unblindedSignature: `sig-${i}`,
          publicKeyY: `y-${i}`,
          dleq: null,
          witness: null,
          state: 'UNSPENT' as const,
          version: 1,
          createdAt: new Date().toISOString(),
          reservedAt: null,
        })),
        wallet: {} as unknown,
      };
    }
    return {
      id: a.id,
      name: a.name,
      type: 'spark' as const,
      currency: a.currency,
      purpose: 'transactional' as const,
      isOnline: true,
      createdAt: new Date().toISOString(),
      version: 1,
      ownedBalance: null,
      availableBalance: null,
      network: 'REGTEST' as const,
      wallet: {} as unknown,
    };
  });

  return {
    userId: 'test-user',
    accountRepo: {
      getAll: async () => mapped,
    },
  } as unknown as SdkContext;
}

describe('balance', () => {
  test('returns empty when no accounts', async () => {
    const ctx = makeMockCtx([]);
    const result = await handleBalanceCommand(ctx);
    expect(result.accounts).toEqual([]);
    expect(result.totals).toEqual({});
  });

  test('returns zero balance for account with no proofs', async () => {
    const ctx = makeMockCtx([
      { id: '1', name: 'Test', type: 'cashu', currency: 'BTC', proofs: [] },
    ]);
    const result = await handleBalanceCommand(ctx);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].balance).toBe(0);
    expect(result.accounts[0].proofCount).toBe(0);
  });

  test('sums proof amounts', async () => {
    const ctx = makeMockCtx([
      {
        id: '1',
        name: 'Test',
        type: 'cashu',
        currency: 'BTC',
        proofs: [{ amount: 100 }, { amount: 200 }, { amount: 50 }],
      },
    ]);
    const result = await handleBalanceCommand(ctx);
    expect(result.accounts[0].balance).toBe(350);
    expect(result.accounts[0].proofCount).toBe(3);
  });

  test('computes totals per currency', async () => {
    const ctx = makeMockCtx([
      {
        id: '1',
        name: 'BTC 1',
        type: 'cashu',
        currency: 'BTC',
        mintUrl: 'https://mint1.com',
        proofs: [{ amount: 100 }],
      },
      {
        id: '2',
        name: 'BTC 2',
        type: 'cashu',
        currency: 'BTC',
        mintUrl: 'https://mint2.com',
        proofs: [{ amount: 200 }],
      },
      {
        id: '3',
        name: 'USD 1',
        type: 'cashu',
        currency: 'USD',
        mintUrl: 'https://usd.mint.com',
        proofs: [{ amount: 5000 }],
      },
    ]);
    const result = await handleBalanceCommand(ctx);
    expect(result.totals.BTC).toBe(300);
    expect(result.totals.USD).toBe(5000);
  });
});
