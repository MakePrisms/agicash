import { describe, expect, it, spyOn } from 'bun:test';
import type { LNURLError, LNURLPayResult } from '@agicash/lnurl';
import { Money } from '@agicash/money';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import type { AgicashDb } from '../../db/database';
import type { RedactedAccount } from '../accounts/account';
import type { User } from '../user/user';
import {
  type LightningAddressDeps,
  LightningAddressService,
  type LightningAddressServiceConfig,
} from './lightning-address-service';

type GetCashuLightningQuote = NonNullable<
  LightningAddressDeps['getCashuLightningQuote']
>;
type CashuLightningQuote = Awaited<ReturnType<GetCashuLightningQuote>>;
type CashuCreateParams = Parameters<
  NonNullable<LightningAddressDeps['createCashuReceiveQuote']>
>[0];
type GetSparkLightningQuote = NonNullable<
  LightningAddressDeps['getSparkLightningQuote']
>;
type SparkLightningQuote = Awaited<ReturnType<GetSparkLightningQuote>>;
type SparkCreateParams = Parameters<
  NonNullable<LightningAddressDeps['createSparkReceiveQuote']>
>[0];
type GetCashuWallet = NonNullable<LightningAddressDeps['getCashuWallet']>;
type GetSparkWallet = NonNullable<LightningAddressDeps['getSparkWallet']>;
type SparkWalletArgs = Parameters<GetSparkWallet>[0];
type CreateDefaultAccountRepository = NonNullable<
  LightningAddressDeps['createDefaultAccountRepository']
>;

const FIXTURE_KEY =
  '1111111111111111111111111111111111111111111111111111111111111111';
const SPARK_FIXTURE_BLOB =
  'eFJ9LwX3hcc3SIpRzfnItaAQ1CwHgFG83EWC3YEpt0rgxTUquRBqhl2pqf8UvmfV9fpXMWcsUMNh8G_dby5XmKUep27-jNxrY7x5S3LaJ-E=';
const CASHU_FIXTURE_BLOB =
  '9lhIjEaNYq99oEC_CCyx8bXuI8tWxVR2KSTt7X_ZgFByMdbkjDY8RVKYdliK9r_riz0BH8IU6SUiZi5TodfChS86A0Q_1yX3OH0cqLSgdQ4ElCmgo3y4fwTxg9gLc0oFdvb0as7IweVaXnkgOWlenen6';
const RANGE_REASON = `Amount out of range. Min: 1 sats, Max: ${(1_000_000).toLocaleString()} sats.`;

const db = {} as AgicashDb;

const config: LightningAddressServiceConfig = {
  db,
  spark: {
    apiKey: 'test-api-key',
    network: 'REGTEST',
    mnemonic: 'mnemonic-from-config',
    storageDir: '/tmp/test-spark',
  },
  quoteEncryptionKey: FIXTURE_KEY,
};

const walletMarker = {};

const alice = {
  id: 'user-1',
  username: 'alice',
  encryptionPublicKey: 'enc-pub-alice',
  cashuLockingXpub: 'xpub-alice',
  sparkIdentityPublicKey: 'spark-id-alice',
} as User;

const bob = {
  id: 'user-2',
  username: 'bob',
  encryptionPublicKey: 'enc-pub-bob',
  cashuLockingXpub: 'xpub-bob',
  sparkIdentityPublicKey: 'spark-id-bob',
} as User;

const cashuAccount = {
  type: 'cashu',
  currency: 'BTC',
  id: 'acct-1',
  mintUrl: 'https://mint.example',
  wallet: walletMarker,
} as RedactedAccount;

const sparkAccount = {
  type: 'spark',
  currency: 'BTC',
  id: 'acct-s',
  wallet: walletMarker,
} as RedactedAccount;

const msat = (amount: number) =>
  new Money({ amount, currency: 'BTC', unit: 'msat' });

const spyConsoleError = () =>
  spyOn(console, 'error').mockImplementation(() => undefined);

const userRepositoryReturning = (user: User) => ({
  get: async (_userId: string): Promise<User> => user,
  getByUsername: async (_username: string): Promise<User | null> => user,
});

const defaultAccountRepositoryReturning =
  (account: RedactedAccount): CreateDefaultAccountRepository =>
  () => ({
    getDefaultAccount: async (_userId: string) => account,
  });

