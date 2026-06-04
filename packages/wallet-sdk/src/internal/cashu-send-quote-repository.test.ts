import { describe, expect, mock, test } from 'bun:test';
import { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import type { Encryption } from './encryption';
import type { WalletSupabaseClient } from './supabase-client';
import { ConcurrencyError } from '../errors';
import { type Currency, Money } from '../types/money';

// -- Fakes ----------------------------------------------------------------------------------

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

/** An Encryption stub: encrypt returns a marker, encryptBatch returns markers, decrypt unused. */
const encryption: Encryption = {
  encrypt: async () => 'enc',
  encryptBatch: async (data: readonly unknown[]) => data.map(() => 'enc'),
  decrypt: async () => undefined as never,
  decryptBatch: async (data: readonly unknown[]) => data.map(() => '') as never,
};

/** A Supabase client whose `rpc` returns the queued `{ data, error }`. */
function fakeDb(rpcResult: {
  data?: unknown;
  error?: unknown;
}): WalletSupabaseClient {
  return {
    rpc: mock(() => Promise.resolve(rpcResult)),
  } as unknown as WalletSupabaseClient;
}

const createParams = {
  userId: 'u1',
  accountId: 'acc1',
  paymentRequest: 'lnbc1...',
  paymentHash: 'hash',
  expiresAt: '2026-01-01T01:00:00.000Z',
  amountRequested: sats(100),
  amountRequestedInMsat: 100_000,
  amountToReceive: sats(100),
  lightningFeeReserve: sats(1),
  cashuFee: sats(0),
  quoteId: 'melt1',
  keysetId: 'ks1',
  numberOfChangeOutputs: 0,
  proofsToSend: [],
  amountReserved: sats(101),
};

// -- Tests ----------------------------------------------------------------------------------

describe('CashuSendQuoteRepository.create — stale-proof / concurrency guard', () => {
  test('a CONCURRENCY_ERROR hint becomes a ConcurrencyError (preserving message + details)', async () => {
    const repo = new CashuSendQuoteRepository(
      fakeDb({
        error: {
          hint: 'CONCURRENCY_ERROR',
          message: 'proofs were reserved by another operation',
          details: 'acc1',
        },
      }),
      encryption,
    );

    const promise = repo.create(createParams);
    await expect(promise).rejects.toBeInstanceOf(ConcurrencyError);
    await expect(promise).rejects.toThrow(/reserved by another operation/);
  });

  test('a non-concurrency error becomes a generic Error', async () => {
    const repo = new CashuSendQuoteRepository(
      fakeDb({ error: { message: 'boom' } }),
      encryption,
    );
    const promise = repo.create(createParams);
    await expect(promise).rejects.toThrow(/Failed to create cashu send quote/);
    await expect(promise).rejects.not.toBeInstanceOf(ConcurrencyError);
  });
});
