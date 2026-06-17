import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import type { Token } from '@cashu/cashu-ts';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { DomainError } from '../../errors';
import { EncryptionService } from '../crypto/encryption';
import { CashuSwapReceiveDbDataSchema } from '../db/cashu-receive-swap-db-data';
import { makeFakeDb } from '../test-support';
import type { AccountRepository } from './account-repository';
import { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const priv = secp256k1.utils.randomPrivateKey();
const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));
const encryption = new EncryptionService({
  getChildMnemonic: async () => 'm',
  getPrivateKeyBytes: async () => priv,
  getPublicKeyHex: async () => pubHex,
});

const fakeAccountRepository = {
  toAccount: async () => ({ type: 'cashu', id: 'a1' }) as never,
} as never as AccountRepository;

async function enc(value: unknown) {
  return (await encryption.get()).encrypt(value);
}

function repo(db: ReturnType<typeof makeFakeDb>) {
  return new CashuReceiveSwapRepository(db, encryption, fakeAccountRepository);
}

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

/** Minimal proof matching ProofSchema. */
const proofFixture = {
  id: 'ks-aabbcc',
  amount: 1000,
  secret: 'mysecret',
  C: '02deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef00',
};

/** Minimal Token fixture for create() tests (getTokenHash needs at least mint + proofs). */
const tokenFixture: Token = {
  mint: 'https://mint.example.com',
  unit: 'sat',
  proofs: [proofFixture],
};

/** CashuSwapReceiveDbData fixture for PENDING swap rows. */
const pendingReceiveDataFixture = CashuSwapReceiveDbDataSchema.parse({
  tokenMintUrl: 'https://mint.example.com',
  tokenAmount: btc(1000),
  tokenProofs: [proofFixture],
  tokenDescription: undefined,
  amountReceived: btc(995),
  outputAmounts: [512, 256, 128, 64, 32, 3],
  cashuReceiveFee: btc(5),
});

