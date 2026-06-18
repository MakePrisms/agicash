import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { makeFakeDb } from '../test-support';
import { CashuReceiveQuoteRepositoryServer } from './cashu-receive-quote-repository.server';

const userEncryptionPublicKey = bytesToHex(
  secp256k1.getPublicKey(secp256k1.utils.randomPrivateKey(), true),
);
const sat = (n: number) =>
  new Money({ amount: n, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

const baseParams = {
  userId: 'user-1',
  accountId: 'acc-1',
  amount: sat(100),
  quoteId: 'mint-quote-1',
  paymentRequest: 'lnbc1...',
  paymentHash: 'ph-1',
  expiresAt: '2026-06-18T00:00:00.000Z',
  lockingDerivationPath: "m/129372'/0'/0/7",
  receiveType: 'LIGHTNING' as const,
  totalFee: sat(0),
  userEncryptionPublicKey,
};

describe('CashuReceiveQuoteRepositoryServer', () => {
  it('encrypts to the user pubkey, hashes the quoteId, calls create_cashu_receive_quote', async () => {
    const calls: { rpc: Array<{ name: string; args: unknown }> } = { rpc: [] };
    const db = makeFakeDb({
      rpcResult: { data: { id: 'row-1' }, error: null },
      calls,
    });
    const repo = new CashuReceiveQuoteRepositoryServer(db);

    const created = await repo.create(baseParams);

    expect(created).toMatchObject({
      id: 'row-1',
      quoteId: 'mint-quote-1',
      paymentRequest: 'lnbc1...',
      paymentHash: 'ph-1',
      type: 'LIGHTNING',
    });
    const rpcCall = calls.rpc.find(
      (c) => c.name === 'create_cashu_receive_quote',
    ) as { name: string; args: Record<string, unknown> } | undefined;
    expect(rpcCall).toBeDefined();
    if (!rpcCall)
      throw new Error('expected create_cashu_receive_quote RPC call');
    expect(rpcCall.args).toMatchObject({
      p_user_id: 'user-1',
      p_account_id: 'acc-1',
      p_locking_derivation_path: "m/129372'/0'/0/7",
      p_receive_type: 'LIGHTNING',
      p_payment_hash: 'ph-1',
    });
    expect(typeof rpcCall?.args.p_encrypted_data).toBe('string');
    expect((rpcCall?.args.p_encrypted_data as string).length).toBeGreaterThan(
      0,
    );
    expect(typeof rpcCall?.args.p_quote_id_hash).toBe('string');
    expect('p_purpose' in rpcCall.args).toBe(false);
  });

  it('routes RPC errors through classify', async () => {
    const db = makeFakeDb({
      rpcResult: { data: null, error: { message: 'boom', code: 'XX000' } },
    });
    const repo = new CashuReceiveQuoteRepositoryServer(db);
    await expect(repo.create(baseParams)).rejects.toBeInstanceOf(Error);
  });
});
