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
import type { CashuAccount as DomainCashuAccount } from '../accounts/account';
import type { AuthSession, AuthUser } from '../sdk';
import { createSessionKeys } from '../sdk/session-keys';
import type { CashuSendQuote } from './cashu-send-quote';
import type { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import type {
  CashuLightningQuote,
  CashuSendQuoteService,
} from './cashu-send-quote-service';
import { createSendApi } from './send-api';
import type { DestinationDetails } from './send-destination';

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

const makeApi = (deps: {
  session: AuthSession;
  keys?: ReturnType<typeof createSessionKeys>;
  repository?: Partial<CashuSendQuoteRepository>;
  service?: Partial<CashuSendQuoteService>;
}) =>
  createSendApi({
    db: {} as unknown as AgicashDb,
    keys: deps.keys ?? createSessionKeys(),
    getSession: () => deps.session,
    createRepository: async () =>
      (deps.repository ?? {}) as unknown as CashuSendQuoteRepository,
    createService: async () =>
      (deps.service ?? {}) as unknown as CashuSendQuoteService,
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

  describe('unimplemented members', () => {
    it('throws NotImplementedError on access to members owned by later slices', () => {
      const api = makeApi({ session: loggedIn('user-x') });

      expect(() => api.resolveDestination).toThrow(NotImplementedError);
      expect(() => api.resolveDestination).toThrow(
        'send.resolveDestination is not implemented yet.',
      );
      expect(() => api.cashu.getSwapQuote).toThrow(NotImplementedError);
      expect(() => api.cashu.getSwapQuote).toThrow(
        'send.cashu.getSwapQuote is not implemented yet.',
      );
      expect(() => api.cashu.createSwap).toThrow(NotImplementedError);
      expect(() => api.cashu.createSwap).toThrow(
        'send.cashu.createSwap is not implemented yet.',
      );
      expect(() => api.spark).toThrow(NotImplementedError);
      expect(() => api.spark).toThrow('send.spark is not implemented yet.');
    });

    it('does no construction or session work when built or when unimplemented members are accessed', () => {
      let createRepositoryCalls = 0;
      let createServiceCalls = 0;
      let getSessionCalls = 0;
      const api = createSendApi({
        db: {} as unknown as AgicashDb,
        keys: createSessionKeys(),
        getSession: () => {
          getSessionCalls += 1;
          return loggedIn('user-x');
        },
        createRepository: async () => {
          createRepositoryCalls += 1;
          return {} as unknown as CashuSendQuoteRepository;
        },
        createService: async () => {
          createServiceCalls += 1;
          return {} as unknown as CashuSendQuoteService;
        },
      });

      const cashu = api.cashu;
      expect(typeof cashu.getLightningQuote).toBe('function');
      expect(() => api.resolveDestination).toThrow(NotImplementedError);
      expect(() => cashu.getSwapQuote).toThrow(NotImplementedError);
      expect(() => cashu.createSwap).toThrow(NotImplementedError);
      expect(() => api.spark).toThrow(NotImplementedError);
      expect(createRepositoryCalls).toBe(0);
      expect(createServiceCalls).toBe(0);
      expect(getSessionCalls).toBe(0);
    });
  });
});
