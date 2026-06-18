import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { makeFakeDb } from '../test-support';
import { SparkReceiveQuoteRepositoryServer } from './spark-receive-quote-repository.server';

const userEncryptionPublicKey = bytesToHex(
  secp256k1.getPublicKey(secp256k1.utils.randomPrivateKey(), true),
);
const sat = (n: number) =>
  new Money({ amount: n, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

const baseParams = {
  userId: 'user-1',
  accountId: 'acc-1',
  amount: sat(100),
  paymentRequest: 'lnbc1...',
  paymentHash: 'ph-1',
  expiresAt: '2026-06-18T00:00:00.000Z',
  sparkId: 'spark-rr-1',
  receiverIdentityPubkey: 'deadbeef',
  totalFee: sat(0),
  receiveType: 'LIGHTNING' as const,
  userEncryptionPublicKey,
};

describe('SparkReceiveQuoteRepositoryServer', () => {
  it('encrypts to the user pubkey, calls create_spark_receive_quote, returns minimal Created data', async () => {
    const calls: { rpc: Array<{ name: string; args: unknown }> } = { rpc: [] };
    const db = makeFakeDb({
      rpcResult: { data: { id: 'row-1', spark_id: 'spark-rr-1' }, error: null },
      calls,
    });
    const repo = new SparkReceiveQuoteRepositoryServer(db);

    const created = await repo.create(baseParams);

    expect(created).toEqual({
      id: 'row-1',
      receiveType: 'LIGHTNING',
      sparkId: 'spark-rr-1',
      paymentRequest: 'lnbc1...',
      paymentHash: 'ph-1',
      expiresAt: '2026-06-18T00:00:00.000Z',
      amount: baseParams.amount,
      totalFee: baseParams.totalFee,
      description: undefined,
    });
    const rpcCall = calls.rpc.find(
      (c) => c.name === 'create_spark_receive_quote',
    ) as { name: string; args: Record<string, unknown> } | undefined;
    expect(rpcCall).toBeDefined();
    if (!rpcCall)
      throw new Error('expected create_spark_receive_quote RPC call');
    expect(rpcCall.args).toMatchObject({
      p_user_id: 'user-1',
      p_account_id: 'acc-1',
      p_payment_hash: 'ph-1',
      p_spark_id: 'spark-rr-1',
      p_receiver_identity_pubkey: 'deadbeef',
      p_receive_type: 'LIGHTNING',
    });
    expect(typeof rpcCall?.args.p_encrypted_data).toBe('string');
    expect('p_purpose' in rpcCall.args).toBe(false);
    expect('p_transfer_id' in rpcCall.args).toBe(false);
  });

  it('routes RPC errors through classify', async () => {
    const db = makeFakeDb({
      rpcResult: { data: null, error: { message: 'boom', code: 'XX000' } },
    });
    const repo = new SparkReceiveQuoteRepositoryServer(db);
    await expect(repo.create(baseParams)).rejects.toBeDefined();
  });
});