/** Build a minimal cashu_receive_swaps row for tests. */
async function makeReceiveSwapRow(
  state = 'PENDING',
  overrides: Record<string, unknown> = {},
) {
  return {
    token_hash: 'abc123tokenhash',
    account_id: 'acc1',
    user_id: 'u1',
    created_at: '2024-01-01T00:00:00Z',
    encrypted_data: await enc(pendingReceiveDataFixture),
    failure_reason: null,
    keyset_counter: 7,
    keyset_id: 'ks-aabbcc',
    state,
    transaction_id: 'tx1',
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CashuReceiveSwapRepository', () => {
  describe('create — 23505 duplicate token → DomainError', () => {
    it('throws DomainError with "already been claimed" message on unique constraint violation', async () => {
      const db = makeFakeDb({
        rpcResult: {
          data: null,
          error: {
            message: 'duplicate key value violates unique constraint',
            code: '23505',
          },
        },
      });

      let thrown: unknown;
      try {
        await repo(db).create({
          token: tokenFixture,
          userId: 'u1',
          accountId: 'acc1',
          keysetId: 'ks-aabbcc',
          inputAmount: btc(1000),
          cashuReceiveFee: btc(5),
          receiveAmount: btc(995),
          outputAmounts: [512, 256, 128, 64, 32, 3],
        });
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(DomainError);
      const err = thrown as DomainError;
      expect(err.message).toContain('already been claimed');
      expect(err.code).toBe('token_already_claimed');
    });

    it('throws a classified error on other RPC failures', async () => {
      const db = makeFakeDb({
        rpcResult: {
          data: null,
          error: { message: 'internal error', code: 'XX000' },
        },
      });

      await expect(
        repo(db).create({
          token: tokenFixture,
          userId: 'u1',
          accountId: 'acc1',
          keysetId: 'ks-aabbcc',
          inputAmount: btc(1000),
          cashuReceiveFee: btc(5),
          receiveAmount: btc(995),
          outputAmounts: [512, 256, 128, 64, 32, 3],
        }),
      ).rejects.toThrow();
    });
  });

  describe('toReceiveSwap — PENDING round-trip via getByTransactionId', () => {
    it('decrypts encrypted_data and maps a PENDING swap correctly', async () => {
      const row = await makeReceiveSwapRow('PENDING');
      const db = makeFakeDb({ selectResult: { data: row, error: null } });

      const result = await repo(db).getByTransactionId('tx1');

      expect(result).not.toBeNull();
      expect(result?.state).toBe('PENDING');
      expect(result?.tokenHash).toBe('abc123tokenhash');
      expect(result?.userId).toBe('u1');
      expect(result?.accountId).toBe('acc1');
      expect(result?.transactionId).toBe('tx1');
      expect(result?.keysetId).toBe('ks-aabbcc');
      expect(result?.keysetCounter).toBe(7);
      expect(result?.version).toBe(1);
      // tokenProofs come from decrypted encrypted_data (not joined rows)
      expect(result?.tokenProofs).toHaveLength(1);
      expect(result?.tokenProofs[0]?.id).toBe('ks-aabbcc');
      expect(result?.inputAmount.toString()).toBe(btc(1000).toString());
      expect(result?.amountReceived.toString()).toBe(btc(995).toString());
      expect(result?.feeAmount.toString()).toBe(btc(5).toString());
      expect(result?.outputAmounts).toEqual([512, 256, 128, 64, 32, 3]);
    });

    it('maps a COMPLETED swap correctly', async () => {
      const row = await makeReceiveSwapRow('COMPLETED');
      const db = makeFakeDb({ selectResult: { data: row, error: null } });

      const result = await repo(db).getByTransactionId('tx1');

      expect(result?.state).toBe('COMPLETED');
    });

    it('maps a FAILED swap with failureReason', async () => {
      const row = await makeReceiveSwapRow('FAILED', {
        failure_reason: 'mint rejected the swap',
      });
      const db = makeFakeDb({ selectResult: { data: row, error: null } });

      const result = await repo(db).getByTransactionId('tx1');

      expect(result?.state).toBe('FAILED');
      if (result?.state === 'FAILED') {
        expect(result.failureReason).toBe('mint rejected the swap');
      }
    });

    it('returns null when row is absent', async () => {
      const db = makeFakeDb({ selectResult: { data: null, error: null } });
      const result = await repo(db).getByTransactionId('missing-tx');
      expect(result).toBeNull();
    });

    it('throws a classified error on db failure', async () => {
      const db = makeFakeDb({
        selectResult: {
          data: null,
          error: { message: 'db error', code: 'XX000' },
        },
      });
      await expect(repo(db).getByTransactionId('tx1')).rejects.toThrow();
    });
  });

  describe('getPending', () => {
    it('returns all PENDING swaps for a user', async () => {
      const row = await makeReceiveSwapRow('PENDING');
      const db = makeFakeDb({ selectResult: { data: [row], error: null } });

      const results = await repo(db).getPending('u1');

      expect(results).toHaveLength(1);
      expect(results[0]?.state).toBe('PENDING');
      expect(results[0]?.userId).toBe('u1');
    });

    it('returns empty array when no pending swaps', async () => {
      const db = makeFakeDb({ selectResult: { data: [], error: null } });
      const results = await repo(db).getPending('u1');
      expect(results).toHaveLength(0);
    });
  });

  describe('create — RPC params', () => {
    it('calls create_cashu_receive_swap with correct params', async () => {
      const swapRow = await makeReceiveSwapRow('PENDING');
      const accountRow = { type: 'cashu', id: 'a1' };
      const calls: { rpc?: Array<{ name: string; args: unknown }> } = {
        rpc: [],
      };
      const db = makeFakeDb({
        rpcResult: {
          data: { swap: swapRow, account: accountRow },
          error: null,
        },
        calls,
      });

      await repo(db).create({
        token: tokenFixture,
        userId: 'u1',
        accountId: 'acc1',
        keysetId: 'ks-aabbcc',
        inputAmount: btc(1000),
        cashuReceiveFee: btc(5),
        receiveAmount: btc(995),
        outputAmounts: [512, 256, 128, 64, 32, 3],
      });

      expect(calls.rpc).toHaveLength(1);
      const call = calls.rpc?.[0];
      expect(call?.name).toBe('create_cashu_receive_swap');
      const args = call?.args as Record<string, unknown>;
      expect(args['p_user_id']).toBe('u1');
      expect(args['p_account_id']).toBe('acc1');
      expect(args['p_keyset_id']).toBe('ks-aabbcc');
      expect(args['p_currency']).toBe('BTC');
      expect(args['p_number_of_outputs']).toBe(6);
      expect(typeof args['p_token_hash']).toBe('string');
      expect((args['p_token_hash'] as string).length).toBeGreaterThan(0);
      expect(typeof args['p_encrypted_data']).toBe('string');
    });
  });
});
