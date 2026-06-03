import type { Token } from '@cashu/cashu-ts';
import { describe, expect, mock, test } from 'bun:test';
import { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';
import type { Encryption } from './encryption';
import type { WalletSupabaseClient } from './supabase-client';
import { UniqueConstraintError } from '../errors';
import { type Currency, Money } from '../types/money';

// -- Fakes ----------------------------------------------------------------------------------

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

const encryption: Encryption = {
  encrypt: async () => 'enc',
  encryptBatch: async (data: readonly unknown[]) => data.map(() => 'enc'),
  decrypt: async () => undefined as never,
  decryptBatch: async (data: readonly unknown[]) => data.map(() => '') as never,
};

function fakeDb(rpcResult: {
  data?: unknown;
  error?: unknown;
}): WalletSupabaseClient {
  return {
    rpc: mock(() => Promise.resolve(rpcResult)),
  } as unknown as WalletSupabaseClient;
}

const token: Token = {
  mint: 'https://mint.example',
  unit: 'sat',
  proofs: [{ id: 'ks1', amount: 100, secret: 's', C: 'C' } as never],
};

const createParams = {
  userId: 'u1',
  accountId: 'acc1',
  keysetId: 'ks1',
  inputAmount: sats(100),
  cashuReceiveFee: sats(0),
  receiveAmount: sats(100),
  outputAmounts: [100],
  token,
};

const mapAccount = mock(async () => ({}) as never);

// -- Tests ----------------------------------------------------------------------------------

describe('CashuReceiveSwapRepository.create — double-claim guard', () => {
  test('a 23505 unique-constraint violation becomes a UniqueConstraintError', async () => {
    const repo = new CashuReceiveSwapRepository(
      fakeDb({ error: { code: '23505', message: 'duplicate key' } }),
      encryption,
      mapAccount,
    );

    await expect(repo.create(createParams)).rejects.toBeInstanceOf(
      UniqueConstraintError,
    );
  });

  test('other errors become a generic Error', async () => {
    const repo = new CashuReceiveSwapRepository(
      fakeDb({ error: { code: 'XXXXX', message: 'boom' } }),
      encryption,
      mapAccount,
    );
    await expect(repo.create(createParams)).rejects.toThrow(
      /Failed to create receive swap/,
    );
  });
});
