import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { EncryptionService } from '../crypto/encryption';
import { CashuTokenMeltDbDataSchema } from '../db/cashu-token-melt-db-data';
import { SparkLightningReceiveDbDataSchema } from '../db/spark-receive-quote-db-data';
import { makeFakeDb } from '../test-support';
import { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';

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
  return new SparkReceiveQuoteRepository(db, encryption);
}

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

/** Build a minimal spark_receive_quotes row for tests. */
async function makeSparkReceiveQuoteRow(
  overrides: {
    state?: string;
    type?: string;
    cashu_token_melt_initiated?: boolean | null;
    encrypted_data?: string;
    spark_transfer_id?: string | null;
    failure_reason?: string | null;
  } = {},
) {
  const receiveDataFixture = SparkLightningReceiveDbDataSchema.parse({
    paymentRequest: 'lnbc1234',
    amountReceived: btc(1000),
    totalFee: btc(0),
  });

  return {
    id: 'srq1',
    account_id: 'acc1',
    user_id: 'u1',
    created_at: '2024-01-01T00:00:00Z',
    expires_at: '2024-01-02T00:00:00Z',
    encrypted_data: await enc(receiveDataFixture),
    payment_hash: 'abc123',
    receiver_identity_pubkey: null,
    spark_id: 'spark_rcv_1',
    spark_transfer_id: null,
    state: 'UNPAID',
    type: 'LIGHTNING',
    failure_reason: null,
    cashu_token_melt_initiated: null,
    transaction_id: 'tx1',
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SparkReceiveQuoteRepository', () => {
  describe('get', () => {
    it('returns null when the row is absent', async () => {
      const db = makeFakeDb({ selectResult: { data: null, error: null } });
      const result = await repo(db).get('missing-id');
      expect(result).toBeNull();
    });
  });

  describe('toQuote decrypt round-trip — LIGHTNING UNPAID', () => {
    it('decrypts a LIGHTNING UNPAID row into a SparkReceiveQuote', async () => {
      const row = await makeSparkReceiveQuoteRow({
        state: 'UNPAID',
        type: 'LIGHTNING',
      });
      const db = makeFakeDb({ selectResult: { data: row, error: null } });

      const result = await repo(db).get('srq1');
      expect(result).not.toBeNull();
      expect(result?.state).toBe('UNPAID');
      expect(result?.type).toBe('LIGHTNING');
      expect(result?.id).toBe('srq1');
      expect(result?.amount.toNumber('sat')).toBe(1000);
      expect(result?.totalFee.toNumber('sat')).toBe(0);
      expect(result?.paymentRequest).toBe('lnbc1234');
      expect(result?.sparkId).toBe('spark_rcv_1');
      expect(result?.transactionId).toBe('tx1');
      expect(result?.userId).toBe('u1');
      expect(result?.accountId).toBe('acc1');
      expect(result?.version).toBe(1);
    });
  });

  describe('toQuote decrypt round-trip — CASHU_TOKEN UNPAID', () => {
    it('decrypts a CASHU_TOKEN row and produces tokenReceiveData with meltInitiated === false', async () => {
      const meltDbData = CashuTokenMeltDbDataSchema.parse({
        tokenMintUrl: 'https://mint.example.com',
        meltQuoteId: 'mq1',
        tokenAmount: btc(500),
        tokenProofs: [],
        cashuReceiveFee: btc(2),
        lightningFeeReserve: btc(3),
      });

      const cashuTokenReceiveDataFixture =
        SparkLightningReceiveDbDataSchema.parse({
          paymentRequest: 'lnbc5000',
          amountReceived: btc(500),
          totalFee: btc(5),
          cashuTokenMeltData: meltDbData,
        });

      const row = await makeSparkReceiveQuoteRow({
        state: 'UNPAID',
        type: 'CASHU_TOKEN',
        cashu_token_melt_initiated: false,
        encrypted_data: await enc(cashuTokenReceiveDataFixture),
      });

      const db = makeFakeDb({ selectResult: { data: row, error: null } });
      const result = await repo(db).get('srq1');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('CASHU_TOKEN');
      expect(result?.state).toBe('UNPAID');

      if (result?.type === 'CASHU_TOKEN') {
        expect(result.tokenReceiveData.meltInitiated).toBe(false);
        expect(result.tokenReceiveData.sourceMintUrl).toBe(
          'https://mint.example.com',
        );
        expect(result.tokenReceiveData.meltQuoteId).toBe('mq1');
        expect(result.tokenReceiveData.tokenAmount.toNumber('sat')).toBe(500);
        expect(result.tokenReceiveData.cashuReceiveFee.toNumber('sat')).toBe(2);
        expect(
          result.tokenReceiveData.lightningFeeReserve.toNumber('sat'),
        ).toBe(3);
      }
    });
  });
});
