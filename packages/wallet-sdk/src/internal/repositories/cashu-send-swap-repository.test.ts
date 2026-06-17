import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { ConcurrencyError } from '../../errors';
import { EncryptionService } from '../crypto/encryption';
import { CashuSwapSendDbDataSchema } from '../db/cashu-send-swap-db-data';
import { makeFakeDb } from '../test-support';
import { CashuSendSwapRepository } from './cashu-send-swap-repository';

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
  return new CashuSendSwapRepository(db, encryption);
}

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

/** Minimal sendData for DRAFT swaps (swap needed → outputAmounts required). */
const draftSendDataFixture = CashuSwapSendDbDataSchema.parse({
  tokenMintUrl: 'https://mint.example.com',
  amountReceived: btc(1000),
  amountToSend: btc(1005),
  cashuReceiveFee: btc(5),
  cashuSendFee: btc(2),
  amountSpent: btc(1007),
  amountReserved: btc(1024),
  totalFee: btc(7),
  outputAmounts: { send: [1005], change: [19] },
});

/** Minimal sendData for PENDING swaps (no swap needed → no outputAmounts). */
const pendingSendDataFixture = CashuSwapSendDbDataSchema.parse({
  tokenMintUrl: 'https://mint.example.com',
  amountReceived: btc(1000),
  amountToSend: btc(1005),
  cashuReceiveFee: btc(5),
  cashuSendFee: btc(0),
  amountSpent: btc(1005),
  amountReserved: btc(1005),
  totalFee: btc(5),
});

/** Build a minimal AgicashDbCashuSendSwap DRAFT row. */
async function makeDraftSwapRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sw1',
    account_id: 'acc1',
    user_id: 'u1',
    created_at: '2024-01-01T00:00:00Z',
    encrypted_data: await enc(draftSendDataFixture),
    failure_reason: null,
    keyset_counter: 1,
    keyset_id: 'ks1',
    requires_input_proofs_swap: true,
    state: 'DRAFT',
    token_hash: null,
    transaction_id: 'tx1',
    version: 1,
    cashu_proofs: [],
    ...overrides,
  };
}

