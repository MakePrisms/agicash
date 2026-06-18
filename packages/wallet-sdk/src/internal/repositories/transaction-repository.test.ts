import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { EncryptionService } from '../crypto/encryption';
import { CashuLightningReceiveDbDataSchema } from '../db/cashu-receive-quote-db-data';
import { makeFakeDb } from '../test-support';
import { TransactionRepository } from './transaction-repository';

const priv = secp256k1.utils.randomPrivateKey();
const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));
const encryption = new EncryptionService({
  getChildMnemonic: async () => 'm',
  getPrivateKeyBytes: async () => priv,
  getPublicKeyHex: async () => pubHex,
});
const enc = async (v: unknown) => (await encryption.get()).encrypt(v);
const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

const dbData = CashuLightningReceiveDbDataSchema.parse({
  paymentRequest: 'lnbc1',
  mintQuoteId: 'mq1',
  amountReceived: btc(2000),
  totalFee: btc(0),
});

async function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    user_id: 'u1',
    account_id: 'a1',
    account_name: 'Cashu',
    account_type: 'cashu',
    account_purpose: 'transactional',
    type: 'CASHU_LIGHTNING',
    direction: 'RECEIVE',
    state: 'COMPLETED',
    purpose: 'PAYMENT',
    acknowledgment_status: 'pending',
    created_at: '2024-01-01T00:00:00Z',
    pending_at: null,
    completed_at: '2024-01-01T00:05:00Z',
    failed_at: null,
    reversed_at: null,
    reversed_transaction_id: null,
    version: 1,
    transaction_details: { paymentHash: 'ph1' },
    encrypted_transaction_details: await enc(dbData),
    ...overrides,
  };
}

describe('TransactionRepository', () => {
  it('toTransaction decrypts + parses a row into a Transaction', async () => {
    const repo = new TransactionRepository(makeFakeDb({}), encryption);
    const tx = await repo.toTransaction((await row()) as never);
    expect(tx.id).toBe('t1');
    expect(tx.amount.toNumber('sat')).toBe(2000);
    expect(tx.acknowledgmentStatus).toBe('pending');
  });

  it('get returns null when the row is absent', async () => {
    const repo = new TransactionRepository(
      makeFakeDb({ selectResult: { data: null, error: null } }),
      encryption,
    );
    expect(await repo.get('missing')).toBeNull();
  });

  it('list computes nextCursor for a full page and nulls it for a short page', async () => {
    const rows = await Promise.all([row({ id: 't1' }), row({ id: 't2' })]);
    const full = new TransactionRepository(
      makeFakeDb({ rpcResult: { data: rows, error: null } }),
      encryption,
    );
    const fullPage = await full.list({ userId: 'u1', pageSize: 2 });
    expect(fullPage.transactions).toHaveLength(2);
    expect(fullPage.nextCursor).toEqual({
      stateSortOrder: 1, // COMPLETED → 1
      createdAt: '2024-01-01T00:00:00Z',
      id: 't2',
    });

    const short = new TransactionRepository(
      makeFakeDb({
        rpcResult: { data: [await row({ id: 't1' })], error: null },
      }),
      encryption,
    );
    const shortPage = await short.list({ userId: 'u1', pageSize: 2 });
    expect(shortPage.nextCursor).toBeNull();
  });

  it('list cursor uses stateSortOrder 2 when the last row is PENDING', async () => {
    const rows = await Promise.all([
      row({ id: 't1', state: 'COMPLETED' }),
      row({ id: 't2', state: 'PENDING' }),
    ]);
    const repo = new TransactionRepository(
      makeFakeDb({ rpcResult: { data: rows, error: null } }),
      encryption,
    );
    const page = await repo.list({ userId: 'u1', pageSize: 2 });
    expect(page.nextCursor?.stateSortOrder).toBe(2);
  });

  it('countPendingAck returns the count', async () => {
    const repo = new TransactionRepository(
      makeFakeDb({ selectResult: { count: 3, error: null } as never }),
      encryption,
    );
    expect(await repo.countPendingAck('u1')).toBe(3);
  });

  it('acknowledge re-reads the updated row (incremented version)', async () => {
    const updated = await row({
      acknowledgment_status: 'acknowledged',
      version: 2,
    });
    const repo = new TransactionRepository(
      makeFakeDb({ updateResult: { data: updated, error: null } }),
      encryption,
    );
    const tx = await repo.acknowledge({ userId: 'u1', transactionId: 't1' });
    expect(tx.acknowledgmentStatus).toBe('acknowledged');
    expect(tx.version).toBe(2);
  });
});