const verifySegment = (result: LNURLPayResult | LNURLError): string => {
  const verify = (result as LNURLPayResult).verify ?? '';
  return verify.split('/api/lnurlp/verify/')[1] ?? '';
};

const createSparkWalletSeam = (
  respond: (params: { requestId: string }) => Promise<unknown>,
) => {
  const walletArgs: SparkWalletArgs[] = [];
  const requests: { requestId: string }[] = [];
  const getSparkWallet = (async (args: SparkWalletArgs) => {
    walletArgs.push(args);
    return {
      getLightningReceiveRequest: async (params: { requestId: string }) => {
        requests.push(params);
        return respond(params);
      },
    };
  }) as unknown as GetSparkWallet;
  return { getSparkWallet, walletArgs, requests };
};

const createCashuWalletSeam = (mintQuote: {
  state: string;
  request: string;
}) => {
  const mintUrls: string[] = [];
  const quoteIds: string[] = [];
  const getCashuWallet = ((mintUrl: string) => {
    mintUrls.push(mintUrl);
    return {
      checkMintQuoteBolt11: async (quoteId: string) => {
        quoteIds.push(quoteId);
        return mintQuote;
      },
    };
  }) as unknown as GetCashuWallet;
  return { getCashuWallet, mintUrls, quoteIds };
};

const createCashuCallbackSetup = () => {
  const quoteArgs: Parameters<GetCashuLightningQuote>[0][] = [];
  const createArgs: CashuCreateParams[] = [];
  const defaultAccountCalls: unknown[][] = [];
  const rateTickers: string[] = [];
  const sparkCalls: string[] = [];
  const lightningQuote = {
    mintQuote: { quote: 'mint-quote-1', request: 'lnbc1cashu' },
  } as unknown as CashuLightningQuote;
  const cashuWallet = createCashuWalletSeam({
    state: 'UNPAID',
    request: 'lnbc1cashu',
  });
  const sparkWallet = createSparkWalletSeam(async () => null);
  const service = new LightningAddressService(config, {
    userRepository: userRepositoryReturning(alice),
    exchangeRateService: {
      getRate: async (ticker: string) => {
        rateTickers.push(ticker);
        return '1';
      },
    },
    createDefaultAccountRepository: () => ({
      getDefaultAccount: async (...args: unknown[]) => {
        defaultAccountCalls.push(args);
        return cashuAccount;
      },
    }),
    getCashuLightningQuote: async (
      params: Parameters<GetCashuLightningQuote>[0],
    ) => {
      quoteArgs.push(params);
      return lightningQuote;
    },
    createCashuReceiveQuote: async (params: CashuCreateParams) => {
      createArgs.push(params);
    },
    getSparkLightningQuote: async () => {
      sparkCalls.push('getSparkLightningQuote');
      throw new Error('spark quote seam must not run');
    },
    createSparkReceiveQuote: async () => {
      sparkCalls.push('createSparkReceiveQuote');
    },
    getCashuWallet: cashuWallet.getCashuWallet,
    getSparkWallet: sparkWallet.getSparkWallet,
  });
  return {
    service,
    quoteArgs,
    createArgs,
    defaultAccountCalls,
    rateTickers,
    sparkCalls,
    lightningQuote,
    cashuWallet,
    sparkWallet,
  };
};

