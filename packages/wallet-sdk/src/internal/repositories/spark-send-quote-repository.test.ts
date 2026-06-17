import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { DomainError } from '../../errors';
import { EncryptionService } from '../crypto/encryption';
import { SparkLightningSendDbDataSchema } from '../db/spark-send-quote-db-data';
import { makeFakeDb } from '../test-support';
import { SparkSendQuoteRepository } from './spark-send-quote-repository';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const priv = secp256k1.utils.randomPrivateKey();
const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));
const encryption = new EncryptionService({
  getChildMnemonic: async () => 'm',
  getPrivateKeyBytes: async () => priv,
  getPublicKeyHex: async () => pubHex,
});

async function enc(value: unknown) {
  return (await encryption.get()).encrypt(value);
}

function repo(db: ReturnType<typeof makeFakeDb>) {
  return new SparkSendQuoteRepository(db, encryption);
}

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

/** Minimal sendData fixture matching SparkLightningSendDbDataSchema. */
const sendDataFixture = SparkLightningSendDbDataSchema.parse({
  paymentRequest: 'lnbc1234',
  amountReceived: btc(1000),
  estimatedLightningFee: btc(5),
});

/** Build a minimal spark_send_quotes row for tests. */
async function makeSparkSendQuoteRow(
  state = 'UNPAID',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'ssq1',
    account_id: 'acc1',
    user_id: 'u1',
    created_at: '2024-01-01T00:00:00Z',
    expires_at: null,
    encrypted_data: await enc(sendDataFixture),
    payment_hash: 'abc123',
    payment_request_is_amountless: false,
    spark_id: null,
    spark_transfer_id: null,
    state,
    failure_reason: null,
    transaction_id: 'tx1',
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SparkSendQuoteRepository', () => {
  describe('get', () => {
    it('returns null when the row is absent', async () => {
      const db = makeFakeDb({ selectResult: { data: null, error: null } });
      const result = await repo(db).get('missing-id');
      expect(result).toBeNull();
    });

    it('returns a SparkSendQuote when row is present (UNPAID)', async () => {
      const row = await makeSparkSendQuoteRow('UNPAID');
      const db = makeFakeDb({ selectResult: { data: row, error: null } });
      const result = await repo(db).get('ssq1');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('ssq1');
      expect(result?.state).toBe('UNPAID');
    });

    it('throws a classified error on db failure', async () => {
      const db = makeFakeDb({
        selectResult: { data: null, error: { message: 'boom', code: 'XX000' } },
      });
      await expect(repo(db).get('ssq1')).rejects.toThrow();
    });
  });

  describe('create', () => {
    it('maps 23505 to a duplicate DomainError', async () => {
      const db = makeFakeDb({
        rpcResult: { data: null, error: { code: '23505', message: 'dup' } },
      });
      const createInput = {
        userId: 'u1',
        accountId: 'acc1',
        amount: btc(1000),
        estimatedFee: btc(5),
        paymentRequest: 'lnbc1234',
        paymentHash: 'abc123',
        paymentRequestIsAmountless: false,
      };

      let thrown: unknown;
      try {
        await repo(db).create(createInput);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(DomainError);
      expect((thrown as DomainError).code).toBe('duplicate');
    });

    it('throws a classified SdkError on other db errors', async () => {
      const db = makeFakeDb({
        rpcResult: { data: null, error: { code: 'XX000', message: 'fail' } },
      });
      await expect(
        repo(db).create({
          userId: 'u1',
          accountId: 'acc1',
          amount: btc(1000),
          estimatedFee: btc(5),
          paymentRequest: 'lnbc1234',
          paymentHash: 'abc123',
          paymentRequestIsAmountless: false,
        }),
      ).rejects.toThrow();
    });
  });

  describe('toQuote decrypt round-trip (via create RPC)', () => {
    it('decrypts an UNPAID row returned by the RPC into a SparkSendQuote', async () => {
      const row = await makeSparkSendQuoteRow('UNPAID');
      const db = makeFakeDb({
        rpcResult: { data: row, error: null },
      });

      const result = await repo(db).create({
        userId: 'u1',
        accountId: 'acc1',
        amount: btc(1000),
        estimatedFee: btc(5),
        paymentRequest: 'lnbc1234',
        paymentHash: 'abc123',
        paymentRequestIsAmountless: false,
      });

      expect(result.state).toBe('UNPAID');
      expect(result.id).toBe('ssq1');
      expect(result.amount.toNumber('sat')).toBe(1000);
      expect(result.estimatedFee.toNumber('sat')).toBe(5);
      expect(result.paymentRequest).toBe('lnbc1234');
      expect(result.paymentHash).toBe('abc123');
      expect(result.transactionId).toBe('tx1');
      expect(result.userId).toBe('u1');
      expect(result.accountId).toBe('acc1');
      expect(result.version).toBe(1);
      expect(result.paymentRequestIsAmountless).toBe(false);
    });
  });

  describe('markAsPending', () => {
    it('decrypts an RPC-returned PENDING row into a SparkSendQuote', async () => {
      const fee = btc(3);
      const pendingSendData = SparkLightningSendDbDataSchema.parse({
        paymentRequest: 'lnbc1234',
        amountReceived: btc(1000),
        estimatedLightningFee: btc(5),
        amountSpent: btc(1003),
        lightningFee: fee,
      });
      const row = await makeSparkSendQuoteRow('PENDING', {
        encrypted_data: await enc(pendingSendData),
        spark_id: 'sr1',
        spark_transfer_id: 't1',
      });
      const db = makeFakeDb({
        rpcResult: { data: row, error: null },
      });

      const unpaidQuote = {
        id: 'ssq1',
        state: 'UNPAID' as const,
        paymentRequest: 'lnbc1234',
        amount: btc(1000),
        estimatedFee: btc(5),
        paymentHash: 'abc123',
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: null,
        transactionId: 'tx1',
        userId: 'u1',
        accountId: 'acc1',
        version: 1,
        paymentRequestIsAmountless: false,
      };

      const result = await repo(db).markAsPending({
        quote: unpaidQuote,
        sparkSendRequestId: 'sr1',
        sparkTransferId: 't1',
        fee,
      });

      expect(result.state).toBe('PENDING');
      if (result.state === 'PENDING') {
        expect(result.sparkId).toBe('sr1');
        expect(result.sparkTransferId).toBe('t1');
        expect(result.fee.toNumber('sat')).toBe(3);
      }
    });
  });

  describe('fail', () => {
    it('returns a FAILED quote with a failureReason', async () => {
      const row = await makeSparkSendQuoteRow('FAILED', {
        failure_reason: 'payment failed',
      });
      const db = makeFakeDb({
        rpcResult: { data: row, error: null },
      });

      const result = await repo(db).fail('ssq1', 'payment failed');
      expect(result.state).toBe('FAILED');
      if (result.state === 'FAILED') {
        expect(result.failureReason).toBe('payment failed');
      }
    });
  });
});
