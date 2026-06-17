import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { DomainError } from '../../errors';
import { EncryptionService } from '../crypto/encryption';
import { CashuLightningSendDbDataSchema } from '../db/cashu-send-quote-db-data';
import { makeFakeDb } from '../test-support';
import { CashuSendQuoteRepository } from './cashu-send-quote-repository';

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
  return new CashuSendQuoteRepository(db, encryption);
}

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

/** Minimal sendData fixture matching CashuLightningSendDbDataSchema. */
const sendDataFixture = CashuLightningSendDbDataSchema.parse({
  paymentRequest: 'lnbc1234',
  amountRequested: btc(1000),
  amountRequestedInMsat: 1_000_000,
  amountReceived: btc(1000),
  lightningFeeReserve: btc(10),
  cashuSendFee: btc(1),
  meltQuoteId: 'quote-abc',
  amountReserved: btc(1011),
});

/** Build a minimal AgicashDbCashuSendQuote row for tests. */
async function makeSendQuoteRow(
  state = 'UNPAID',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'sq1',
    account_id: 'acc1',
    user_id: 'u1',
    created_at: '2024-01-01T00:00:00Z',
    expires_at: '2024-01-01T01:00:00Z',
    currency_requested: 'BTC',
    encrypted_data: await enc(sendDataFixture),
    payment_hash: 'abc123',
    quote_id_hash: 'hash-xyz',
    keyset_id: 'ks1',
    keyset_counter: 0,
    number_of_change_outputs: 2,
    state,
    failure_reason: null,
    transaction_id: 'tx1',
    version: 1,
    cashu_proofs: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CashuSendQuoteRepository', () => {
  describe('get', () => {
    it('returns null when row is absent', async () => {
      const db = makeFakeDb({ selectResult: { data: null, error: null } });
      const result = await repo(db).get('missing-id');
      expect(result).toBeNull();
    });

    it('returns a CashuSendQuote when row is present', async () => {
      const row = await makeSendQuoteRow('UNPAID');
      const db = makeFakeDb({ selectResult: { data: row, error: null } });
      const result = await repo(db).get('sq1');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('sq1');
      expect(result?.state).toBe('UNPAID');
    });

    it('throws a classified error on db failure', async () => {
      const db = makeFakeDb({
        selectResult: { data: null, error: { message: 'boom', code: 'XX000' } },
      });
      await expect(repo(db).get('sq1')).rejects.toThrow();
    });
  });

  describe('create', () => {
    it('throws DomainError with code limit_reached on LIMIT_REACHED hint', async () => {
      const db = makeFakeDb({
        rpcResult: {
          data: null,
          error: {
            hint: 'LIMIT_REACHED',
            message: 'limit',
            details: 'reached',
          },
        },
      });

      const createInput = {
        userId: 'u1',
        accountId: 'acc1',
        paymentRequest: 'lnbc1234',
        paymentHash: 'abc123',
        expiresAt: '2024-01-01T01:00:00Z',
        amountRequested: btc(1000),
        amountRequestedInMsat: 1_000_000,
        amountToReceive: btc(1000),
        lightningFeeReserve: btc(10),
        cashuFee: btc(1),
        quoteId: 'quote-abc',
        keysetId: 'ks1',
        numberOfChangeOutputs: 2,
        proofsToSend: [
          {
            id: 'p1',
            accountId: 'acc1',
            userId: 'u1',
            keysetId: 'ks1',
            amount: 1011,
            secret: 's3cret',
            unblindedSignature: 'sig',
            publicKeyY: 'Y',
            dleq: undefined,
            witness: undefined,
            state: 'RESERVED' as const,
            version: 1,
            createdAt: 't',
            reservedAt: 't',
          },
        ],
        amountReserved: btc(1011),
      };

      let thrown: unknown;
      try {
        await repo(db).create(createInput);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(DomainError);
      expect((thrown as DomainError).code).toBe('limit_reached');
    });
  });

  describe('markAsPending', () => {
    it('decrypts an RPC-returned row into a CashuSendQuote with correct state and amount', async () => {
      const row = await makeSendQuoteRow('PENDING');
      const db = makeFakeDb({
        rpcResult: {
          data: { quote: row, proofs: [] },
          error: null,
        },
      });

      const result = await repo(db).markAsPending('sq1');
      expect(result.state).toBe('PENDING');
      expect(result.id).toBe('sq1');
      expect(result.quoteId).toBe('quote-abc');
      expect(result.amountReceived.toString()).toBe(btc(1000).toString());
    });
  });

  describe('fail', () => {
    it('returns a FAILED quote with a failureReason', async () => {
      const row = await makeSendQuoteRow('FAILED', {
        failure_reason: 'payment failed',
      });
      const db = makeFakeDb({
        rpcResult: {
          data: { quote: row, released_proofs: [] },
          error: null,
        },
      });

      const result = await repo(db).fail({
        id: 'sq1',
        reason: 'payment failed',
      });
      expect(result.state).toBe('FAILED');
      if (result.state === 'FAILED') {
        expect(result.failureReason).toBe('payment failed');
      }
    });
  });

  describe('complete', () => {
    it('returns a PAID quote with correct fee arithmetic and paymentPreimage', async () => {
      // Build a PENDING quote to pass as input.
      const pendingRow = await makeSendQuoteRow('PENDING');
      const pendingDb = makeFakeDb({
        rpcResult: { data: { quote: pendingRow, proofs: [] }, error: null },
      });
      const pendingQuote = await repo(pendingDb).markAsPending('sq1');

      // amountSpent = amountReceived(1000) + cashuFee(1) + actualLightningFee(3) = 1004
      const amountSpent = btc(1004);

      // Build the completed sendData row that the DB will return after the RPC.
      const completedSendData = CashuLightningSendDbDataSchema.parse({
        ...sendDataFixture,
        amountSpent,
        paymentPreimage: 'preimage123',
        lightningFee: btc(3),
        totalFee: btc(4), // cashuFee(1) + lightningFee(3)
      });
      const completedRow = {
        ...pendingRow,
        state: 'PAID',
        encrypted_data: await enc(completedSendData),
        cashu_proofs: [],
      };

      const completeDb = makeFakeDb({
        rpcResult: {
          data: { quote: completedRow, spent_proofs: [] },
          error: null,
        },
      });

      const result = await repo(completeDb).complete({
        quote: pendingQuote,
        paymentPreimage: 'preimage123',
        amountSpent,
        changeProofs: [],
      });

      expect(result.state).toBe('PAID');
      if (result.state === 'PAID') {
        expect(result.paymentPreimage).toBe('preimage123');
        expect(result.lightningFee.toString()).toBe(btc(3).toString());
        expect(result.totalFee.toString()).toBe(btc(4).toString());
        expect(result.amountSpent.toString()).toBe(btc(1004).toString());
      }
    });
  });

  describe('toQuote (via markAsPending) — full round-trip with encrypted proof', () => {
    it('decrypts proof amount and secret correctly', async () => {
      const encryptedAmount = await enc(42);
      const encryptedSecret = await enc('proof-secret');

      const row = {
        ...(await makeSendQuoteRow('PENDING')),
        cashu_proofs: [
          {
            id: 'cp1',
            account_id: 'acc1',
            user_id: 'u1',
            keyset_id: 'ks1',
            amount: encryptedAmount,
            secret: encryptedSecret,
            unblinded_signature: 'sig',
            public_key_y: 'Y',
            dleq: null,
            witness: null,
            state: 'RESERVED',
            version: 1,
            created_at: 't',
            reserved_at: 't',
            cashu_receive_quote_id: null,
            cashu_receive_swap_token_hash: null,
            cashu_send_quote_id: null,
            cashu_send_swap_id: null,
            spending_cashu_send_quote_id: 'sq1',
            spending_cashu_send_swap_id: null,
            spent_at: null,
          },
        ],
      };

      const db = makeFakeDb({
        rpcResult: {
          data: { quote: row, proofs: row.cashu_proofs },
          error: null,
        },
      });

      const result = await repo(db).markAsPending('sq1');
      expect(result.proofs).toHaveLength(1);
      expect(result.proofs[0]?.amount).toBe(42);
      expect(result.proofs[0]?.secret).toBe('proof-secret');
    });
  });
});