describe('LightningAddressService', () => {
  it('(s) module import does not read LNURL env, and the constructor does not throw', () => {
    expect(process.env.LNURL_SERVER_SPARK_MNEMONIC).toBeUndefined();
    expect(process.env.LNURL_SERVER_ENCRYPTION_KEY).toBeUndefined();
    expect(() => new LightningAddressService(config)).not.toThrow();
  });

  describe('handleLud16Request', () => {
    it('(a) returns pay params with a per-call baseUrl and no shared state', async () => {
      const sparkWallet = createSparkWalletSeam(async () => null);
      const service = new LightningAddressService(config, {
        userRepository: {
          get: async (_userId: string): Promise<User> => {
            throw new Error('get must not run');
          },
          getByUsername: async (username: string) =>
            username === 'alice' ? alice : username === 'bob' ? bob : null,
        },
        getSparkWallet: sparkWallet.getSparkWallet,
      });

      const [aliceResult, bobResult] = await Promise.all([
        service.handleLud16Request({
          username: 'alice',
          baseUrl: 'https://a.example',
        }),
        service.handleLud16Request({
          username: 'bob',
          baseUrl: 'https://b.example',
        }),
      ]);

      expect(aliceResult).toEqual({
        callback: 'https://a.example/api/lnurlp/callback/user-1',
        maxSendable: 1000000000,
        minSendable: 1000,
        metadata:
          '[["text/plain","Pay to alice@a.example"],["text/identifier","alice@a.example"]]',
        tag: 'payRequest',
      });
      expect(Object.keys(aliceResult)).toEqual([
        'callback',
        'maxSendable',
        'minSendable',
        'metadata',
        'tag',
      ]);
      expect(bobResult).toEqual({
        callback: 'https://b.example/api/lnurlp/callback/user-2',
        maxSendable: 1000000000,
        minSendable: 1000,
        metadata:
          '[["text/plain","Pay to bob@b.example"],["text/identifier","bob@b.example"]]',
        tag: 'payRequest',
      });
      expect(aliceResult).not.toHaveProperty('status');
      expect(bobResult).not.toHaveProperty('status');
      expect(sparkWallet.walletArgs).toHaveLength(0);
    });

    it('(b) returns the lowercase not-found envelope when no user has the username', async () => {
      const service = new LightningAddressService(config, {
        userRepository: {
          get: async (_userId: string): Promise<User> => alice,
          getByUsername: async (_username: string) => null,
        },
      });

      const result = await service.handleLud16Request({
        username: 'nobody',
        baseUrl: 'https://pay.example',
      });

      expect(result).toEqual({ status: 'ERROR', reason: 'not found' });
      expect(Object.keys(result)).toEqual(['status', 'reason']);
    });

    it('(c) logs and returns the internal-error envelope when the lookup throws', async () => {
      const error = new Error('db down');
      const service = new LightningAddressService(config, {
        userRepository: {
          get: async (_userId: string): Promise<User> => alice,
          getByUsername: async (_username: string): Promise<User | null> => {
            throw error;
          },
        },
      });
      const errorSpy = spyConsoleError();
      try {
        const result = await service.handleLud16Request({
          username: 'alice',
          baseUrl: 'https://pay.example',
        });

        expect(result).toEqual({
          status: 'ERROR',
          reason: 'Internal server error',
        });
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const [message, details] = errorSpy.mock.calls[0] ?? [];
        expect(message).toBe('Error processing LNURL-pay request');
        expect((details as { cause: unknown }).cause).toBe(error);
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('handleLnurlpCallback', () => {
    const createLookupRecorder = () => {
      const lookups: string[] = [];
      const service = new LightningAddressService(config, {
        userRepository: {
          get: async (userId: string): Promise<User> => {
            lookups.push(`get:${userId}`);
            throw new Error('no rows');
          },
          getByUsername: async (username: string): Promise<User | null> => {
            lookups.push(`getByUsername:${username}`);
            return null;
          },
        },
      });
      return { service, lookups };
    };

    it('(d) rejects an amount below the minimum without a user lookup', async () => {
      const { service, lookups } = createLookupRecorder();

      const result = await service.handleLnurlpCallback({
        userId: 'user-1',
        amount: new Money({ amount: 999, currency: 'BTC', unit: 'msat' }),
        baseUrl: 'https://pay.example',
      });

      expect(result).toEqual({ status: 'ERROR', reason: RANGE_REASON });
      expect(lookups).toHaveLength(0);
    });

    it('(e) rejects an amount above the maximum without a user lookup', async () => {
      const { service, lookups } = createLookupRecorder();

      const result = await service.handleLnurlpCallback({
        userId: 'user-1',
        amount: msat(1_000_000_001),
        baseUrl: 'https://pay.example',
      });

      expect(result).toEqual({ status: 'ERROR', reason: RANGE_REASON });
      expect(lookups).toHaveLength(0);
    });

    it('(f) treats both bounds as inside the range', async () => {
      const { service, lookups } = createLookupRecorder();
      const errorSpy = spyConsoleError();
      try {
        const atMin = await service.handleLnurlpCallback({
          userId: 'user-min',
          amount: msat(1000),
          baseUrl: 'https://pay.example',
        });
        expect(atMin).toEqual({
          status: 'ERROR',
          reason: 'Internal server error',
        });
        expect(lookups).toEqual(['get:user-min']);

        const atMax = await service.handleLnurlpCallback({
          userId: 'user-max',
          amount: msat(1_000_000_000),
          baseUrl: 'https://pay.example',
        });
        expect(atMax).toEqual({
          status: 'ERROR',
          reason: 'Internal server error',
        });
        expect(lookups).toEqual(['get:user-min', 'get:user-max']);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('(h) logs and returns the internal-error envelope when the user lookup throws', async () => {
      const { service } = createLookupRecorder();
      const errorSpy = spyConsoleError();
      try {
        const result = await service.handleLnurlpCallback({
          userId: 'missing-user',
          amount: msat(10_000),
          baseUrl: 'https://pay.example',
        });

        expect(result).toEqual({
          status: 'ERROR',
          reason: 'Internal server error',
        });
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0]?.[0]).toBe(
          'Error processing LNURL-pay callback',
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('(i) applies bypassAmountValidation per call', async () => {
      const calls = new Map<string, unknown[]>();
      const service = new LightningAddressService(config, {
        userRepository: userRepositoryReturning(alice),
        createDefaultAccountRepository: () => ({
          getDefaultAccount: async (...args: unknown[]) => {
            calls.set(args[0] as string, args);
            throw new Error('stop before quote creation');
          },
        }),
      });
      const errorSpy = spyConsoleError();
      try {
        await Promise.all([
          service.handleLnurlpCallback({
            userId: 'u-bypass',
            amount: msat(10_000),
            baseUrl: 'https://pay.example',
            bypassAmountValidation: true,
          }),
          service.handleLnurlpCallback({
            userId: 'u-strict',
            amount: msat(10_000),
            baseUrl: 'https://pay.example',
            bypassAmountValidation: false,
          }),
        ]);
        await service.handleLnurlpCallback({
          userId: 'u-omitted',
          amount: msat(10_000),
          baseUrl: 'https://pay.example',
        });

        const bypass = calls.get('u-bypass');
        const strict = calls.get('u-strict');
        const omitted = calls.get('u-omitted');
        expect(bypass).toHaveLength(2);
        expect(strict).toHaveLength(2);
        expect(omitted).toHaveLength(2);
        expect(bypass?.[1]).toBeUndefined();
        expect(strict?.[1]).toBe('BTC');
        expect(omitted?.[1]).toBe('BTC');
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('(j) creates a cashu receive quote without touching a mint', async () => {
      const setup = createCashuCallbackSetup();
      const amount = msat(1000);

      const result = await setup.service.handleLnurlpCallback({
        userId: 'user-1',
        amount,
        baseUrl: 'https://pay.example',
      });

      expect(setup.quoteArgs).toHaveLength(1);
      const quoteArg = setup.quoteArgs[0];
      expect(quoteArg?.wallet).toBe(walletMarker as never);
      expect(quoteArg?.amount).toBe(amount as Money);
      expect(quoteArg?.xPub).toBe(alice.cashuLockingXpub);
      expect(Object.keys(quoteArg ?? {}).sort()).toEqual([
        'amount',
        'wallet',
        'xPub',
      ]);

      expect(setup.createArgs).toHaveLength(1);
      const createArg = setup.createArgs[0];
      expect(createArg?.userId).toBe('user-1');
      expect(createArg?.userEncryptionPublicKey).toBe(
        alice.encryptionPublicKey,
      );
      expect(createArg?.account).toBe(cashuAccount as never);
      expect(createArg?.receiveType).toBe('LIGHTNING');
      expect(createArg?.lightningQuote).toBe(setup.lightningQuote);
      expect(Object.keys(createArg ?? {}).sort()).toEqual([
        'account',
        'lightningQuote',
        'receiveType',
        'userEncryptionPublicKey',
        'userId',
      ]);

      const payResult = result as LNURLPayResult;
      expect(payResult.pr).toBe('lnbc1cashu');
      expect(payResult.routes).toEqual([]);
      expect(Object.keys(result)).toEqual(['pr', 'verify', 'routes']);
      expect(result).not.toHaveProperty('status');
      expect(
        payResult.verify?.startsWith('https://pay.example/api/lnurlp/verify/'),
      ).toBe(true);

      expect(setup.rateTickers).toHaveLength(0);
      expect(setup.sparkCalls).toHaveLength(0);
      expect(setup.sparkWallet.walletArgs).toHaveLength(0);
      expect(setup.defaultAccountCalls).toHaveLength(1);
      expect(setup.defaultAccountCalls[0]?.[1]).toBe('BTC');
    });

    it('(k) creates a spark receive quote with the metadata description hash', async () => {
      const quoteArgs: Parameters<GetSparkLightningQuote>[0][] = [];
      const createArgs: SparkCreateParams[] = [];
      const cashuCalls: string[] = [];
      const lightningQuote = {
        id: 'srv-quote-9',
        invoice: { paymentRequest: 'lnbc1spark' },
      } as unknown as SparkLightningQuote;
      const sparkWallet = createSparkWalletSeam(async () => null);
      const service = new LightningAddressService(config, {
        userRepository: userRepositoryReturning(alice),
        createDefaultAccountRepository:
          defaultAccountRepositoryReturning(sparkAccount),
        getCashuLightningQuote: async () => {
          cashuCalls.push('getCashuLightningQuote');
          throw new Error('cashu quote seam must not run');
        },
        createCashuReceiveQuote: async () => {
          cashuCalls.push('createCashuReceiveQuote');
        },
        getSparkLightningQuote: async (
          params: Parameters<GetSparkLightningQuote>[0],
        ) => {
          quoteArgs.push(params);
          return lightningQuote;
        },
        createSparkReceiveQuote: async (params: SparkCreateParams) => {
          createArgs.push(params);
        },
        getCashuWallet: ((_mintUrl: string) => {
          cashuCalls.push('getCashuWallet');
          throw new Error('cashu wallet seam must not run');
        }) as unknown as GetCashuWallet,
        getSparkWallet: sparkWallet.getSparkWallet,
      });

      const result = await service.handleLnurlpCallback({
        userId: 'user-1',
        amount: msat(1000),
        baseUrl: 'https://pay.example',
      });

      const metadata =
        '[["text/plain","Pay to alice@pay.example"],["text/identifier","alice@pay.example"]]';
      expect(quoteArgs).toHaveLength(1);
      const quoteArg = quoteArgs[0];
      expect(quoteArg?.descriptionHash).toBe(
        bytesToHex(sha256(new TextEncoder().encode(metadata))),
      );
      expect(Object.keys(quoteArg ?? {}).sort()).toEqual([
        'amount',
        'descriptionHash',
        'receiverIdentityPublicKey',
        'wallet',
      ]);
      expect(quoteArg?.wallet).toBe(walletMarker as never);
      expect(quoteArg?.receiverIdentityPublicKey).toBe(
        alice.sparkIdentityPublicKey,
      );

      expect(createArgs).toHaveLength(1);
      const createArg = createArgs[0];
      expect(createArg?.receiveType).toBe('LIGHTNING');
      expect(createArg?.lightningQuote).toBe(lightningQuote);
      expect(Object.keys(createArg ?? {}).sort()).toEqual([
        'account',
        'lightningQuote',
        'receiveType',
        'userEncryptionPublicKey',
        'userId',
      ]);

      const payResult = result as LNURLPayResult;
      expect(payResult.pr).toBe('lnbc1spark');
      expect(payResult.routes).toEqual([]);

      const errorSpy = spyConsoleError();
      try {
        await service.handleLnurlpVerify({
          encryptedQuoteData: verifySegment(result),
        });
      } finally {
        errorSpy.mockRestore();
      }
      expect(sparkWallet.requests).toEqual([{ requestId: 'srv-quote-9' }]);
      expect(cashuCalls).toHaveLength(0);
    });

    it('(l) converts only when the account currency differs', async () => {
      const quoteArgs: Parameters<GetCashuLightningQuote>[0][] = [];
      const rateTickers: string[] = [];
      const usdCashuAccount = {
        type: 'cashu',
        currency: 'USD',
        id: 'acct-usd',
        mintUrl: 'https://mint.example',
        wallet: walletMarker,
      } as RedactedAccount;
      const service = new LightningAddressService(config, {
        userRepository: userRepositoryReturning(alice),
        exchangeRateService: {
          getRate: async (ticker: string) => {
            rateTickers.push(ticker);
            return '1';
          },
        },
        createDefaultAccountRepository:
          defaultAccountRepositoryReturning(usdCashuAccount),
        getCashuLightningQuote: async (
          params: Parameters<GetCashuLightningQuote>[0],
        ) => {
          quoteArgs.push(params);
          return {
            mintQuote: { quote: 'mint-quote-usd', request: 'lnbc1usd' },
          } as unknown as CashuLightningQuote;
        },
        createCashuReceiveQuote: async (_params: CashuCreateParams) =>
          undefined,
      });

      await service.handleLnurlpCallback({
        userId: 'user-1',
        amount: msat(10_000),
        baseUrl: 'https://pay.example',
        bypassAmountValidation: true,
      });

      expect(quoteArgs).toHaveLength(1);
      expect(quoteArgs[0]?.amount.currency).toBe('USD');
      expect(rateTickers).toEqual(['BTC-USD']);
    });

    it('(v) builds the default-account repository per callback from config', async () => {
      const factoryCalls: Parameters<CreateDefaultAccountRepository>[] = [];
      const service = new LightningAddressService(config, {
        userRepository: userRepositoryReturning(alice),
        createDefaultAccountRepository: (...args) => {
          factoryCalls.push(args);
          return {
            getDefaultAccount: async (_userId: string) => {
              throw new Error('stop before quote creation');
            },
          };
        },
      });
      const errorSpy = spyConsoleError();
      try {
        await service.handleLnurlpCallback({
          userId: 'user-1',
          amount: msat(10_000),
          baseUrl: 'https://pay.example',
        });
        await service.handleLnurlpCallback({
          userId: 'user-1',
          amount: msat(10_000),
          baseUrl: 'https://pay.example',
        });
      } finally {
        errorSpy.mockRestore();
      }

      expect(factoryCalls).toHaveLength(2);
      for (const [
        factoryDb,
        getSparkWalletMnemonic,
        sparkConfig,
      ] of factoryCalls) {
        expect(factoryDb).toBe(db);
        expect(await getSparkWalletMnemonic()).toBe('mnemonic-from-config');
        expect(sparkConfig).toEqual({
          storageDir: '/tmp/test-spark',
          apiKey: 'test-api-key',
        });
      }
    });
  });

  describe('handleLnurlpVerify', () => {
    it('(m) decrypts the frozen cashu and spark blobs', async () => {
      const cashuWallet = createCashuWalletSeam({
        state: 'UNPAID',
        request: 'lnbc-old',
      });
      const sparkWallet = createSparkWalletSeam(async () => null);
      const service = new LightningAddressService(config, {
        getCashuWallet: cashuWallet.getCashuWallet,
        getSparkWallet: sparkWallet.getSparkWallet,
      });

      const cashuResult = await service.handleLnurlpVerify({
        encryptedQuoteData: CASHU_FIXTURE_BLOB,
      });
      expect(cashuWallet.mintUrls).toEqual(['https://mint.example']);
      expect(cashuWallet.quoteIds).toEqual(['mint-quote-1']);
      expect(cashuResult).toEqual({
        status: 'OK',
        settled: false,
        preimage: null,
        pr: 'lnbc-old',
      });

      const errorSpy = spyConsoleError();
      try {
        const sparkResult = await service.handleLnurlpVerify({
          encryptedQuoteData: SPARK_FIXTURE_BLOB,
        });
        expect(sparkWallet.walletArgs).toHaveLength(1);
        expect(sparkWallet.requests).toEqual([{ requestId: 'srv-quote-1' }]);
        expect(sparkResult).toEqual({ status: 'ERROR', reason: 'Not found' });
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('(n) returns the internal-error envelope for a garbage blob', async () => {
      const cashuWallet = createCashuWalletSeam({
        state: 'PAID',
        request: 'lnbc-x',
      });
      const sparkWallet = createSparkWalletSeam(async () => null);
      const service = new LightningAddressService(config, {
        getCashuWallet: cashuWallet.getCashuWallet,
        getSparkWallet: sparkWallet.getSparkWallet,
      });
      const errorSpy = spyConsoleError();
      try {
        const result = await service.handleLnurlpVerify({
          encryptedQuoteData: '%%%%',
        });

        expect(result).toEqual({
          status: 'ERROR',
          reason: 'Internal server error',
        });
        expect(errorSpy.mock.calls[0]?.[0]).toBe(
          'Error processing LNURL-pay verify',
        );
        expect(cashuWallet.mintUrls).toHaveLength(0);
        expect(sparkWallet.walletArgs).toHaveLength(0);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('(o) maps a missing spark request to Not found and other errors to internal error, logging both', async () => {
      const notFound = new LightningAddressService(config, {
        getSparkWallet: createSparkWalletSeam(async () => null).getSparkWallet,
      });
      const failing = new LightningAddressService(config, {
        getSparkWallet: createSparkWalletSeam(async () => {
          throw new Error('boom');
        }).getSparkWallet,
      });
      const errorSpy = spyConsoleError();
      try {
        const notFoundResult = await notFound.handleLnurlpVerify({
          encryptedQuoteData: SPARK_FIXTURE_BLOB,
        });
        expect(notFoundResult).toEqual({
          status: 'ERROR',
          reason: 'Not found',
        });
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0]?.[0]).toBe(
          'Error processing LNURL-pay verify',
        );

        const failingResult = await failing.handleLnurlpVerify({
          encryptedQuoteData: SPARK_FIXTURE_BLOB,
        });
        expect(failingResult).toEqual({
          status: 'ERROR',
          reason: 'Internal server error',
        });
        expect(errorSpy).toHaveBeenCalledTimes(2);
        expect(errorSpy.mock.calls[1]?.[0]).toBe(
          'Error processing LNURL-pay verify',
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('(p) returns the cashu LUD-21 envelopes per mint state', async () => {
      const verifyWithState = async (state: string) => {
        const service = new LightningAddressService(config, {
          getCashuWallet: createCashuWalletSeam({ state, request: 'lnbc-c' })
            .getCashuWallet,
        });
        return service.handleLnurlpVerify({
          encryptedQuoteData: CASHU_FIXTURE_BLOB,
        });
      };

      const paid = await verifyWithState('PAID');
      expect(paid).toEqual({
        status: 'OK',
        settled: true,
        preimage: '',
        pr: 'lnbc-c',
      });
      expect(Object.keys(paid)).toEqual([
        'status',
        'settled',
        'preimage',
        'pr',
      ]);
      expect((paid as { preimage: unknown }).preimage).toBe('');

      const issued = await verifyWithState('ISSUED');
      expect(issued).toEqual({
        status: 'OK',
        settled: true,
        preimage: '',
        pr: 'lnbc-c',
      });

      const unpaid = await verifyWithState('UNPAID');
      expect(unpaid).toEqual({
        status: 'OK',
        settled: false,
        preimage: null,
        pr: 'lnbc-c',
      });
      expect((unpaid as { preimage: unknown }).preimage).toBe(null);
    });

    it('(q) forwards the spark config and maps the receive request status', async () => {
      const responses = [
        {
          status: 'transferCompleted',
          paymentPreimage: 'ab',
          invoice: 'lnbc-s',
        },
        { status: 'pending', invoice: 'lnbc-p' },
      ];
      const sparkWallet = createSparkWalletSeam(async () => responses.shift());
      const service = new LightningAddressService(config, {
        getSparkWallet: sparkWallet.getSparkWallet,
      });

      const settled = await service.handleLnurlpVerify({
        encryptedQuoteData: SPARK_FIXTURE_BLOB,
      });
      expect(sparkWallet.walletArgs[0]).toEqual({
        network: 'REGTEST',
        mnemonic: 'mnemonic-from-config',
        storageDir: '/tmp/test-spark',
        apiKey: 'test-api-key',
      });
      expect(settled).toEqual({
        status: 'OK',
        settled: true,
        preimage: 'ab',
        pr: 'lnbc-s',
      });

      const pending = await service.handleLnurlpVerify({
        encryptedQuoteData: SPARK_FIXTURE_BLOB,
      });
      expect(pending).toEqual({
        status: 'OK',
        settled: false,
        preimage: null,
        pr: 'lnbc-p',
      });
    });

    it('(r) decrypts the blob the service just encrypted', async () => {
      const setup = createCashuCallbackSetup();

      const result = await setup.service.handleLnurlpCallback({
        userId: 'user-1',
        amount: msat(1000),
        baseUrl: 'https://pay.example',
      });
      await setup.service.handleLnurlpVerify({
        encryptedQuoteData: verifySegment(result),
      });

      expect(setup.cashuWallet.quoteIds).toEqual(['mint-quote-1']);
      expect(setup.cashuWallet.mintUrls).toEqual(['https://mint.example']);
    });
  });
});
