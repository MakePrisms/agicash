import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import type { MeltQuoteBolt11Response, Proof } from '@cashu/cashu-ts';
import type { AgicashDb } from '../../db/database';
import {
  ConcurrencyError,
  DomainError,
  NoSessionError,
  NotImplementedError,
  SessionEndedError,
} from '../../lib/error';
import type {
  CashuAccount as DomainCashuAccount,
  SparkAccount,
} from '../accounts/account';
import type { AccountRepository } from '../accounts/account-repository';
import type { AuthSession, AuthUser } from '../sdk';
import { createSessionKeys } from '../sdk/session-keys';
import type { CashuSendQuote } from './cashu-send-quote';
import type { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import type {
  CashuLightningQuote,
  CashuSendQuoteService,
} from './cashu-send-quote-service';
import type { CashuSendSwap } from './cashu-send-swap';
import type { CashuSendSwapRepository } from './cashu-send-swap-repository';
import type {
  CashuSendSwapService,
  CashuSwapQuote,
} from './cashu-send-swap-service';
import { createSendApi } from './send-api';
import type { DestinationDetails } from './send-destination';
import type { SparkSendQuote } from './spark-send-quote';
import type { SparkSendQuoteRepository } from './spark-send-quote-repository';
import type {
  SparkLightningQuote,
  SparkSendQuoteService,
} from './spark-send-quote-service';

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

// BOLT11 spec test-vector invoice. It decodes but expired in 2017: decodeBolt11
// does not check expiry, while getLightningQuote rejects it.
const fixtureInvoice =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
const fixturePaymentHash =
  '0001020304050607080900010203040506070809000102030405060708090102';

const makeMeltQuote = (): MeltQuoteBolt11Response =>
  ({
    quote: 'mq-1',
    amount: 50,
    fee_reserve: 2,
    expiry: Math.floor(Date.now() / 1000) + 600,
    state: 'UNPAID',
    request: fixtureInvoice,
    unit: 'sat',
  }) as unknown as MeltQuoteBolt11Response;

const sats = (amount: number): Money<'BTC'> =>
  new Money({ amount, currency: 'BTC', unit: 'sat' });

const sendSats = (amount: number): Money<Currency> =>
  new Money<Currency>({ amount, currency: 'BTC', unit: 'sat' });

const makeLightningQuote = (): CashuLightningQuote =>
  ({
    paymentRequest: fixtureInvoice,
    amountRequested: sats(50),
    amountRequestedInBtc: sats(50),
    meltQuote: makeMeltQuote(),
    amountToReceive: sats(50),
    lightningFeeReserve: sats(2),
    estimatedCashuFee: sats(0),
    estimatedTotalFee: sats(2),
    estimatedTotalAmount: sats(52),
    expiresAt: null,
  }) as unknown as CashuLightningQuote;

const makeSendQuote = (): CashuSendQuote =>
  ({
    id: 'sq-1',
    transactionId: 'tx-1',
    userId: 'user-x',
    accountId: 'acct-cashu',
    quoteId: 'mq-1',
    paymentRequest: fixtureInvoice,
    paymentHash: fixturePaymentHash,
    proofs: [
      {
        id: 'p1',
        keysetId: 'ks-1',
        amount: 64,
        secret: 's1',
        unblindedSignature: 'C1',
      },
    ],
    state: 'UNPAID',
    version: 1,
  }) as unknown as CashuSendQuote;

const sendProof = {
  id: 'p1',
  keysetId: '009a1f293253e41e',
  amount: 64,
  secret: 's1',
  unblindedSignature:
    '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
};

const makeSwapQuote = (): CashuSwapQuote =>
  ({
    amountRequested: sats(64),
    amountToSend: sats(64),
    totalAmount: sats(64),
    totalFee: sats(0),
    senderPaysFee: true,
    cashuReceiveFee: sats(0),
    cashuSendFee: sats(0),
  }) as unknown as CashuSwapQuote;

const makeSendSwap = (): CashuSendSwap =>
  ({
    id: 'swap-1',
    transactionId: 'tx-swap-1',
    accountId: 'acct-cashu',
    userId: 'user-x',
    state: 'PENDING',
    proofsToSend: [sendProof],
    inputProofs: [sendProof],
  }) as unknown as CashuSendSwap;

const sparkDomain = (
  overrides: Partial<Record<string, unknown>> = {},
): SparkAccount =>
  ({
    id: 'acct-spark',
    name: 'Spark BTC',
    type: 'spark',
    currency: 'BTC',
    balance: sats(1000),
    wallet: { marker: 'spark-wallet' },
    ...overrides,
  }) as unknown as SparkAccount;

const makeSparkLightningQuote = (): SparkLightningQuote =>
  ({
    paymentRequest: fixtureInvoice,
    paymentHash: fixturePaymentHash,
    amountRequested: sats(50),
    amountRequestedInBtc: sats(50),
    amountToReceive: sats(50),
    estimatedLightningFee: sats(2),
    estimatedTotalFee: sats(2),
    estimatedTotalAmount: sats(52),
    paymentRequestIsAmountless: false,
    expiresAt: null,
  }) as unknown as SparkLightningQuote;

const makeSparkSendQuote = (): SparkSendQuote =>
  ({
    id: 'ssq-1',
    transactionId: 'tx-spark-1',
    userId: 'user-x',
    accountId: 'acct-spark',
    state: 'UNPAID',
    version: 1,
    paymentRequest: fixtureInvoice,
    paymentHash: fixturePaymentHash,
  }) as unknown as SparkSendQuote;

const exactProofsWallet = {
  selectProofsToSend: (proofs: Proof[]) => ({ send: proofs, keep: [] }),
  getFeesForProofs: () => 0,
  getFeesEstimateToReceiveAtLeast: () => 0,
  getKeyset: () => {
    throw new Error(
      'wallet.getKeyset must not be read on the exact-proofs path',
    );
  },
  get seed(): Uint8Array {
    throw new Error('wallet.seed must not be read');
  },
};

const makeApi = (deps: {
  session: AuthSession;
  keys?: ReturnType<typeof createSessionKeys>;
  repository?: Partial<CashuSendQuoteRepository>;
  service?: Partial<CashuSendQuoteService>;
  swapRepository?: Partial<CashuSendSwapRepository>;
  swapService?: Partial<CashuSendSwapService>;
  sparkRepository?: Partial<SparkSendQuoteRepository>;
  sparkService?: Partial<SparkSendQuoteService>;
}) =>
  createSendApi({
    db: {} as unknown as AgicashDb,
    keys: deps.keys ?? createSessionKeys(),
    getSession: () => deps.session,
    getAccountRepository: async () => ({}) as unknown as AccountRepository,
    createRepository: async () =>
      (deps.repository ?? {}) as unknown as CashuSendQuoteRepository,
    createService: async () =>
      (deps.service ?? {}) as unknown as CashuSendQuoteService,
    createSwapRepository: async () =>
      (deps.swapRepository ?? {}) as unknown as CashuSendSwapRepository,
    createSwapService: async () =>
      (deps.swapService ?? {}) as unknown as CashuSendSwapService,
    createSparkRepository: async () =>
      (deps.sparkRepository ?? {}) as unknown as SparkSendQuoteRepository,
    createSparkService: async () =>
      (deps.sparkService ?? {}) as unknown as SparkSendQuoteService,
  });

describe('createSendApi', () => {
  describe('cashu.getLightningQuote', () => {
    it('passes the account, payment request, and amount to the service and returns its quote without calling getSession', async () => {
      let captured: Record<string, unknown> | undefined;
      let getSessionCalls = 0;
      const account = cashuDomain();
      const amount = new Money<Currency>({
        amount: 50,
        currency: 'BTC',
        unit: 'sat',
      });
      const lightningQuote = makeLightningQuote();
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => {
          getSessionCalls += 1;
          return { isLoggedIn: false };
        },
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuSendQuoteRepository,
        createService: async () =>
          ({
            getLightningQuote: (async (params: Record<string, unknown>) => {
              captured = params;
              return lightningQuote;
            }) as unknown as CashuSendQuoteService['getLightningQuote'],
          }) as unknown as CashuSendQuoteService,
      });

      const result = await api.cashu.getLightningQuote({
        account,
        paymentRequest: fixtureInvoice,
        amount,
      });

      expect(captured).toEqual({
        account,
        paymentRequest: fixtureInvoice,
        amount,
      });
      expect(captured?.account).toBe(account);
      expect(result).toBe(lightningQuote);
      expect(getSessionCalls).toBe(0);
    });

    it('rejects with SessionEndedError and never calls the mint when the session ends during service construction', async () => {
      const keys = createSessionKeys();
      let getLightningQuoteCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuSendQuoteRepository,
        createService: async () => {
          // The session ends between the signal capture and the mint call.
          keys.reset();
          return {
            getLightningQuote: (async () => {
              getLightningQuoteCalls += 1;
              return makeLightningQuote();
            }) as unknown as CashuSendQuoteService['getLightningQuote'],
          } as unknown as CashuSendQuoteService;
        },
      });

      await expect(
        api.cashu.getLightningQuote({
          account: cashuDomain(),
          paymentRequest: fixtureInvoice,
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(getLightningQuoteCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the mint call', async () => {
      const keys = createSessionKeys();
      const api = makeApi({
        session: loggedIn('user-x'),
        keys,
        service: {
          getLightningQuote: (async () => {
            keys.reset();
            return makeLightningQuote();
          }) as unknown as CashuSendQuoteService['getLightningQuote'],
        },
      });

      await expect(
        api.cashu.getLightningQuote({
          account: cashuDomain(),
          paymentRequest: fixtureInvoice,
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
    });

    it('propagates a service rejection as the same instance', async () => {
      const error = new DomainError(
        'Insufficient balance. Estimated total including fee is 52 sats.',
      );
      const api = makeApi({
        session: loggedIn('user-x'),
        service: {
          getLightningQuote: (async () => {
            throw error;
          }) as unknown as CashuSendQuoteService['getLightningQuote'],
        },
      });

      await expect(
        api.cashu.getLightningQuote({
          account: cashuDomain(),
          paymentRequest: fixtureInvoice,
        }),
      ).rejects.toBe(error);
    });

    it('builds the default service and rejects an expired invoice with no mint call and no write', async () => {
      let createCalls = 0;
      let createMeltQuoteCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({
            create: async () => {
              createCalls += 1;
              return makeSendQuote();
            },
          }) as unknown as CashuSendQuoteRepository,
      });

      const promise = api.cashu.getLightningQuote({
        account: cashuDomain({
          wallet: {
            createMeltQuoteBolt11: async () => {
              createMeltQuoteCalls += 1;
              return makeMeltQuote();
            },
          },
        }),
        paymentRequest: fixtureInvoice,
      });

      await expect(promise).rejects.toBeInstanceOf(DomainError);
      await expect(promise).rejects.toThrow('Lightning invoice has expired');
      expect(createCalls).toBe(0);
      expect(createMeltQuoteCalls).toBe(0);
    });
  });

  describe('cashu.createQuote', () => {
    it('throws NoSessionError without a session, before any construction', async () => {
      let createServiceCalls = 0;
      let createRepositoryCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => ({ isLoggedIn: false }),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () => {
          createRepositoryCalls += 1;
          return {} as unknown as CashuSendQuoteRepository;
        },
        createService: async () => {
          createServiceCalls += 1;
          return {} as unknown as CashuSendQuoteService;
        },
      });

      await expect(
        api.cashu.createQuote({
          account: cashuDomain(),
          lightningQuote: makeLightningQuote(),
        }),
      ).rejects.toBeInstanceOf(NoSessionError);
      expect(createServiceCalls).toBe(0);
      expect(createRepositoryCalls).toBe(0);
    });

    it('passes the session userId, the given account and quote, and the abort signal to the service, and returns only the transaction id', async () => {
      let captured: Record<string, unknown> | undefined;
      let capturedOptions: { abortSignal?: AbortSignal } | undefined;
      const keys = createSessionKeys();
      const account = cashuDomain();
      const lightningQuote = makeLightningQuote();
      const destinationDetails: DestinationDetails = {
        sendType: 'LN_ADDRESS',
        lnAddress: 'alice@example.com',
      };
      const api = makeApi({
        session: loggedIn('user-x'),
        keys,
        service: {
          createSendQuote: (async (
            params: Record<string, unknown>,
            options?: { abortSignal?: AbortSignal },
          ) => {
            captured = params;
            capturedOptions = options;
            return makeSendQuote();
          }) as unknown as CashuSendQuoteService['createSendQuote'],
        },
      });

      const result = await api.cashu.createQuote({
        account,
        lightningQuote,
        destinationDetails,
      });

      expect(captured).toEqual({
        userId: 'user-x',
        account,
        sendQuote: lightningQuote,
        destinationDetails,
      });
      expect(captured?.account).toBe(account);
      expect(captured?.sendQuote).toBe(lightningQuote);
      expect(capturedOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(result).toStrictEqual({ transactionId: 'tx-1' });
      expect(Object.keys(result)).toEqual(['transactionId']);
    });

    it('forwards no purpose or transferId and leaves destinationDetails undefined when omitted', async () => {
      let captured: Record<string, unknown> | undefined;
      const api = makeApi({
        session: loggedIn('user-x'),
        service: {
          createSendQuote: (async (params: Record<string, unknown>) => {
            captured = params;
            return makeSendQuote();
          }) as unknown as CashuSendQuoteService['createSendQuote'],
        },
      });

      await api.cashu.createQuote({
        account: cashuDomain(),
        lightningQuote: makeLightningQuote(),
      });

      expect(Object.keys(captured ?? {}).sort()).toEqual([
        'account',
        'destinationDetails',
        'sendQuote',
        'userId',
      ]);
      expect(captured?.destinationDetails).toBeUndefined();
    });

    it('rejects with SessionEndedError and never calls the service when the session ends during service construction', async () => {
      const keys = createSessionKeys();
      let createSendQuoteCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({}) as unknown as CashuSendQuoteRepository,
        createService: async () => {
          // The session ends between the signal capture and the write.
          keys.reset();
          return {
            createSendQuote: (async () => {
              createSendQuoteCalls += 1;
              return makeSendQuote();
            }) as unknown as CashuSendQuoteService['createSendQuote'],
          } as unknown as CashuSendQuoteService;
        },
      });

      await expect(
        api.cashu.createQuote({
          account: cashuDomain(),
          lightningQuote: makeLightningQuote(),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(createSendQuoteCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the write', async () => {
      const keys = createSessionKeys();
      const api = makeApi({
        session: loggedIn('user-x'),
        keys,
        service: {
          createSendQuote: (async () => {
            keys.reset();
            return makeSendQuote();
          }) as unknown as CashuSendQuoteService['createSendQuote'],
        },
      });

      await expect(
        api.cashu.createQuote({
          account: cashuDomain(),
          lightningQuote: makeLightningQuote(),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
    });

    it('propagates a ConcurrencyError from the service as the same instance', async () => {
      const error = new ConcurrencyError('Proofs already reserved');
      const api = makeApi({
        session: loggedIn('user-x'),
        service: {
          createSendQuote: (async () => {
            throw error;
          }) as unknown as CashuSendQuoteService['createSendQuote'],
        },
      });

      await expect(
        api.cashu.createQuote({
          account: cashuDomain(),
          lightningQuote: makeLightningQuote(),
        }),
      ).rejects.toBe(error);
    });

    it('propagates a DomainError from the service as the same instance', async () => {
      const error = new DomainError('Quote has expired');
      const api = makeApi({
        session: loggedIn('user-x'),
        service: {
          createSendQuote: (async () => {
            throw error;
          }) as unknown as CashuSendQuoteService['createSendQuote'],
        },
      });

      await expect(
        api.cashu.createQuote({
          account: cashuDomain(),
          lightningQuote: makeLightningQuote(),
        }),
      ).rejects.toBe(error);
    });

    it('forwards the session abort signal to the repository through the default service without reading the cashu seed', async () => {
      let capturedArgs: Record<string, unknown> | undefined;
      let capturedOptions: { abortSignal?: AbortSignal } | undefined;
      const keys = createSessionKeys({
        readCashuSeed: async () => {
          throw new Error('cashu seed must not be read');
        },
      });
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createRepository: async () =>
          ({
            create: async (
              args: Record<string, unknown>,
              options?: { abortSignal?: AbortSignal },
            ) => {
              capturedArgs = args;
              capturedOptions = options;
              return makeSendQuote();
            },
          }) as unknown as CashuSendQuoteRepository,
      });
      const account = cashuDomain({
        proofs: [
          {
            id: 'p1',
            keysetId: 'ks-1',
            amount: 64,
            secret: 's1',
            unblindedSignature: 'C1',
          },
        ],
        wallet: {
          getKeyset: () => ({ id: 'ks-1' }),
          selectProofsToSend: (proofs: Proof[]) => ({ send: proofs, keep: [] }),
          getFeesForProofs: () => 0,
          get seed(): Uint8Array {
            throw new Error('wallet.seed must not be read');
          },
        },
      });

      const result = await api.cashu.createQuote({
        account,
        lightningQuote: makeLightningQuote(),
      });

      expect(result).toStrictEqual({ transactionId: 'tx-1' });
      expect(capturedOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(capturedArgs?.userId).toBe('user-x');
      expect(capturedArgs?.accountId).toBe('acct-cashu');
      expect(capturedArgs?.quoteId).toBe('mq-1');
      expect(capturedArgs?.keysetId).toBe('ks-1');
      expect(capturedArgs?.paymentHash).toBe(fixturePaymentHash);
      expect(capturedArgs?.purpose).toBeUndefined();
      expect(capturedArgs?.transferId).toBeUndefined();
    });
  });

  describe('cashu.getSwapQuote', () => {
    it('passes the account and amount to the service with senderPaysFee true and returns its quote without calling getSession', async () => {
      let captured: Record<string, unknown> | undefined;
      let getSessionCalls = 0;
      const account = cashuDomain();
      const amount = sendSats(64);
      const swapQuote = makeSwapQuote();
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => {
          getSessionCalls += 1;
          return { isLoggedIn: false };
        },
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createSwapService: async () =>
          ({
            getQuote: (async (params: Record<string, unknown>) => {
              captured = params;
              return swapQuote;
            }) as unknown as CashuSendSwapService['getQuote'],
          }) as unknown as CashuSendSwapService,
      });

      const result = await api.cashu.getSwapQuote({ account, amount });

      expect(captured).toEqual({
        account,
        amount,
        senderPaysFee: true,
      });
      expect(captured?.account).toBe(account);
      expect(result).toBe(swapQuote);
      expect(getSessionCalls).toBe(0);
    });

    it('rejects with SessionEndedError and never calls the service when the session ends during service construction', async () => {
      const keys = createSessionKeys();
      let getQuoteCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createSwapService: async () => {
          // The session ends between the signal capture and the service call.
          keys.reset();
          return {
            getQuote: (async () => {
              getQuoteCalls += 1;
              return makeSwapQuote();
            }) as unknown as CashuSendSwapService['getQuote'],
          } as unknown as CashuSendSwapService;
        },
      });

      await expect(
        api.cashu.getSwapQuote({
          account: cashuDomain(),
          amount: sendSats(64),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(getQuoteCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the quote', async () => {
      const keys = createSessionKeys();
      const api = makeApi({
        session: loggedIn('user-x'),
        keys,
        swapService: {
          getQuote: (async () => {
            keys.reset();
            return makeSwapQuote();
          }) as unknown as CashuSendSwapService['getQuote'],
        },
      });

      await expect(
        api.cashu.getSwapQuote({
          account: cashuDomain(),
          amount: sendSats(64),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
    });

    it('propagates a service rejection as the same instance', async () => {
      const error = new DomainError(
        'Insufficient balance. Total amount including fees is 64 sats.',
      );
      const api = makeApi({
        session: loggedIn('user-x'),
        swapService: {
          getQuote: (async () => {
            throw error;
          }) as unknown as CashuSendSwapService['getQuote'],
        },
      });

      await expect(
        api.cashu.getSwapQuote({
          account: cashuDomain(),
          amount: sendSats(64),
        }),
      ).rejects.toBe(error);
    });

    it('builds the default service and quotes from the account proofs with no repository write and no account read', async () => {
      let createCalls = 0;
      let getCalls = 0;
      let getAccountRepositoryCalls = 0;
      const keys = createSessionKeys({
        readEncryptionPrivateKey: async () => new Uint8Array(32).fill(7),
        readEncryptionPublicKey: async () => 'pub',
      });
      const amount = sendSats(64);
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => {
          getAccountRepositoryCalls += 1;
          return {
            get: async () => {
              getCalls += 1;
              return null;
            },
          } as unknown as AccountRepository;
        },
        createSwapRepository: async () =>
          ({
            create: async (
              _args: Record<string, unknown>,
              _options?: { abortSignal?: AbortSignal },
            ) => {
              createCalls += 1;
              return makeSendSwap();
            },
          }) as unknown as CashuSendSwapRepository,
      });

      const quote = await api.cashu.getSwapQuote({
        account: cashuDomain({
          proofs: [sendProof],
          wallet: {
            selectProofsToSend: (proofs: Proof[]) => ({
              send: proofs,
              keep: [],
            }),
            getFeesForProofs: () => 0,
            getFeesEstimateToReceiveAtLeast: () => 0,
            get seed(): Uint8Array {
              throw new Error('wallet.seed must not be read');
            },
          },
        }),
        amount,
      });

      expect(quote.amountRequested).toBe(amount);
      expect(quote.senderPaysFee).toBe(true);
      expect(createCalls).toBe(0);
      expect(getCalls).toBe(0);
      expect(getAccountRepositoryCalls).toBe(1);
    });
  });

  describe('cashu.createSwap', () => {
    it('throws NoSessionError without a session, before any construction', async () => {
      let createSwapServiceCalls = 0;
      let createSwapRepositoryCalls = 0;
      let getAccountRepositoryCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => ({ isLoggedIn: false }),
        getAccountRepository: async () => {
          getAccountRepositoryCalls += 1;
          return {} as unknown as AccountRepository;
        },
        createSwapRepository: async () => {
          createSwapRepositoryCalls += 1;
          return {} as unknown as CashuSendSwapRepository;
        },
        createSwapService: async () => {
          createSwapServiceCalls += 1;
          return {} as unknown as CashuSendSwapService;
        },
      });

      await expect(
        api.cashu.createSwap({
          account: cashuDomain(),
          amount: sendSats(64),
        }),
      ).rejects.toBeInstanceOf(NoSessionError);
      expect(createSwapServiceCalls).toBe(0);
      expect(createSwapRepositoryCalls).toBe(0);
      expect(getAccountRepositoryCalls).toBe(0);
    });

    it('passes the session userId, the given account and amount, and the abort signal to the service, and returns only the swap', async () => {
      let captured: Record<string, unknown> | undefined;
      let capturedOptions: { abortSignal?: AbortSignal } | undefined;
      const keys = createSessionKeys();
      const account = cashuDomain();
      const amount = sendSats(64);
      const swap = makeSendSwap();
      const api = makeApi({
        session: loggedIn('user-x'),
        keys,
        swapService: {
          create: (async (
            params: Record<string, unknown>,
            options?: { abortSignal?: AbortSignal },
          ) => {
            captured = params;
            capturedOptions = options;
            return swap;
          }) as unknown as CashuSendSwapService['create'],
        },
      });

      const result = await api.cashu.createSwap({ account, amount });

      expect(captured).toEqual({
        userId: 'user-x',
        account,
        amount,
        senderPaysFee: true,
      });
      expect(captured?.account).toBe(account);
      expect(captured?.amount).toBe(amount);
      expect(capturedOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(result).toStrictEqual({ swap });
      expect(result.swap).toBe(swap);
      expect(Object.keys(result)).toEqual(['swap']);
    });

    it('always passes senderPaysFee true and no other fields', async () => {
      let captured: Record<string, unknown> | undefined;
      const api = makeApi({
        session: loggedIn('user-x'),
        swapService: {
          create: (async (params: Record<string, unknown>) => {
            captured = params;
            return makeSendSwap();
          }) as unknown as CashuSendSwapService['create'],
        },
      });

      await api.cashu.createSwap({
        account: cashuDomain(),
        amount: sendSats(64),
      });

      expect(Object.keys(captured ?? {}).sort()).toEqual([
        'account',
        'amount',
        'senderPaysFee',
        'userId',
      ]);
      expect(captured?.senderPaysFee).toBe(true);
    });

    it('rejects with SessionEndedError and never calls the service when the session ends during service construction', async () => {
      const keys = createSessionKeys();
      let createCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createSwapService: async () => {
          // The session ends between the signal capture and the write.
          keys.reset();
          return {
            create: (async () => {
              createCalls += 1;
              return makeSendSwap();
            }) as unknown as CashuSendSwapService['create'],
          } as unknown as CashuSendSwapService;
        },
      });

      await expect(
        api.cashu.createSwap({
          account: cashuDomain(),
          amount: sendSats(64),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(createCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the write', async () => {
      const keys = createSessionKeys();
      const api = makeApi({
        session: loggedIn('user-x'),
        keys,
        swapService: {
          create: (async () => {
            keys.reset();
            return makeSendSwap();
          }) as unknown as CashuSendSwapService['create'],
        },
      });

      await expect(
        api.cashu.createSwap({
          account: cashuDomain(),
          amount: sendSats(64),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
    });

    it('propagates a ConcurrencyError from the service as the same instance', async () => {
      const error = new ConcurrencyError('Proofs already reserved');
      const api = makeApi({
        session: loggedIn('user-x'),
        swapService: {
          create: (async () => {
            throw error;
          }) as unknown as CashuSendSwapService['create'],
        },
      });

      await expect(
        api.cashu.createSwap({
          account: cashuDomain(),
          amount: sendSats(64),
        }),
      ).rejects.toBe(error);
    });

    it('propagates a DomainError from the service as the same instance', async () => {
      const error = new DomainError(
        'Insufficient balance. Total amount including fees is 64 sats.',
      );
      const api = makeApi({
        session: loggedIn('user-x'),
        swapService: {
          create: (async () => {
            throw error;
          }) as unknown as CashuSendSwapService['create'],
        },
      });

      await expect(
        api.cashu.createSwap({
          account: cashuDomain(),
          amount: sendSats(64),
        }),
      ).rejects.toBe(error);
    });

    it('forwards the session abort signal to the repository through the default service without reading the cashu seed', async () => {
      let capturedArgs: Record<string, unknown> | undefined;
      let capturedOptions: { abortSignal?: AbortSignal } | undefined;
      const swap = makeSendSwap();
      let getAccountRepositoryCalls = 0;
      const keys = createSessionKeys({
        readEncryptionPrivateKey: async () => new Uint8Array(32).fill(7),
        readEncryptionPublicKey: async () => 'pub',
        readCashuSeed: async () => {
          throw new Error('cashu seed must not be read');
        },
      });
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => {
          getAccountRepositoryCalls += 1;
          return {
            get: async () => {
              throw new Error('accountRepository.get must not be called');
            },
          } as unknown as AccountRepository;
        },
        createSwapRepository: async () =>
          ({
            create: async (
              args: Record<string, unknown>,
              options?: { abortSignal?: AbortSignal },
            ) => {
              capturedArgs = args;
              capturedOptions = options;
              return swap;
            },
          }) as unknown as CashuSendSwapRepository,
      });

      const result = await api.cashu.createSwap({
        account: cashuDomain({
          proofs: [sendProof],
          wallet: exactProofsWallet,
        }),
        amount: sendSats(64),
      });

      expect(result.swap).toBe(swap);
      expect(capturedOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(capturedArgs?.userId).toBe('user-x');
      expect(capturedArgs?.accountId).toBe('acct-cashu');
      expect(typeof capturedArgs?.tokenHash).toBe('string');
      expect(String(capturedArgs?.tokenHash).length).toBeGreaterThan(0);
      expect(capturedArgs?.keysetId).toBeUndefined();
      expect(capturedArgs?.outputAmounts).toBeUndefined();
      expect(getAccountRepositoryCalls).toBe(1);
    });
  });

  describe('spark.getLightningQuote', () => {
    it('passes the account, payment request, and amount to the service and returns its quote without calling getSession', async () => {
      let captured: Record<string, unknown> | undefined;
      let getSessionCalls = 0;
      const account = sparkDomain();
      const amount = sendSats(50);
      const lightningQuote = makeSparkLightningQuote();
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => {
          getSessionCalls += 1;
          return { isLoggedIn: false };
        },
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createSparkService: async () =>
          ({
            getLightningSendQuote: (async (params: Record<string, unknown>) => {
              captured = params;
              return lightningQuote;
            }) as unknown as SparkSendQuoteService['getLightningSendQuote'],
          }) as unknown as SparkSendQuoteService,
      });

      const result = await api.spark.getLightningQuote({
        account,
        paymentRequest: fixtureInvoice,
        amount,
      });

      expect(captured).toEqual({
        account,
        paymentRequest: fixtureInvoice,
        amount,
      });
      expect(captured?.account).toBe(account);
      expect(captured?.amount).toBe(amount);
      expect(result).toBe(lightningQuote);
      expect(getSessionCalls).toBe(0);
    });

    it('rejects with SessionEndedError and never calls the service when the session ends during service construction', async () => {
      const keys = createSessionKeys();
      let getLightningSendQuoteCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createSparkService: async () => {
          // The session ends between the signal capture and the service call.
          keys.reset();
          return {
            getLightningSendQuote: (async () => {
              getLightningSendQuoteCalls += 1;
              return makeSparkLightningQuote();
            }) as unknown as SparkSendQuoteService['getLightningSendQuote'],
          } as unknown as SparkSendQuoteService;
        },
      });

      await expect(
        api.spark.getLightningQuote({
          account: sparkDomain(),
          paymentRequest: fixtureInvoice,
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(getLightningSendQuoteCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the quote', async () => {
      const keys = createSessionKeys();
      const api = makeApi({
        session: loggedIn('user-x'),
        keys,
        sparkService: {
          getLightningSendQuote: (async () => {
            keys.reset();
            return makeSparkLightningQuote();
          }) as unknown as SparkSendQuoteService['getLightningSendQuote'],
        },
      });

      await expect(
        api.spark.getLightningQuote({
          account: sparkDomain(),
          paymentRequest: fixtureInvoice,
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
    });

    it('propagates a service rejection as the same instance', async () => {
      const error = new DomainError('Invalid lightning invoice');
      const api = makeApi({
        session: loggedIn('user-x'),
        sparkService: {
          getLightningSendQuote: (async () => {
            throw error;
          }) as unknown as SparkSendQuoteService['getLightningSendQuote'],
        },
      });

      await expect(
        api.spark.getLightningQuote({
          account: sparkDomain(),
          paymentRequest: fixtureInvoice,
        }),
      ).rejects.toBe(error);
    });

    it('builds the default service and rejects an expired invoice with no wallet call', async () => {
      let prepareCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createSparkRepository: async () =>
          ({}) as unknown as SparkSendQuoteRepository,
      });
      const account = sparkDomain({
        wallet: {
          prepareSendPayment: async () => {
            prepareCalls += 1;
            return {
              paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 1 },
            };
          },
        },
      });

      const promise = api.spark.getLightningQuote({
        account,
        paymentRequest: fixtureInvoice,
      });

      await expect(promise).rejects.toBeInstanceOf(DomainError);
      await expect(promise).rejects.toThrow('Lightning invoice has expired');
      expect(prepareCalls).toBe(0);
    });
  });

  describe('spark.createQuote', () => {
    it('throws NoSessionError without a session, before any construction', async () => {
      let createSparkServiceCalls = 0;
      let createSparkRepositoryCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => ({ isLoggedIn: false }),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createSparkRepository: async () => {
          createSparkRepositoryCalls += 1;
          return {} as unknown as SparkSendQuoteRepository;
        },
        createSparkService: async () => {
          createSparkServiceCalls += 1;
          return {} as unknown as SparkSendQuoteService;
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
    });

    it('passes the session userId, the given account and quote, and the abort signal to the service, and returns only the transaction id', async () => {
      let captured: Record<string, unknown> | undefined;
      let capturedOptions: { abortSignal?: AbortSignal } | undefined;
      const keys = createSessionKeys();
      const account = sparkDomain();
      const lightningQuote = makeSparkLightningQuote();
      const api = makeApi({
        session: loggedIn('user-x'),
        keys,
        sparkService: {
          createSendQuote: (async (
            params: Record<string, unknown>,
            options?: { abortSignal?: AbortSignal },
          ) => {
            captured = params;
            capturedOptions = options;
            return makeSparkSendQuote();
          }) as unknown as SparkSendQuoteService['createSendQuote'],
        },
      });

      const result = await api.spark.createQuote({
        account,
        lightningQuote,
      });

      expect(captured).toEqual({
        userId: 'user-x',
        account,
        quote: lightningQuote,
      });
      expect(captured?.account).toBe(account);
      expect(captured?.quote).toBe(lightningQuote);
      expect(Object.keys(captured ?? {}).sort()).toEqual([
        'account',
        'quote',
        'userId',
      ]);
      expect(capturedOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(result).toStrictEqual({ transactionId: 'tx-spark-1' });
      expect(Object.keys(result)).toEqual(['transactionId']);
    });

    it('rejects with SessionEndedError and never calls the service when the session ends during service construction', async () => {
      const keys = createSessionKeys();
      let createSendQuoteCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createSparkService: async () => {
          // The session ends between the signal capture and the write.
          keys.reset();
          return {
            createSendQuote: (async () => {
              createSendQuoteCalls += 1;
              return makeSparkSendQuote();
            }) as unknown as SparkSendQuoteService['createSendQuote'],
          } as unknown as SparkSendQuoteService;
        },
      });

      await expect(
        api.spark.createQuote({
          account: sparkDomain(),
          lightningQuote: makeSparkLightningQuote(),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(createSendQuoteCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the write', async () => {
      const keys = createSessionKeys();
      const api = makeApi({
        session: loggedIn('user-x'),
        keys,
        sparkService: {
          createSendQuote: (async () => {
            keys.reset();
            return makeSparkSendQuote();
          }) as unknown as SparkSendQuoteService['createSendQuote'],
        },
      });

      await expect(
        api.spark.createQuote({
          account: sparkDomain(),
          lightningQuote: makeSparkLightningQuote(),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
    });

    it('propagates a DomainError from the service as the same instance', async () => {
      const error = new DomainError(
        'A payment for this invoice is already being processed or was completed',
      );
      const api = makeApi({
        session: loggedIn('user-x'),
        sparkService: {
          createSendQuote: (async () => {
            throw error;
          }) as unknown as SparkSendQuoteService['createSendQuote'],
        },
      });

      await expect(
        api.spark.createQuote({
          account: sparkDomain(),
          lightningQuote: makeSparkLightningQuote(),
        }),
      ).rejects.toBe(error);
    });

    it('forwards the session abort signal to the repository through the default service without reading the spark mnemonic', async () => {
      let capturedArgs: Record<string, unknown> | undefined;
      let capturedOptions: { abortSignal?: AbortSignal } | undefined;
      const keys = createSessionKeys({
        readSparkMnemonic: async () => {
          throw new Error('spark mnemonic must not be read');
        },
      });
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createSparkRepository: async () =>
          ({
            create: async (
              args: Record<string, unknown>,
              options?: { abortSignal?: AbortSignal },
            ) => {
              capturedArgs = args;
              capturedOptions = options;
              return makeSparkSendQuote();
            },
          }) as unknown as SparkSendQuoteRepository,
      });
      const account = sparkDomain({
        wallet: {
          prepareSendPayment: async () => {
            throw new Error('wallet must not be called on create');
          },
        },
      });
      const lightningQuote = makeSparkLightningQuote();

      const result = await api.spark.createQuote({
        account,
        lightningQuote,
      });

      expect(result).toStrictEqual({ transactionId: 'tx-spark-1' });
      expect(capturedOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(capturedArgs?.userId).toBe('user-x');
      expect(capturedArgs?.accountId).toBe('acct-spark');
      expect(capturedArgs?.paymentHash).toBe(fixturePaymentHash);
      expect(capturedArgs?.purpose).toBeUndefined();
      expect(capturedArgs?.transferId).toBeUndefined();
    });

    it('rejects an expired quote through the default service with no write', async () => {
      let createCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createSparkRepository: async () =>
          ({
            create: async () => {
              createCalls += 1;
              return makeSparkSendQuote();
            },
          }) as unknown as SparkSendQuoteRepository,
      });
      const lightningQuote = {
        ...makeSparkLightningQuote(),
        expiresAt: new Date(Date.now() - 60_000),
      } as unknown as SparkLightningQuote;

      const promise = api.spark.createQuote({
        account: sparkDomain(),
        lightningQuote,
      });

      await expect(promise).rejects.toBeInstanceOf(DomainError);
      await expect(promise).rejects.toThrow('Lightning invoice has expired');
      expect(createCalls).toBe(0);
    });

    it('rejects insufficient balance through the default service with no write', async () => {
      let createCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => ({}) as unknown as AccountRepository,
        createSparkRepository: async () =>
          ({
            create: async () => {
              createCalls += 1;
              return makeSparkSendQuote();
            },
          }) as unknown as SparkSendQuoteRepository,
      });

      const promise = api.spark.createQuote({
        account: sparkDomain({ balance: sats(10) }),
        lightningQuote: makeSparkLightningQuote(),
      });

      await expect(promise).rejects.toBeInstanceOf(DomainError);
      await expect(promise).rejects.toThrow('Insufficient balance');
      expect(createCalls).toBe(0);
    });
  });

  describe('unimplemented members', () => {
    it('throws NotImplementedError on access to members owned by later slices', () => {
      const api = makeApi({ session: loggedIn('user-x') });

      expect(() => api.resolveDestination).toThrow(NotImplementedError);
      expect(() => api.resolveDestination).toThrow(
        'send.resolveDestination is not implemented yet.',
      );
      expect(typeof api.cashu.getSwapQuote).toBe('function');
      expect(typeof api.cashu.createSwap).toBe('function');
      expect(typeof api.spark.getLightningQuote).toBe('function');
      expect(typeof api.spark.createQuote).toBe('function');
    });

    it('does no construction or session work when built or when unimplemented members are accessed', () => {
      let createRepositoryCalls = 0;
      let createServiceCalls = 0;
      let createSwapRepositoryCalls = 0;
      let createSwapServiceCalls = 0;
      let createSparkRepositoryCalls = 0;
      let createSparkServiceCalls = 0;
      let getSessionCalls = 0;
      let getAccountRepositoryCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => {
          getSessionCalls += 1;
          return loggedIn('user-x');
        },
        getAccountRepository: async () => {
          getAccountRepositoryCalls += 1;
          return {} as unknown as AccountRepository;
        },
        createRepository: async () => {
          createRepositoryCalls += 1;
          return {} as unknown as CashuSendQuoteRepository;
        },
        createService: async () => {
          createServiceCalls += 1;
          return {} as unknown as CashuSendQuoteService;
        },
        createSwapRepository: async () => {
          createSwapRepositoryCalls += 1;
          return {} as unknown as CashuSendSwapRepository;
        },
        createSwapService: async () => {
          createSwapServiceCalls += 1;
          return {} as unknown as CashuSendSwapService;
        },
        createSparkRepository: async () => {
          createSparkRepositoryCalls += 1;
          return {} as unknown as SparkSendQuoteRepository;
        },
        createSparkService: async () => {
          createSparkServiceCalls += 1;
          return {} as unknown as SparkSendQuoteService;
        },
      });

      const cashu = api.cashu;
      expect(typeof cashu.getLightningQuote).toBe('function');
      expect(typeof cashu.getSwapQuote).toBe('function');
      expect(typeof cashu.createSwap).toBe('function');
      const spark = api.spark;
      expect(typeof spark.getLightningQuote).toBe('function');
      expect(typeof spark.createQuote).toBe('function');
      expect(() => api.resolveDestination).toThrow(NotImplementedError);
      expect(createRepositoryCalls).toBe(0);
      expect(createServiceCalls).toBe(0);
      expect(createSwapRepositoryCalls).toBe(0);
      expect(createSwapServiceCalls).toBe(0);
      expect(createSparkRepositoryCalls).toBe(0);
      expect(createSparkServiceCalls).toBe(0);
      expect(getSessionCalls).toBe(0);
      expect(getAccountRepositoryCalls).toBe(0);
    });
  });
});
