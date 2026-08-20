import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import type { Token } from '@cashu/cashu-ts';
import type { AgicashDb } from '../../db/database';
import { BASE_CASHU_LOCKING_DERIVATION_PATH } from '../../lib/cashu';
import { derivePublicKey } from '../../lib/cryptography';
import {
  NoSessionError,
  NotImplementedError,
  SessionEndedError,
  UniqueConstraintError,
} from '../../lib/error';
import type {
  CashuAccount as DomainCashuAccount,
  SparkAccount as DomainSparkAccount,
} from '../accounts/account';
import type { AccountRepository } from '../accounts/account-repository';
import type { AuthSession, AuthUser } from '../sdk';
import { createSessionKeys } from '../sdk/session-keys';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { CashuReceiveLightningQuote } from './cashu-receive-quote-core';
import type { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import type { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import type { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';
import type { CashuReceiveSwapService } from './cashu-receive-swap-service';
import { createReceiveApi } from './receive-api';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { SparkReceiveLightningQuote } from './spark-receive-quote-core';
import type { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';
import type { SparkReceiveQuoteService } from './spark-receive-quote-service';

const authUser = (id: string): AuthUser =>
  ({
    id,
    name: null,
    email: 'a@b.c',
    email_verified: true,
    login_method: 'email',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  }) as AuthUser;

const loggedIn = (id: string): AuthSession => ({
  isLoggedIn: true,
  user: authUser(id),
});

const cashuDomain = (
  overrides: Partial<Record<string, unknown>> = {},
): DomainCashuAccount =>
  ({
    id: 'acct-cashu',
    name: 'Testnut BTC',
    type: 'cashu',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    currency: 'BTC',
    createdAt: '2026-01-01T00:00:00Z',
    version: 1,
    expiresAt: null,
    mintUrl: 'https://testnut.cashu.space',
    isTestMint: true,
    keysetCounters: {},
    proofs: [{ amount: 100 }, { amount: 50 }],
    wallet: { marker: 'cashu-wallet' },
    ...overrides,
  }) as unknown as DomainCashuAccount;

const makeLightningQuote = (): CashuReceiveLightningQuote =>
  ({
    mintQuote: {
      quote: 'mint-quote-1',
      request: 'lnbc100n1payme',
      state: 'UNPAID',
      expiry: 1767229200,
    },
    lockingPublicKey: '02abc',
    fullLockingDerivationPath: "m/129372'/0'/0'/4321",
    expiresAt: '2026-01-01T01:00:00Z',
    amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
    description: 'test receive',
    paymentHash: 'payment-hash-1',
  }) as unknown as CashuReceiveLightningQuote;

const makeQuote = (
  overrides: Partial<Record<string, unknown>> = {},
): CashuReceiveQuote =>
  ({
    id: 'quote-1',
    userId: 'user-x',
    accountId: 'acct-cashu',
    quoteId: 'mint-quote-1',
    amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-01T01:00:00Z',
    paymentRequest: 'lnbc100n1payme',
    paymentHash: 'payment-hash-1',
    lockingDerivationPath: "m/129372'/0'/0'/4321",
    transactionId: 'tx-1',
    totalFee: Money.zero('BTC'),
    version: 1,
    type: 'LIGHTNING',
    state: 'UNPAID',
    ...overrides,
  }) as unknown as CashuReceiveQuote;

const makeToken = (): Token =>
  ({
    mint: 'https://testnut.cashu.space',
    proofs: [{ id: '00ad', amount: 100, secret: 's', C: 'c' }],
    unit: 'sat',
  }) as Token;

const makeSwap = (
  overrides: Partial<Record<string, unknown>> = {},
): CashuReceiveSwap =>
  ({
    tokenHash: 'token-hash-1',
    tokenProofs: [{ amount: 100 }],
    userId: 'user-x',
    accountId: 'acct-cashu',
    inputAmount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
    amountReceived: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
    feeAmount: Money.zero('BTC'),
    keysetId: '00ad',
    keysetCounter: 0,
    outputAmounts: [100],
    transactionId: 'tx-swap-1',
    createdAt: '2026-01-01T00:00:00Z',
    version: 1,
    state: 'PENDING',
    ...overrides,
  }) as unknown as CashuReceiveSwap;

const swapWallet = {
  getKeyset: () => ({ keys: { 1: '02abc' } }),
  getFeesForProofs: () => 0,
  keysetId: '00ad',
};

const sparkDomain = (
  overrides: Partial<Record<string, unknown>> = {},
): DomainSparkAccount =>
  ({
    id: 'acct-spark',
    name: 'Bitcoin',
    type: 'spark',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    currency: 'BTC',
    createdAt: '2026-01-01T00:00:00Z',
    version: 1,
    expiresAt: null,
    network: 'MAINNET',
    balance: new Money({ amount: 42, currency: 'BTC', unit: 'sat' }),
    wallet: { marker: 'spark-wallet' },
    ...overrides,
  }) as unknown as DomainSparkAccount;

const makeSparkLightningQuote = (): SparkReceiveLightningQuote =>
  ({
    id: 'receive-request-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    invoice: {
      paymentRequest: 'lnbc100n1payme',
      paymentHash: 'payment-hash-1',
      amount: new Money<Currency>({
        amount: 100,
        currency: 'BTC',
        unit: 'sat',
      }),
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-01-01T01:00:00Z',
      memo: 'test receive',
    },
    status: 'created',
    receiverIdentityPublicKey: '02abc',
  }) as unknown as SparkReceiveLightningQuote;

const makeSparkQuote = (
  overrides: Partial<Record<string, unknown>> = {},
): SparkReceiveQuote =>
  ({
    id: 'spark-quote-1',
    sparkId: 'receive-request-1',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-01T01:00:00Z',
    amount: new Money<Currency>({
      amount: 100,
      currency: 'BTC',
      unit: 'sat',
    }),
    description: 'test receive',
    paymentRequest: 'lnbc100n1payme',
    paymentHash: 'payment-hash-1',
    receiverIdentityPubkey: '02abc',
    transactionId: 'tx-spark-1',
    userId: 'user-x',
    accountId: 'acct-spark',
    totalFee: Money.zero('BTC'),
    version: 1,
    type: 'LIGHTNING',
    state: 'UNPAID',
    ...overrides,
  }) as unknown as SparkReceiveQuote;

const makeApi = (deps: {
  session: AuthSession;
  keys?: ReturnType<typeof createSessionKeys>;
  repository?: Partial<CashuReceiveQuoteRepository>;
  service?: Partial<CashuReceiveQuoteService>;
  swapRepository?: Partial<CashuReceiveSwapRepository>;
  swapService?: Partial<CashuReceiveSwapService>;
  sparkRepository?: Partial<SparkReceiveQuoteRepository>;
  sparkService?: Partial<SparkReceiveQuoteService>;
}) =>
  createReceiveApi({
    db: {} as unknown as AgicashDb,
    keys: deps.keys ?? createSessionKeys(),
    getSession: () => deps.session,
    getAccountRepository: async () => ({}) as unknown as AccountRepository,
    createRepository: async () =>
      (deps.repository ?? {}) as unknown as CashuReceiveQuoteRepository,
    createService: async () =>
      (deps.service ?? {}) as unknown as CashuReceiveQuoteService,
    createSwapRepository: async () =>
      (deps.swapRepository ?? {}) as unknown as CashuReceiveSwapRepository,
    createSwapService: async () =>
      (deps.swapService ?? {}) as unknown as CashuReceiveSwapService,
    createSparkRepository: async () =>
      (deps.sparkRepository ?? {}) as unknown as SparkReceiveQuoteRepository,
    createSparkService: async () =>
      (deps.sparkService ?? {}) as unknown as SparkReceiveQuoteService,
  });

describe('createReceiveApi', () => {
  describe('cashu.createQuote', () => {
    it('throws NoSessionError without a session, before any repository work', async () => {
      let createServiceCalls = 0;
      let getAccountRepositoryCalls = 0;
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => ({ isLoggedIn: false }),
        getAccountRepository: async () => {
          getAccountRepositoryCalls += 1;
          return {} as unknown as AccountRepository;
        },
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => {
          createServiceCalls += 1;
          return {} as unknown as CashuReceiveQuoteService;
        },
      });

      await expect(
        api.cashu.createQuote({
          account: cashuDomain(),
          lightningQuote: makeLightningQuote(),
        }),
      ).rejects.toBeInstanceOf(NoSessionError);
      expect(createServiceCalls).toBe(0);
      expect(getAccountRepositoryCalls).toBe(0);
    });

    it('passes the session userId, the given account, LIGHTNING receive type, and the abort signal to the service', async () => {
      let captured: Record<string, unknown> | undefined;
      let capturedOptions: { abortSignal?: AbortSignal } | undefined;
      const account = cashuDomain();
      const lightningQuote = makeLightningQuote();
      const quote = makeQuote();
      const api = makeApi({
        session: loggedIn('user-x'),
        service: {
          createReceiveQuote: (async (
            params: Record<string, unknown>,
            options?: { abortSignal?: AbortSignal },
          ) => {
            captured = params;
            capturedOptions = options;
            return quote;
          }) as unknown as CashuReceiveQuoteService['createReceiveQuote'],
        },
      });

      const result = await api.cashu.createQuote({
        account,
        lightningQuote,
        purpose: 'TRANSFER',
        transferId: 'transfer-1',
      });

      expect(captured?.userId).toBe('user-x');
      expect(captured?.account).toBe(account);
      expect(captured?.receiveType).toBe('LIGHTNING');
      expect(captured?.lightningQuote).toBe(lightningQuote);
      expect(captured?.purpose).toBe('TRANSFER');
      expect(captured?.transferId).toBe('transfer-1');
      expect(capturedOptions?.abortSignal).toBeDefined();
      expect(result).toBe(quote);
    });

    it('rejects with SessionEndedError and never calls the service when the session ends during service construction', async () => {
      const keys = createSessionKeys();
      let createReceiveQuoteCalls = 0;
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => {
          // The session ends between the signal capture and the write.
          keys.reset();
          return {
            createReceiveQuote: (async () => {
              createReceiveQuoteCalls += 1;
              return makeQuote();
            }) as unknown as CashuReceiveQuoteService['createReceiveQuote'],
          } as unknown as CashuReceiveQuoteService;
        },
      });

      await expect(
        api.cashu.createQuote({
          account: cashuDomain(),
          lightningQuote: makeLightningQuote(),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(createReceiveQuoteCalls).toBe(0);
    });
  });

  describe('cashu.getLightningQuote', () => {
    it('calls the service with the account wallet, amount, and description', async () => {
      let captured:
        | { wallet: unknown; amount: Money; description?: string }
        | undefined;
      const account = cashuDomain();
      const lightningQuote = makeLightningQuote();
      const api = makeApi({
        session: loggedIn('user-x'),
        service: {
          getLightningQuote: (async (params: {
            wallet: unknown;
            amount: Money;
            description?: string;
          }) => {
            captured = params;
            return lightningQuote;
          }) as unknown as CashuReceiveQuoteService['getLightningQuote'],
        },
      });

      const amount = new Money<Currency>({
        amount: 100,
        currency: 'BTC',
        unit: 'sat',
      });
      const result = await api.cashu.getLightningQuote({
        account,
        amount,
        description: 'test receive',
      });

      expect(captured?.wallet).toBe(account.wallet);
      expect(captured?.amount).toBe(amount);
      expect(captured?.description).toBe('test receive');
      expect(result).toBe(lightningQuote);
    });
  });

  describe('cashu.getQuote', () => {
    it('passes the id and the abort signal through and returns the quote verbatim', async () => {
      let requestedId: string | undefined;
      let capturedOptions: { abortSignal?: AbortSignal } | undefined;
      const quote = makeQuote();
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          get: (async (id, options) => {
            requestedId = id;
            capturedOptions = options;
            return quote;
          }) as CashuReceiveQuoteRepository['get'],
        },
      });

      const result = await api.cashu.getQuote('quote-1');

      expect(requestedId).toBe('quote-1');
      expect(capturedOptions?.abortSignal).toBeDefined();
      expect(result).toBe(quote);
    });

    it('returns null when the quote does not exist', async () => {
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          get: (async () => null) as CashuReceiveQuoteRepository['get'],
        },
      });

      await expect(api.cashu.getQuote('missing')).resolves.toBeNull();
    });

    it('rejects with SessionEndedError and issues no read when the session ends before the read', async () => {
      const keys = createSessionKeys();
      let getCalls = 0;
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () => {
          // The session ends between the signal capture and the read.
          keys.reset();
          return {
            get: (async () => {
              getCalls += 1;
              return makeQuote();
            }) as CashuReceiveQuoteRepository['get'],
          } as unknown as CashuReceiveQuoteRepository;
        },
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
      });

      await expect(api.cashu.getQuote('quote-1')).rejects.toBeInstanceOf(
        SessionEndedError,
      );
      expect(getCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the read', async () => {
      const keys = createSessionKeys();
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({
            get: (async () => {
              keys.reset();
              return makeQuote();
            }) as CashuReceiveQuoteRepository['get'],
          }) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
      });

      await expect(api.cashu.getQuote('quote-1')).rejects.toBeInstanceOf(
        SessionEndedError,
      );
    });
  });

  describe('cashu.createSwap', () => {
    it('throws NoSessionError without a session, before any repository/service construction', async () => {
      let createSwapServiceCalls = 0;
      let createSwapRepositoryCalls = 0;
      let getAccountRepositoryCalls = 0;
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => ({ isLoggedIn: false }),
        getAccountRepository: async () => {
          getAccountRepositoryCalls += 1;
          return {} as unknown as AccountRepository;
        },
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () => {
          createSwapRepositoryCalls += 1;
          return {} as unknown as CashuReceiveSwapRepository;
        },
        createSwapService: async () => {
          createSwapServiceCalls += 1;
          return {} as unknown as CashuReceiveSwapService;
        },
      });

      await expect(
        api.cashu.createSwap({
          account: cashuDomain(),
          token: makeToken(),
        }),
      ).rejects.toBeInstanceOf(NoSessionError);
      expect(createSwapServiceCalls).toBe(0);
      expect(createSwapRepositoryCalls).toBe(0);
      expect(getAccountRepositoryCalls).toBe(0);
    });

    it('passes the session userId, the given token and account, and the abort signal to the service', async () => {
      let captured: Record<string, unknown> | undefined;
      let capturedOptions: { abortSignal?: AbortSignal } | undefined;
      const account = cashuDomain();
      const token = makeToken();
      const swap = makeSwap();
      const serviceResult = { swap, account };
      const api = makeApi({
        session: loggedIn('user-x'),
        swapService: {
          create: (async (
            params: Record<string, unknown>,
            options?: { abortSignal?: AbortSignal },
          ) => {
            captured = params;
            capturedOptions = options;
            return serviceResult;
          }) as unknown as CashuReceiveSwapService['create'],
        },
      });

      const result = await api.cashu.createSwap({
        account,
        token,
      });

      expect(captured).toEqual({ userId: 'user-x', token, account });
      expect(captured?.userId).toBe('user-x');
      expect(captured?.token).toBe(token);
      expect(captured?.account).toBe(account);
      expect(capturedOptions?.abortSignal).toBeDefined();
      expect(result).toBe(serviceResult);
    });

    it('rejects with SessionEndedError and never calls the service when the session ends during service construction', async () => {
      const keys = createSessionKeys();
      let createCalls = 0;
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({}) as unknown as CashuReceiveSwapRepository,
        createSwapService: async () => {
          keys.reset();
          return {
            create: (async () => {
              createCalls += 1;
              return { swap: makeSwap(), account: cashuDomain() };
            }) as unknown as CashuReceiveSwapService['create'],
          } as unknown as CashuReceiveSwapService;
        },
      });

      await expect(
        api.cashu.createSwap({
          account: cashuDomain(),
          token: makeToken(),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(createCalls).toBe(0);
    });

    it('propagates UniqueConstraintError from the service unchanged', async () => {
      const error = new UniqueConstraintError(
        'This token has already been claimed',
      );
      const api = makeApi({
        session: loggedIn('user-x'),
        swapService: {
          create: (async () => {
            throw error;
          }) as unknown as CashuReceiveSwapService['create'],
        },
      });

      await expect(
        api.cashu.createSwap({
          account: cashuDomain(),
          token: makeToken(),
        }),
      ).rejects.toBe(error);
    });

    it('builds the default swap service from the repository without CashuCryptography', async () => {
      const account = cashuDomain({ wallet: swapWallet });
      const token = makeToken();
      const swap = makeSwap();
      const serviceResult = { swap, account };
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({
            create: (async () =>
              serviceResult) as CashuReceiveSwapRepository['create'],
          }) as unknown as CashuReceiveSwapRepository,
      });

      const result = await api.cashu.createSwap({ account, token });

      expect(result).toBe(serviceResult);
    });
  });

  describe('session fences', () => {
    it('rejects getLightningQuote with SessionEndedError and never calls the mint when the session ends during service construction', async () => {
      const keys = createSessionKeys();
      let getLightningQuoteCalls = 0;
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => {
          // The session ends between the signal capture and the mint call.
          keys.reset();
          return {
            getLightningQuote: (async () => {
              getLightningQuoteCalls += 1;
              return makeLightningQuote();
            }) as unknown as CashuReceiveQuoteService['getLightningQuote'],
          } as unknown as CashuReceiveQuoteService;
        },
      });

      await expect(
        api.cashu.getLightningQuote({
          account: cashuDomain(),
          amount: new Money<Currency>({
            amount: 100,
            currency: 'BTC',
            unit: 'sat',
          }),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(getLightningQuoteCalls).toBe(0);
    });

    it('rejects getLightningQuote with SessionEndedError when the session ends during the mint call', async () => {
      const keys = createSessionKeys();
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () =>
          ({
            getLightningQuote: (async () => {
              keys.reset();
              return makeLightningQuote();
            }) as unknown as CashuReceiveQuoteService['getLightningQuote'],
          }) as unknown as CashuReceiveQuoteService,
      });

      await expect(
        api.cashu.getLightningQuote({
          account: cashuDomain(),
          amount: new Money<Currency>({
            amount: 100,
            currency: 'BTC',
            unit: 'sat',
          }),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
    });

    it('rejects createQuote with SessionEndedError when the session ends during the write', async () => {
      const keys = createSessionKeys();
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () =>
          ({
            createReceiveQuote: (async () => {
              keys.reset();
              return makeQuote();
            }) as unknown as CashuReceiveQuoteService['createReceiveQuote'],
          }) as unknown as CashuReceiveQuoteService,
      });

      await expect(
        api.cashu.createQuote({
          account: cashuDomain(),
          lightningQuote: makeLightningQuote(),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
    });

    it('threads the session signal into the service write', async () => {
      const keys = createSessionKeys();
      let writeSignal: AbortSignal | undefined;
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () =>
          ({
            createReceiveQuote: (async (
              _params: unknown,
              options?: { abortSignal?: AbortSignal },
            ) => {
              writeSignal = options?.abortSignal;
              return makeQuote();
            }) as unknown as CashuReceiveQuoteService['createReceiveQuote'],
          }) as unknown as CashuReceiveQuoteService,
      });

      await api.cashu.createQuote({
        account: cashuDomain(),
        lightningQuote: makeLightningQuote(),
      });

      expect(writeSignal).toBe(keys.sessionSignal());
    });

    it('rejects createSwap with SessionEndedError when the session ends during the write', async () => {
      const keys = createSessionKeys();
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({}) as unknown as CashuReceiveSwapRepository,
        createSwapService: async () =>
          ({
            create: (async () => {
              keys.reset();
              return { swap: makeSwap(), account: cashuDomain() };
            }) as unknown as CashuReceiveSwapService['create'],
          }) as unknown as CashuReceiveSwapService,
      });

      await expect(
        api.cashu.createSwap({
          account: cashuDomain(),
          token: makeToken(),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
    });

    it('threads the session signal through the default swap service into the repository write', async () => {
      const keys = createSessionKeys();
      let writeOptions: { abortSignal?: AbortSignal } | undefined;
      const account = cashuDomain({ wallet: swapWallet });
      const token = makeToken();
      const swap = makeSwap();
      const serviceResult = { swap, account };
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({
            create: (async (
              _params: unknown,
              options?: { abortSignal?: AbortSignal },
            ) => {
              writeOptions = options;
              return serviceResult;
            }) as CashuReceiveSwapRepository['create'],
          }) as unknown as CashuReceiveSwapRepository,
      });

      await api.cashu.createSwap({ account, token });

      expect(writeOptions?.abortSignal).toBe(keys.sessionSignal());
    });

    it('threads the session signal through the default spark service into the repository write', async () => {
      const keys = createSessionKeys();
      let writeOptions: { abortSignal?: AbortSignal } | undefined;
      const account = sparkDomain();
      const lightningQuote = makeSparkLightningQuote();
      const quote = makeSparkQuote();
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({}) as unknown as CashuReceiveSwapRepository,
        createSwapService: async () =>
          ({}) as unknown as CashuReceiveSwapService,
        createSparkRepository: async () =>
          ({
            create: (async (
              _params: unknown,
              options?: { abortSignal?: AbortSignal },
            ) => {
              writeOptions = options;
              return quote;
            }) as SparkReceiveQuoteRepository['create'],
          }) as unknown as SparkReceiveQuoteRepository,
      });

      await api.spark.createQuote({
        account,
        lightningQuote,
        purpose: 'TRANSFER',
        transferId: 'transfer-1',
      });

      expect(writeOptions?.abortSignal).toBe(keys.sessionSignal());
    });
  });

  // BOLT11 spec test-vector invoice; the cores decode it for the payment hash.
  const fixtureInvoice =
    'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

  describe('default service cryptography', () => {
    it('locks the mint quote to a key derived from the session cashu locking xpub', async () => {
      const keys = createSessionKeys({
        readCashuSeed: async () => new Uint8Array(64).fill(7),
      });
      const wallet = {
        createLockedMintQuote: async (
          amount: number,
          pubkey: string,
          description?: string,
        ) => ({
          quote: 'mint-quote-parity',
          request: fixtureInvoice,
          state: 'UNPAID',
          expiry: 1767229200,
          pubkey,
          amount,
          unit: 'sat',
          description,
        }),
      };
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
      });

      const result = await api.cashu.getLightningQuote({
        account: cashuDomain({ wallet }),
        amount: new Money<Currency>({
          amount: 100,
          currency: 'BTC',
          unit: 'sat',
        }),
      });

      expect(
        result.fullLockingDerivationPath.startsWith(
          BASE_CASHU_LOCKING_DERIVATION_PATH,
        ),
      ).toBe(true);
      const unhardenedIndex = result.fullLockingDerivationPath.split('/').pop();
      expect(result.lockingPublicKey).toBe(
        derivePublicKey(
          await keys.getCashuLockingXpub(),
          `m/${unhardenedIndex}`,
        ),
      );
      expect(result.paymentHash).toHaveLength(64);
      expect(result.mintQuote.quote).toBe('mint-quote-parity');
    });
  });

  describe('default spark service preview', () => {
    it('returns the real getLightningQuote delegate through the default service', async () => {
      let receiveRequest:
        | { paymentMethod: { description: string; amountSats: number } }
        | undefined;
      const wallet = {
        receivePayment: async (request: {
          paymentMethod: { description: string; amountSats: number };
        }) => {
          receiveRequest = request;
          return {
            paymentRequest: fixtureInvoice,
            lightningReceiveDetails: {
              receiveRequestId: 'receive-request-1',
              status: 'created',
              createdAt: 1767229200,
              updatedAt: 1767229200,
            },
          };
        },
      };
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({}) as unknown as CashuReceiveSwapRepository,
        createSwapService: async () =>
          ({}) as unknown as CashuReceiveSwapService,
        createSparkRepository: async () =>
          ({}) as unknown as SparkReceiveQuoteRepository,
      });

      const result = await api.spark.getLightningQuote({
        account: sparkDomain({ wallet }),
        amount: new Money<Currency>({
          amount: 100,
          currency: 'BTC',
          unit: 'sat',
        }),
        description: 'spark preview memo',
      });

      expect(receiveRequest?.paymentMethod.amountSats).toBe(100);
      expect(receiveRequest?.paymentMethod.description).toBe(
        'spark preview memo',
      );
      expect(result.invoice.paymentHash).toHaveLength(64);
      expect(result.invoice.paymentHash).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('spark.createQuote', () => {
    it('throws NoSessionError without a session, before any repository/service construction', async () => {
      let createSparkServiceCalls = 0;
      let createSparkRepositoryCalls = 0;
      let getAccountRepositoryCalls = 0;
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => ({ isLoggedIn: false }),
        getAccountRepository: async () => {
          getAccountRepositoryCalls += 1;
          return {} as unknown as AccountRepository;
        },
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({}) as unknown as CashuReceiveSwapRepository,
        createSwapService: async () =>
          ({}) as unknown as CashuReceiveSwapService,
        createSparkRepository: async () => {
          createSparkRepositoryCalls += 1;
          return {} as unknown as SparkReceiveQuoteRepository;
        },
        createSparkService: async () => {
          createSparkServiceCalls += 1;
          return {} as unknown as SparkReceiveQuoteService;
        },
      });

      await expect(
        api.spark.createQuote({
          account: sparkDomain(),
          lightningQuote: makeSparkLightningQuote(),
        }),
      ).rejects.toBeInstanceOf(NoSessionError);
      expect(createSparkServiceCalls).toBe(0);
      expect(createSparkRepositoryCalls).toBe(0);
      expect(getAccountRepositoryCalls).toBe(0);
    });

    it('passes the session userId, the given account, LIGHTNING receive type, and the abort signal to the service', async () => {
      let captured: Record<string, unknown> | undefined;
      let capturedOptions: { abortSignal?: AbortSignal } | undefined;
      const account = sparkDomain();
      const lightningQuote = makeSparkLightningQuote();
      const quote = makeSparkQuote();
      const api = makeApi({
        session: loggedIn('user-x'),
        sparkService: {
          createReceiveQuote: (async (
            params: Record<string, unknown>,
            options?: { abortSignal?: AbortSignal },
          ) => {
            captured = params;
            capturedOptions = options;
            return quote;
          }) as unknown as SparkReceiveQuoteService['createReceiveQuote'],
        },
      });

      const result = await api.spark.createQuote({
        account,
        lightningQuote,
        purpose: 'TRANSFER',
        transferId: 'transfer-1',
      });

      expect(captured?.userId).toBe('user-x');
      expect(captured?.account).toBe(account);
      expect(captured?.receiveType).toBe('LIGHTNING');
      expect(captured?.lightningQuote).toBe(lightningQuote);
      expect(captured?.purpose).toBe('TRANSFER');
      expect(captured?.transferId).toBe('transfer-1');
      expect(capturedOptions?.abortSignal).toBeDefined();
      expect(result).toBe(quote);
    });

    it('rejects with SessionEndedError and never calls the service when the session ends during service construction', async () => {
      const keys = createSessionKeys();
      let createReceiveQuoteCalls = 0;
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({}) as unknown as CashuReceiveSwapRepository,
        createSwapService: async () =>
          ({}) as unknown as CashuReceiveSwapService,
        createSparkService: async () => {
          // The session ends between the signal capture and the write.
          keys.reset();
          return {
            createReceiveQuote: (async () => {
              createReceiveQuoteCalls += 1;
              return makeSparkQuote();
            }) as unknown as SparkReceiveQuoteService['createReceiveQuote'],
          } as unknown as SparkReceiveQuoteService;
        },
      });

      await expect(
        api.spark.createQuote({
          account: sparkDomain(),
          lightningQuote: makeSparkLightningQuote(),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(createReceiveQuoteCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends after the service call resolves', async () => {
      const keys = createSessionKeys();
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({}) as unknown as CashuReceiveSwapRepository,
        createSwapService: async () =>
          ({}) as unknown as CashuReceiveSwapService,
        createSparkService: async () =>
          ({
            createReceiveQuote: (async () => {
              keys.reset();
              return makeSparkQuote();
            }) as unknown as SparkReceiveQuoteService['createReceiveQuote'],
          }) as unknown as SparkReceiveQuoteService,
      });

      await expect(
        api.spark.createQuote({
          account: sparkDomain(),
          lightningQuote: makeSparkLightningQuote(),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
    });
  });

  describe('spark.getLightningQuote', () => {
    it('calls the service with the account wallet, amount, and description', async () => {
      let captured:
        | { wallet: unknown; amount: Money; description?: string }
        | undefined;
      const account = sparkDomain();
      const lightningQuote = makeSparkLightningQuote();
      const api = makeApi({
        session: loggedIn('user-x'),
        sparkService: {
          getLightningQuote: (async (params: {
            wallet: unknown;
            amount: Money;
            description?: string;
          }) => {
            captured = params;
            return lightningQuote;
          }) as unknown as SparkReceiveQuoteService['getLightningQuote'],
        },
      });

      const amount = new Money<Currency>({
        amount: 100,
        currency: 'BTC',
        unit: 'sat',
      });
      const result = await api.spark.getLightningQuote({
        account,
        amount,
        description: 'test receive',
      });

      expect(captured?.wallet).toBe(account.wallet);
      expect(captured?.amount).toBe(amount);
      expect(captured?.description).toBe('test receive');
      expect(result).toBe(lightningQuote);
    });

    it('rejects with SessionEndedError and never calls the service when the session ends during service construction', async () => {
      const keys = createSessionKeys();
      let getLightningQuoteCalls = 0;
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({}) as unknown as CashuReceiveSwapRepository,
        createSwapService: async () =>
          ({}) as unknown as CashuReceiveSwapService,
        createSparkService: async () => {
          // The session ends between the signal capture and the Breez call.
          keys.reset();
          return {
            getLightningQuote: (async () => {
              getLightningQuoteCalls += 1;
              return makeSparkLightningQuote();
            }) as unknown as SparkReceiveQuoteService['getLightningQuote'],
          } as unknown as SparkReceiveQuoteService;
        },
      });

      await expect(
        api.spark.getLightningQuote({
          account: sparkDomain(),
          amount: new Money<Currency>({
            amount: 100,
            currency: 'BTC',
            unit: 'sat',
          }),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(getLightningQuoteCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the Breez call', async () => {
      const keys = createSessionKeys();
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({}) as unknown as CashuReceiveSwapRepository,
        createSwapService: async () =>
          ({}) as unknown as CashuReceiveSwapService,
        createSparkService: async () =>
          ({
            getLightningQuote: (async () => {
              keys.reset();
              return makeSparkLightningQuote();
            }) as unknown as SparkReceiveQuoteService['getLightningQuote'],
          }) as unknown as SparkReceiveQuoteService,
      });

      await expect(
        api.spark.getLightningQuote({
          account: sparkDomain(),
          amount: new Money<Currency>({
            amount: 100,
            currency: 'BTC',
            unit: 'sat',
          }),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
    });

    it('rejects a USD amount before any construction with a clear error', async () => {
      let createSparkServiceCalls = 0;
      let createSparkRepositoryCalls = 0;
      let getAccountRepositoryCalls = 0;
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => {
          getAccountRepositoryCalls += 1;
          return {} as unknown as AccountRepository;
        },
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({}) as unknown as CashuReceiveSwapRepository,
        createSwapService: async () =>
          ({}) as unknown as CashuReceiveSwapService,
        createSparkRepository: async () => {
          createSparkRepositoryCalls += 1;
          return {} as unknown as SparkReceiveQuoteRepository;
        },
        createSparkService: async () => {
          createSparkServiceCalls += 1;
          return {} as unknown as SparkReceiveQuoteService;
        },
      });

      const error = await api.spark
        .getLightningQuote({
          account: sparkDomain(),
          amount: new Money<Currency>({
            amount: 100,
            currency: 'USD',
            unit: 'cent',
          }),
        })
        .then(
          () => undefined,
          (e: unknown) => e,
        );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).constructor).toBe(Error);
      expect((error as Error).message).toBe(
        'Spark receive quotes support BTC amounts only',
      );
      expect(createSparkServiceCalls).toBe(0);
      expect(createSparkRepositoryCalls).toBe(0);
      expect(getAccountRepositoryCalls).toBe(0);
    });
  });

  describe('spark.getQuote', () => {
    it('passes the id and the abort signal through and returns the quote verbatim', async () => {
      const keys = createSessionKeys();
      let requestedId: string | undefined;
      let capturedOptions: { abortSignal?: AbortSignal } | undefined;
      const quote = makeSparkQuote();
      const api = makeApi({
        keys,
        session: loggedIn('user-x'),
        sparkRepository: {
          get: (async (id, options) => {
            requestedId = id;
            capturedOptions = options;
            return quote;
          }) as SparkReceiveQuoteRepository['get'],
        },
      });

      const result = await api.spark.getQuote('spark-quote-1');

      expect(requestedId).toBe('spark-quote-1');
      expect(capturedOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(result).toBe(quote);
    });

    it('returns null when the quote does not exist', async () => {
      const api = makeApi({
        session: loggedIn('user-x'),
        sparkRepository: {
          get: (async () => null) as SparkReceiveQuoteRepository['get'],
        },
      });

      await expect(api.spark.getQuote('missing')).resolves.toBeNull();
    });

    it('rejects with SessionEndedError and issues no read when the session ends before the read', async () => {
      const keys = createSessionKeys();
      let getCalls = 0;
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({}) as unknown as CashuReceiveSwapRepository,
        createSwapService: async () =>
          ({}) as unknown as CashuReceiveSwapService,
        createSparkRepository: async () => {
          // The session ends between the signal capture and the read.
          keys.reset();
          return {
            get: (async () => {
              getCalls += 1;
              return makeSparkQuote();
            }) as SparkReceiveQuoteRepository['get'],
          } as unknown as SparkReceiveQuoteRepository;
        },
        createSparkService: async () =>
          ({}) as unknown as SparkReceiveQuoteService,
      });

      await expect(api.spark.getQuote('spark-quote-1')).rejects.toBeInstanceOf(
        SessionEndedError,
      );
      expect(getCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the read', async () => {
      const keys = createSessionKeys();
      const api = createReceiveApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuReceiveQuoteRepository,
        createService: async () => ({}) as unknown as CashuReceiveQuoteService,
        createSwapRepository: async () =>
          ({}) as unknown as CashuReceiveSwapRepository,
        createSwapService: async () =>
          ({}) as unknown as CashuReceiveSwapService,
        createSparkRepository: async () =>
          ({
            get: (async () => {
              keys.reset();
              return makeSparkQuote();
            }) as SparkReceiveQuoteRepository['get'],
          }) as unknown as SparkReceiveQuoteRepository,
        createSparkService: async () =>
          ({}) as unknown as SparkReceiveQuoteService,
      });

      await expect(api.spark.getQuote('spark-quote-1')).rejects.toBeInstanceOf(
        SessionEndedError,
      );
    });
  });

  describe('cashuToken', () => {
    it('throws NotImplementedError until its slice lands', () => {
      const api = makeApi({ session: loggedIn('user-x') });

      expect(() => api.cashuToken).toThrow(NotImplementedError);
    });
  });
});
