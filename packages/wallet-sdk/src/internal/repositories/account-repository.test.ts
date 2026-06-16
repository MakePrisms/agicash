import { describe, expect, it } from 'bun:test';
import { makeFakeDb } from '../test-support';
import { AccountRepository } from './account-repository';
import { EncryptionService } from '../crypto/encryption';
import { MintAuthTokenProvider } from '../connections/mint-auth';
import { CashuWalletService } from '../connections/cashu-wallet';
import { SparkWalletService } from '../connections/spark-wallet';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

const priv = secp256k1.utils.randomPrivateKey();
const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));
const encryption = new EncryptionService({
  getChildMnemonic: async () => 'm',
  getPrivateKeyBytes: async () => priv,
  getPublicKeyHex: async () => pubHex,
});

// Build encrypted amount/secret so decryptCashuProofs round-trips.
async function enc(value: unknown) {
  return (await encryption.get()).encrypt(value);
}

const cashuWallets = new CashuWalletService(async () => {
  throw new (await import('@cashu/cashu-ts')).NetworkError('offline');
}); // → isOnline:false, real ExtendedCashuWallet stub-of-sorts
const sparkWallets = new SparkWalletService(async () => {
  throw new Error('offline');
}); // → offline stub
const mintAuth = new MintAuthTokenProvider(
  async () => 'tok',
  async () => false,
);

function repo(db: ReturnType<typeof makeFakeDb>) {
  return new AccountRepository(
    db,
    encryption,
    cashuWallets,
    sparkWallets,
    mintAuth,
    async () => new Uint8Array(64),
  );
}

describe('AccountRepository.toAccount', () => {
  it('maps a spark row → spark Account (offline stub when connect fails)', async () => {
    const row = {
      id: 'a1',
      name: 'Bitcoin',
      type: 'spark',
      currency: 'BTC',
      purpose: 'transactional',
      state: 'active',
      created_at: 't',
      version: 1,
      expires_at: null,
      details: { network: 'MAINNET' },
      cashu_proofs: [],
    } as never;
    const account = await repo(makeFakeDb({})).toAccount(row);
    expect(account.type).toBe('spark');
    expect(account.isOnline).toBe(false);
    if (account.type === 'spark') expect(account.network).toBe('MAINNET');
  });

  it('maps a cashu row → cashu Account, decrypting proofs', async () => {
    const row = {
      id: 'c1',
      name: 'USD',
      type: 'cashu',
      currency: 'USD',
      purpose: 'transactional',
      state: 'active',
      created_at: 't',
      version: 1,
      expires_at: null,
      details: {
        mint_url: 'https://mint.test',
        is_test_mint: false,
        keyset_counters: {},
      },
      cashu_proofs: [
        {
          id: 'p1',
          account_id: 'c1',
          user_id: 'u1',
          keyset_id: 'ks1',
          amount: await enc(21),
          secret: await enc('s3cret'),
          unblinded_signature: 'sig',
          public_key_y: 'Y',
          dleq: null,
          witness: null,
          state: 'UNSPENT',
          version: 1,
          created_at: 't',
          reserved_at: null,
        },
      ],
    } as never;
    const account = await repo(makeFakeDb({})).toAccount(row);
    expect(account.type).toBe('cashu');
    if (account.type === 'cashu') {
      expect(account.isOnline).toBe(false); // mint offline in this test
      expect(account.proofs[0]?.amount).toBe(21);
      expect(account.proofs[0]?.secret).toBe('s3cret');
    }
  });
});
