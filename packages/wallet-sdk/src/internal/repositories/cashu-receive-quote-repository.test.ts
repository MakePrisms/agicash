import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { EncryptionService } from '../crypto/encryption';
import { CashuLightningReceiveDbDataSchema } from '../db/cashu-receive-quote-db-data';
import { makeFakeDb } from '../test-support';
import type { AccountRepository } from './account-repository';
import { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';

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
  return new CashuReceiveQuoteRepository(db, encryption, fakeAccountRepository);
}

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

/** Minimal receiveData fixture matching CashuLightningReceiveDbDataSchema for a LIGHTNING quote. */
const lightningReceiveDataFixture = CashuLightningReceiveDbDataSchema.parse({
  paymentRequest: 'lnbc5678',
  mintQuoteId: 'mq-abc',
  amountReceived: btc(2000),
  description: undefined,
  mintingFee: undefined,
  cashuTokenMeltData: undefined,
  totalFee: btc(0),
});

/** Build a minimal AgicashDbCashuReceiveQuote row for tests. */
async function makeReceiveQuoteRow(
  state = 'UNPAID',
  type = 'LIGHTNING',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'rq1',
    account_id: 'acc1',
    user_id: 'u1',
    created_at: '2024-01-01T00:00:00Z',
    expires_at: '2024-01-01T01:00:00Z',
    encrypted_data: await enc(lightningReceiveDataFixture),
    payment_hash: 'ph123',
    quote_id_hash: 'qhash-xyz',
    locking_derivation_path: "m/129372'/0'/0'/4321",
    state,
    type,
    failure_reason: null,
    transaction_id: 'tx1',
    version: 1,
    keyset_id: null,
    keyset_counter: null,
    cashu_token_melt_initiated: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CashuReceiveQuoteRepository', () => {
  describe('get', () => {
    it('returns null when row is absent', async () => {
      const db = makeFakeDb({ selectResult: { data: null, error: null } });
      const result = await repo(db).get('missing-id');
      expect(result).toBeNull();
    });

    it('throws a classified error on db failure', async () => {
      const db = makeFakeDb({
        selectResult: {
          data: null,
          error: { message: 'db error', code: 'XX000' },
        },
      });
      await expect(repo(db).get('rq1')).rejects.toThrow();
    });
  });

  describe('toQuote — LIGHTNING round-trip via get', () => {
    it('decrypts encrypted_data and maps a LIGHTNING UNPAID quote correctly', async () => {
      const row = await makeReceiveQuoteRow('UNPAID', 'LIGHTNING');
      const db = makeFakeDb({ selectResult: { data: row, error: null } });

      const result = await repo(db).get('rq1');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('rq1');
      expect(result?.type).toBe('LIGHTNING');
      expect(result?.state).toBe('UNPAID');
      expect(result?.quoteId).toBe('mq-abc');
      expect(result?.amount.toString()).toBe(btc(2000).toString());
      expect(result?.paymentRequest).toBe('lnbc5678');
      expect(result?.paymentHash).toBe('ph123');
      expect(result?.transactionId).toBe('tx1');
      expect(result?.lockingDerivationPath).toBe("m/129372'/0'/0'/4321");
    });

    it('maps a PAID LIGHTNING quote with keyset fields', async () => {
      const paidReceiveData = CashuLightningReceiveDbDataSchema.parse({
        ...lightningReceiveDataFixture,
        outputAmounts: [1000, 512, 256, 128, 64, 32, 8],
      });
      const row = await makeReceiveQuoteRow('PAID', 'LIGHTNING', {
        encrypted_data: await enc(paidReceiveData),
        keyset_id: 'ks-paid',
        keyset_counter: 7,
      });
      const db = makeFakeDb({ selectResult: { data: row, error: null } });

      const result = await repo(db).get('rq1');

      expect(result?.state).toBe('PAID');
      if (result?.state === 'PAID') {
        expect(result.keysetId).toBe('ks-paid');
        expect(result.keysetCounter).toBe(7);
        expect(result.outputAmounts).toEqual([1000, 512, 256, 128, 64, 32, 8]);
      }
    });

    it('maps a FAILED LIGHTNING quote with failureReason', async () => {
      const row = await makeReceiveQuoteRow('FAILED', 'LIGHTNING', {
        failure_reason: 'payment timed out',
      });
      const db = makeFakeDb({ selectResult: { data: row, error: null } });

      const result = await repo(db).get('rq1');

      expect(result?.state).toBe('FAILED');
      if (result?.state === 'FAILED') {
        expect(result.failureReason).toBe('payment timed out');
      }
    });
  });

  describe('create', () => {
    it('calls the RPC with correct params and returns the mapped quote', async () => {
      const row = await makeReceiveQuoteRow('UNPAID', 'LIGHTNING');
      const calls: { rpc?: Array<{ name: string; args: unknown }> } = {
        rpc: [],
      };
      const db = makeFakeDb({
        rpcResult: { data: row, error: null },
        calls,
      });

      const result = await repo(db).create({
        userId: 'u1',
        accountId: 'acc1',
        amount: btc(2000),
        quoteId: 'mq-abc',
        paymentRequest: 'lnbc5678',
        paymentHash: 'ph123',
        expiresAt: '2024-01-01T01:00:00Z',
        lockingDerivationPath: "m/129372'/0'/0'/4321",
        receiveType: 'LIGHTNING',
        totalFee: btc(0),
      });

      expect(calls.rpc).toHaveLength(1);
      const call = calls.rpc?.[0];
      expect(call?.name).toBe('create_cashu_receive_quote');
      const args = call?.args as Record<string, unknown>;
      expect(args.p_user_id).toBe('u1');
      expect(args.p_account_id).toBe('acc1');
      expect(args.p_receive_type).toBe('LIGHTNING');

      expect(result.id).toBe('rq1');
      expect(result.state).toBe('UNPAID');
      expect(result.type).toBe('LIGHTNING');
    });

    it('throws a classified error on RPC failure', async () => {
      const db = makeFakeDb({
        rpcResult: {
          data: null,
          error: { message: 'rpc error', code: 'XX000' },
        },
      });

      await expect(
        repo(db).create({
          userId: 'u1',
          accountId: 'acc1',
          amount: btc(2000),
          quoteId: 'mq-abc',
          paymentRequest: 'lnbc5678',
          paymentHash: 'ph123',
          expiresAt: '2024-01-01T01:00:00Z',
          lockingDerivationPath: "m/129372'/0'/0'/4321",
          receiveType: 'LIGHTNING',
          totalFee: btc(0),
        }),
      ).rejects.toThrow();
    });
  });
});