/** Build a minimal AgicashDbCashuSendSwap PENDING row. */
async function makePendingSwapRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sw1',
    account_id: 'acc1',
    user_id: 'u1',
    created_at: '2024-01-01T00:00:00Z',
    encrypted_data: await enc(pendingSendDataFixture),
    failure_reason: null,
    keyset_counter: null,
    keyset_id: null,
    requires_input_proofs_swap: false,
    state: 'PENDING',
    token_hash: 'abc123hash',
    transaction_id: 'tx1',
    version: 1,
    cashu_proofs: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CashuSendSwapRepository', () => {
  describe('get', () => {
    it('returns null when row is absent', async () => {
      const db = makeFakeDb({ selectResult: { data: null, error: null } });
      const result = await repo(db).get('missing-id');
      expect(result).toBeNull();
    });

    it('returns a DRAFT CashuSendSwap when row is present', async () => {
      const row = await makeDraftSwapRow();
      const db = makeFakeDb({ selectResult: { data: row, error: null } });
      const result = await repo(db).get('sw1');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('sw1');
      expect(result?.state).toBe('DRAFT');
    });

    it('throws a classified error on db failure', async () => {
      const db = makeFakeDb({
        selectResult: { data: null, error: { message: 'boom', code: 'XX000' } },
      });
      await expect(repo(db).get('sw1')).rejects.toThrow();
    });
  });

  describe('create', () => {
    it('throws ConcurrencyError on CONCURRENCY_ERROR hint', async () => {
      const db = makeFakeDb({
        rpcResult: {
          data: null,
          error: {
            hint: 'CONCURRENCY_ERROR',
            message: 'concurrency conflict',
            details: 'proof already reserved',
          },
        },
      });

      const createInput = {
        userId: 'u1',
        accountId: 'acc1',
        tokenMintUrl: 'https://mint.example.com',
        amountRequested: btc(1000),
        amountToSend: btc(1005),
        totalAmount: btc(1005),
        cashuSendFee: btc(0),
        cashuReceiveFee: btc(5),
        inputProofs: [
          {
            id: 'p1',
            accountId: 'acc1',
            userId: 'u1',
            keysetId: 'ks1',
            amount: 1005,
            secret: 's3cret',
            unblindedSignature: 'sig',
            publicKeyY: 'Y',
            dleq: undefined,
            witness: undefined,
            state: 'RESERVED' as const,
            version: 1,
            createdAt: '2024-01-01T00:00:00Z',
            reservedAt: '2024-01-01T00:00:00Z',
          },
        ],
        inputAmount: btc(1005),
      };

      let thrown: unknown;
      try {
        await repo(db).create(createInput);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(ConcurrencyError);
    });
  });

  describe('toSwap (via get) — full round-trip with encrypted proofs', () => {
    it('decrypts a PENDING swap with proofsToSend correctly', async () => {
      const encryptedAmount = await enc(500);
      const encryptedSecret = await enc('proof-secret-send');

      // For PENDING state with requires_input_proofs_swap=false:
      // The proof has cashu_send_swap_id='sw1' → encryptedInputProofs filter excludes it
      // (cashu_send_swap_id !== data.id → false), so encryptedInputProofs = [].
      // !requires_input_proofs_swap is true → encryptedProofsToSend includes it.
      const pendingRow = await makePendingSwapRow({
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
            created_at: '2024-01-01T00:00:00Z',
            reserved_at: '2024-01-01T00:00:00Z',
            spent_at: null,
            cashu_receive_quote_id: null,
            cashu_receive_swap_token_hash: null,
            cashu_send_quote_id: null,
            cashu_send_swap_id: 'sw1',
            spending_cashu_send_swap_id: null,
          },
        ],
      });

      const db = makeFakeDb({
        selectResult: { data: pendingRow, error: null },
      });

      const result = await repo(db).get('sw1');

      expect(result).not.toBeNull();
      expect(result?.state).toBe('PENDING');

      if (result?.state === 'PENDING') {
        expect(result.tokenHash).toBe('abc123hash');
        // encryptedInputProofs=[] (cashu_send_swap_id === data.id means it fails the
        // input filter), proofsToSend includes it because !requires_input_proofs_swap.
        expect(result.proofsToSend).toHaveLength(1);
        expect(result.proofsToSend[0]?.amount).toBe(500);
        expect(result.proofsToSend[0]?.secret).toBe('proof-secret-send');
      }
    });

    it('maps createdAt as a Date', async () => {
      const row = await makeDraftSwapRow();
      const db = makeFakeDb({ selectResult: { data: row, error: null } });
      const result = await repo(db).get('sw1');
      expect(result?.createdAt).toBeInstanceOf(Date);
      expect(result?.createdAt.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    it('maps state DRAFT with keyset fields', async () => {
      const row = await makeDraftSwapRow();
      const db = makeFakeDb({ selectResult: { data: row, error: null } });
      const result = await repo(db).get('sw1');
      expect(result?.state).toBe('DRAFT');
      if (result?.state === 'DRAFT') {
        expect(result.keysetId).toBe('ks1');
        expect(result.keysetCounter).toBe(1);
        expect(result.outputAmounts).toEqual({
          send: [1005],
          change: [19],
        });
      }
    });

    it('maps sendData fields correctly', async () => {
      const row = await makeDraftSwapRow();
      const db = makeFakeDb({ selectResult: { data: row, error: null } });
      const result = await repo(db).get('sw1');
      expect(result?.amountReceived.toString()).toBe(btc(1000).toString());
      expect(result?.amountToSend.toString()).toBe(btc(1005).toString());
      expect(result?.cashuReceiveFee.toString()).toBe(btc(5).toString());
      expect(result?.inputAmount.toString()).toBe(btc(1024).toString());
      expect(result?.transactionId).toBe('tx1');
    });
  });
});
