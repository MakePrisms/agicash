import { NetworkError } from '@cashu/cashu-ts';
import { describe, expect, test } from 'bun:test';
import { getAccountBalance } from './account-balance';
import {
  type EncryptedCashuProofRow,
  LiveAccountHandleResolver,
} from './account-handle-resolver';
import { MintMetadataCache } from './cashu-wallet';
import { dbAccountToAccount } from './db-account';
import type { Encryption } from './encryption';
import { type BreezRuntime, SparkWalletCache } from './spark-wallet';
import type { AgicashDbAccountWithProofs } from './db-account';

const MINT_URL = 'https://mint.example.com';
const MNEMONIC = 'test test test test test test test test test test test junk';

// -- Fakes ----------------------------------------------------------------------------------

/** A fake {@link Encryption} that returns the queued plaintext in order (no real crypto). */
function fakeEncryption(plaintexts: unknown[]): Encryption {
  return {
    decryptBatch: async (data: readonly string[]) =>
      plaintexts.slice(0, data.length) as never,
    // The resolver only decrypts; the encrypt/decrypt-single halves are unused here.
    decrypt: async () => undefined as never,
    encrypt: async () => '',
    encryptBatch: async (data: readonly unknown[]) => data.map(() => ''),
  };
}

/** Online fake Mint factory (one active 'sat' keyset). */
function onlineMintCache(): MintMetadataCache {
  return new MintMetadataCache(
    () => 1000,
    (_url) =>
      ({
        getInfo: async () => ({ name: 'T', version: 'x', nuts: {} }),
        getKeySets: async () => ({
          keysets: [
            { id: '00abcd', unit: 'sat', active: true, input_fee_ppk: 0 },
          ],
        }),
        getKeys: async () => ({
          keysets: [
            {
              id: '00abcd',
              unit: 'sat',
              keys: { '1': `02${'a'.repeat(64)}`, '2': `02${'b'.repeat(64)}` },
            },
          ],
        }),
      }) as never,
  );
}

/** Offline fake Mint factory (every call throws NetworkError). */
function offlineMintCache(): MintMetadataCache {
  return new MintMetadataCache(
    () => 1000,
    (_url) => {
      const t = () => {
        throw new NetworkError('offline');
      };
      return { getInfo: t, getKeySets: t, getKeys: t } as never;
    },
  );
}

/** Mock Breez runtime: connect → wallet with a fixed balance. */
function mockBreezRuntime(balanceSats = 4242): BreezRuntime {
  return {
    defaultConfig: () => ({}) as never,
    initLogging: async () => {
      /* no-op logger */
    },
    connect: async () => ({ getInfo: async () => ({ balanceSats }) }) as never,
  } as unknown as BreezRuntime;
}

function encryptedProofRow(
  over: Partial<EncryptedCashuProofRow> = {},
): EncryptedCashuProofRow {
  return {
    id: 'p1',
    accountId: 'acct-cashu',
    userId: 'user-1',
    keysetId: '00abcd',
    amount: 'ENC(amount)',
    secret: 'ENC(secret)',
    unblindedSignature: 'C-value',
    publicKeyY: 'Y-value',
    dleq: undefined,
    witness: undefined,
    state: 'UNSPENT',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    reservedAt: null,
    spentAt: null,
    ...over,
  };
}

function baseDeps() {
  return {
    getCashuWalletSeed: async () => undefined,
    getSparkWalletMnemonic: async () => MNEMONIC,
    sparkStorageDir: '/tmp/spark-test',
    breezRuntime: mockBreezRuntime(),
  };
}

// -- resolveCashu ---------------------------------------------------------------------------

describe('LiveAccountHandleResolver.resolveCashu', () => {
  test('decrypts proofs (amount→number, secret→string) + builds an online wallet', async () => {
    const resolver = new LiveAccountHandleResolver({
      ...baseDeps(),
      // Two proofs → 4 ciphertexts interleaved [amount,secret,amount,secret].
      encryption: fakeEncryption([21, 'secret-a', 9, 'secret-b']),
      mintCache: onlineMintCache(),
      sparkCache: new SparkWalletCache(),
      breezApiKey: 'k',
    });

    const { wallet, isOnline, proofs } = await resolver.resolveCashu({
      mintUrl: MINT_URL,
      currency: 'BTC',
      encryptedProofs: [
        encryptedProofRow({ id: 'p1' }),
        encryptedProofRow({ id: 'p2' }),
      ],
    });

    expect(isOnline).toBe(true);
    expect(wallet.unit).toBe('sat');
    expect(proofs).toHaveLength(2);
    expect(proofs[0]).toMatchObject({
      id: 'p1',
      amount: 21,
      secret: 'secret-a',
    });
    expect(proofs[1]).toMatchObject({
      id: 'p2',
      amount: 9,
      secret: 'secret-b',
    });
    // dleq/witness re-parsed via cashu-ts ProofSchema (undefined stays undefined).
    expect(proofs[0].dleq).toBeUndefined();
  });

  test('parses a real dleq via ProofSchema', async () => {
    const resolver = new LiveAccountHandleResolver({
      ...baseDeps(),
      encryption: fakeEncryption([1, 'sec']),
      mintCache: onlineMintCache(),
      sparkCache: new SparkWalletCache(),
      breezApiKey: 'k',
    });

    const { proofs } = await resolver.resolveCashu({
      mintUrl: MINT_URL,
      currency: 'BTC',
      encryptedProofs: [
        encryptedProofRow({ dleq: { s: '01', e: '02' } as never }),
      ],
    });

    expect(proofs[0].dleq).toEqual({ s: '01', e: '02' } as never);
  });

  test('no proofs → empty array (no decrypt call)', async () => {
    let called = false;
    const resolver = new LiveAccountHandleResolver({
      ...baseDeps(),
      encryption: {
        decryptBatch: async () => {
          called = true;
          return [] as never;
        },
        decrypt: async () => undefined as never,
        encrypt: async () => '',
        encryptBatch: async () => [],
      },
      mintCache: onlineMintCache(),
      sparkCache: new SparkWalletCache(),
      breezApiKey: 'k',
    });

    const { proofs } = await resolver.resolveCashu({
      mintUrl: MINT_URL,
      currency: 'BTC',
      encryptedProofs: [],
    });

    expect(proofs).toEqual([]);
    expect(called).toBe(false);
  });

  test('offline mint → isOnline false but proofs still decrypt', async () => {
    const resolver = new LiveAccountHandleResolver({
      ...baseDeps(),
      encryption: fakeEncryption([100, 'sec']),
      mintCache: offlineMintCache(),
      sparkCache: new SparkWalletCache(),
      breezApiKey: 'k',
    });

    const { isOnline, proofs } = await resolver.resolveCashu({
      mintUrl: MINT_URL,
      currency: 'BTC',
      encryptedProofs: [encryptedProofRow()],
    });

    expect(isOnline).toBe(false);
    expect(proofs[0].amount).toBe(100);
  });
});

// -- resolveSpark ---------------------------------------------------------------------------

describe('LiveAccountHandleResolver.resolveSpark', () => {
  test('with a breezApiKey: connects + returns balance + online', async () => {
    const resolver = new LiveAccountHandleResolver({
      ...baseDeps(),
      encryption: fakeEncryption([]),
      mintCache: onlineMintCache(),
      sparkCache: new SparkWalletCache(),
      breezApiKey: 'k',
      breezRuntime: mockBreezRuntime(7777),
    });

    const { isOnline, balance } = await resolver.resolveSpark({
      network: 'MAINNET',
    });

    expect(isOnline).toBe(true);
    expect(balance?.toNumber('sat')).toBe(7777);
  });

  test('without a breezApiKey: offline stub + null balance (cashu-only mode)', async () => {
    const resolver = new LiveAccountHandleResolver({
      ...baseDeps(),
      encryption: fakeEncryption([]),
      mintCache: onlineMintCache(),
      sparkCache: new SparkWalletCache(),
      breezApiKey: undefined,
    });

    const { wallet, isOnline, balance } = await resolver.resolveSpark({
      network: 'MAINNET',
    });

    expect(isOnline).toBe(false);
    expect(balance).toBeNull();
    // The stub throws on use, identifying the missing key.
    expect(() =>
      (wallet as unknown as { getInfo: () => unknown }).getInfo(),
    ).toThrow('no breezApiKey');
  });
});

// -- getBalance over the real (decrypted) proofs --------------------------------------------

describe('getAccountBalance with real decrypted proofs', () => {
  test('a cashu account balance = sum(decrypted proof amounts)', async () => {
    const resolver = new LiveAccountHandleResolver({
      ...baseDeps(),
      encryption: fakeEncryption([21, 'sa', 9, 'sb', 12, 'sc']),
      mintCache: onlineMintCache(),
      sparkCache: new SparkWalletCache(),
      breezApiKey: 'k',
    });

    const row: AgicashDbAccountWithProofs = {
      id: 'acct-cashu',
      name: 'Mint',
      type: 'cashu',
      purpose: 'transactional',
      state: 'active',
      currency: 'BTC',
      details: {
        mint_url: MINT_URL,
        is_test_mint: false,
        keyset_counters: {},
      },
      created_at: '2026-01-01T00:00:00.000Z',
      expires_at: null,
      user_id: 'user-1',
      version: 1,
      cashu_proofs: [
        {
          id: 'p1',
          account_id: 'acct-cashu',
          user_id: 'user-1',
          keyset_id: '00abcd',
          amount: 'ENC',
          secret: 'ENC',
          unblinded_signature: 'C',
          public_key_y: 'Y',
          dleq: null,
          witness: null,
          state: 'UNSPENT',
          version: 1,
          created_at: '2026-01-01T00:00:00.000Z',
          reserved_at: null,
        },
        {
          id: 'p2',
          account_id: 'acct-cashu',
          user_id: 'user-1',
          keyset_id: '00abcd',
          amount: 'ENC',
          secret: 'ENC',
          unblinded_signature: 'C',
          public_key_y: 'Y',
          dleq: null,
          witness: null,
          state: 'UNSPENT',
          version: 1,
          created_at: '2026-01-01T00:00:00.000Z',
          reserved_at: null,
        },
        {
          id: 'p3',
          account_id: 'acct-cashu',
          user_id: 'user-1',
          keyset_id: '00abcd',
          amount: 'ENC',
          secret: 'ENC',
          unblinded_signature: 'C',
          public_key_y: 'Y',
          dleq: null,
          witness: null,
          state: 'UNSPENT',
          version: 1,
          created_at: '2026-01-01T00:00:00.000Z',
          reserved_at: null,
        },
      ],
    };

    const account = await dbAccountToAccount(row, resolver);
    const balance = getAccountBalance(account);

    // 21 + 9 + 12 = 42 sats.
    expect(balance?.toNumber('sat')).toBe(42);
    expect(account.type).toBe('cashu');
    if (account.type === 'cashu') {
      expect(account.proofs).toHaveLength(3);
    }
  });
});
