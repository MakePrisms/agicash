import { describe, expect, it, spyOn } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import type { Proof } from '@cashu/cashu-ts';
import type { AgicashDb } from '../../db/database';
import { BASE_CASHU_LOCKING_DERIVATION_PATH } from '../../lib/cashu';
import { derivePublicKey } from '../../lib/cryptography';
import {
  DomainError,
  NoSessionError,
  SessionEndedError,
} from '../../lib/error';
import type { Account, SparkAccount } from '../accounts/account';
import type { AccountRepository } from '../accounts/account-repository';
import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import type { CashuReceiveLightningQuote } from '../receive/cashu-receive-quote-core';
import type { CashuReceiveQuoteRepository } from '../receive/cashu-receive-quote-repository';
import type { CashuReceiveQuoteService } from '../receive/cashu-receive-quote-service';
import type { SparkReceiveQuote } from '../receive/spark-receive-quote';
import type { SparkReceiveLightningQuote } from '../receive/spark-receive-quote-core';
import type { SparkReceiveQuoteRepository } from '../receive/spark-receive-quote-repository';
import type { SparkReceiveQuoteService } from '../receive/spark-receive-quote-service';
import type { AuthSession, AuthUser } from '../sdk';
import { createSessionKeys } from '../sdk/session-keys';
import type { CashuSendQuoteRepository } from '../send/cashu-send-quote-repository';
import type {
  CashuLightningQuote,
  CashuSendQuoteService,
} from '../send/cashu-send-quote-service';
import type { SparkSendQuoteRepository } from '../send/spark-send-quote-repository';
import type {
  SparkLightningQuote,
  SparkSendQuoteService,
} from '../send/spark-send-quote-service';
import { createTransferApi } from './transfer-api';
import type { TransferQuote, TransferService } from './transfer-service';

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

const loggedOut = (): AuthSession => ({ isLoggedIn: false });

const sats = (amount: number): Money<Currency> =>
  new Money<Currency>({ amount, currency: 'BTC', unit: 'sat' });

const db = {} as unknown as AgicashDb;

const emptyAccountRepository = async () => ({}) as unknown as AccountRepository;

const fixtureInvoice =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

const makeApi = (deps: {
  session: AuthSession;
  keys?: ReturnType<typeof createSessionKeys>;
  service?: Partial<TransferService>;
}) =>
  createTransferApi({
    db,
    keys: deps.keys ?? createSessionKeys(),
    getSession: () => deps.session,
    getAccountRepository: emptyAccountRepository,
    ...(deps.service
      ? {
          createService: async () => deps.service as unknown as TransferService,
        }
      : {}),
  });

const unusedRepo = (name: string) => ({
  create: async () => {
    throw new Error(`${name} create must not be called`);
  },
  fail: async () => {
    throw new Error(`${name} fail must not be called`);
  },
});

const cashuSendAccount = (id: string): Account =>
  ({
    id,
    type: 'cashu',
    currency: 'BTC',
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
    },
  }) as unknown as Account;

const cashuReceiveLightning = (): CashuReceiveLightningQuote =>
  ({
    mintQuote: {
      quote: 'mint-quote-1',
      request: 'lnbc100n1payme',
      state: 'UNPAID',
    },
    lockingPublicKey: '02abc',
    fullLockingDerivationPath: "m/129372'/0'/0'/4321",
    expiresAt: '2026-01-01T01:00:00Z',
    amount: sats(100),
    paymentHash: 'payment-hash-1',
  }) as unknown as CashuReceiveLightningQuote;

const cashuSendLightning = (): CashuLightningQuote =>
  ({
    paymentRequest: fixtureInvoice,
    amountRequested: sats(50),
    amountRequestedInBtc: sats(50),
    meltQuote: {
      quote: 'mq-1',
      amount: 50,
      fee_reserve: 2,
      expiry: Math.floor(Date.now() / 1000) + 600,
    },
  }) as unknown as CashuLightningQuote;

const sparkReceiveLightning = (): SparkReceiveLightningQuote =>
  ({
    id: 'receive-request-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    invoice: {
      paymentRequest: 'lnbc100n1payme',
      paymentHash: 'payment-hash-1',
      amount: sats(100),
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-01-01T01:00:00Z',
      memo: 'test receive',
    },
    status: 'created',
    receiverIdentityPublicKey: '02abc',
  }) as unknown as SparkReceiveLightningQuote;

const sparkSendLightning = (): SparkLightningQuote =>
  ({
    paymentRequest: fixtureInvoice,
    paymentHash:
      '0001020304050607080900010203040506070809000102030405060708090102',
    amountRequested: sats(50),
    amountRequestedInBtc: sats(50),
    amountToReceive: sats(50),
    estimatedLightningFee: sats(2),
    estimatedTotalFee: sats(2),
    estimatedTotalAmount: sats(52),
    paymentRequestIsAmountless: false,
    expiresAt: null,
  }) as unknown as SparkLightningQuote;

const sparkAccount = (
  id: string,
  balance: Money<Currency> = sats(1000),
): SparkAccount =>
  ({
    id,
    type: 'spark',
    currency: 'BTC',
    balance,
  }) as unknown as SparkAccount;

describe('createTransferApi', () => {
  describe('getQuote', () => {
    it('passes source, destination, and amount to the service and returns its quote without calling getSession', async () => {
      let capturedArgs: unknown[] | undefined;
      let getSessionCalls = 0;
      const sourceAccount = { id: 'src' } as Account;
      const destinationAccount = { id: 'dst' } as Account;
      const amount = sats(25);
      const quote = { marker: 'quote' } as unknown as TransferQuote;
      const api = createTransferApi({
        db,
        keys: createSessionKeys(),
        getSession: () => {
          getSessionCalls += 1;
          return loggedOut();
        },
        getAccountRepository: emptyAccountRepository,
        createService: async () =>
          ({
            getTransferQuote: (async (...args: unknown[]) => {
              capturedArgs = args;
              return quote;
            }) as unknown as TransferService['getTransferQuote'],
          }) as unknown as TransferService,
      });

      const result = await api.getQuote({
        sourceAccount,
        destinationAccount,
        amount,
      });

      const captured = capturedArgs?.[0] as
        | {
            sourceAccount?: Account;
            destinationAccount?: Account;
            amount?: Money;
          }
        | undefined;
      expect(capturedArgs?.length).toBe(1);
      expect(captured).toEqual({ sourceAccount, destinationAccount, amount });
      expect(captured?.sourceAccount).toBe(sourceAccount);
      expect(result).toBe(quote);
      expect(getSessionCalls).toBe(0);
    });

    it('rejects with SessionEndedError and never calls the service when the session ends during service construction', async () => {
      const keys = createSessionKeys();
      let getTransferQuoteCalls = 0;
      const api = createTransferApi({
        db,
        keys,
        getSession: () => loggedOut(),
        getAccountRepository: emptyAccountRepository,
        createService: async () => {
          keys.reset();
          return {
            getTransferQuote: (async () => {
              getTransferQuoteCalls += 1;
              return { marker: 'quote' };
            }) as unknown as TransferService['getTransferQuote'],
          } as unknown as TransferService;
        },
      });

      await expect(
        api.getQuote({
          sourceAccount: { id: 'src' } as Account,
          destinationAccount: { id: 'dst' } as Account,
          amount: sats(25),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(getTransferQuoteCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the quote', async () => {
      const keys = createSessionKeys();
      const api = makeApi({
        session: loggedOut(),
        keys,
        service: {
          getTransferQuote: (async () => {
            keys.reset();
            return { marker: 'quote' };
          }) as unknown as TransferService['getTransferQuote'],
        },
      });

      await expect(
        api.getQuote({
          sourceAccount: { id: 'src' } as Account,
          destinationAccount: { id: 'dst' } as Account,
          amount: sats(25),
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
    });

    it('propagates a DomainError from the service as the same instance', async () => {
      const error = new DomainError(
        'Testnut BTC cannot send Lightning payments',
      );
      const api = makeApi({
        session: loggedOut(),
        service: {
          getTransferQuote: (async () => {
            throw error;
          }) as unknown as TransferService['getTransferQuote'],
        },
      });

      await expect(
        api.getQuote({
          sourceAccount: { id: 'src' } as Account,
          destinationAccount: { id: 'dst' } as Account,
          amount: sats(25),
        }),
      ).rejects.toBe(error);
    });

    it('builds the default services and rejects a test mint without reading the seed or mnemonic', async () => {
      let privateKeyReads = 0;
      let publicKeyReads = 0;
      let seedReads = 0;
      let mnemonicReads = 0;
      let accountRepositoryCalls = 0;
      const keys = createSessionKeys({
        readEncryptionPrivateKey: async () => {
          privateKeyReads += 1;
          return new Uint8Array(32).fill(7);
        },
        readEncryptionPublicKey: async () => {
          publicKeyReads += 1;
          return 'pub';
        },
        readCashuSeed: async () => {
          seedReads += 1;
          throw new Error('cashu seed must not be read');
        },
        readSparkMnemonic: async () => {
          mnemonicReads += 1;
          throw new Error('spark mnemonic must not be read');
        },
      });
      await keys.getEncryption();
      const api = createTransferApi({
        db,
        keys,
        getSession: () => loggedOut(),
        getAccountRepository: async () => {
          accountRepositoryCalls += 1;
          return {} as unknown as AccountRepository;
        },
      });
      const sourceAccount = {
        type: 'cashu',
        name: 'Testnut BTC',
        isTestMint: true,
      } as Account;

      const promise = api.getQuote({
        sourceAccount,
        destinationAccount: { type: 'spark', name: 'dest' } as Account,
        amount: sats(25),
      });

      await expect(promise).rejects.toBeInstanceOf(DomainError);
      await expect(promise).rejects.toThrow(
        'Testnut BTC cannot send Lightning payments',
      );
      expect(privateKeyReads).toBe(1);
      expect(publicKeyReads).toBe(1);
      expect(seedReads).toBe(0);
      expect(mnemonicReads).toBe(0);
      expect(accountRepositoryCalls).toBeLessThanOrEqual(1);
    });

    it('locks the mint quote to a key derived from the session cashu locking xpub', async () => {
      let recordedPubkey: string | undefined;
      let capturedPaymentRequest: string | undefined;
      const keys = createSessionKeys({
        readEncryptionPrivateKey: async () => new Uint8Array(32).fill(7),
        readEncryptionPublicKey: async () => 'pub',
        readCashuSeed: async () => new Uint8Array(64).fill(7),
        readSparkMnemonic: async () => {
          throw new Error('spark mnemonic must not be read');
        },
      });
      const wallet = {
        getMintInfo: () => ({
          isSupported: (_nut: number) => ({ disabled: false }),
        }),
        createLockedMintQuote: async (
          amount: number,
          pubkey: string,
          description?: string,
        ) => {
          recordedPubkey = pubkey;
          return {
            quote: 'mint-quote-parity',
            request: fixtureInvoice,
            state: 'UNPAID',
            expiry: 1767229200,
            pubkey,
            amount,
            unit: 'sat',
            description,
          };
        },
      };
      const marker = {
        amountToReceive: sats(100),
        estimatedTotalFee: sats(0),
      } as unknown as SparkLightningQuote;
      const api = createTransferApi({
        db,
        keys,
        getSession: () => loggedOut(),
        getAccountRepository: emptyAccountRepository,
        createSparkSendService: async () =>
          ({
            getLightningSendQuote: (async (params: {
              paymentRequest: string;
            }) => {
              capturedPaymentRequest = params.paymentRequest;
              return marker;
            }) as unknown as SparkSendQuoteService['getLightningSendQuote'],
          }) as unknown as SparkSendQuoteService,
      });

      const result = await api.getQuote({
        sourceAccount: { type: 'spark', name: 'Bitcoin' } as Account,
        destinationAccount: {
          type: 'cashu',
          name: 'Gift card',
          isTestMint: false,
          isOnline: true,
          wallet,
        } as unknown as Account,
        amount: sats(100),
      });

      if (result.receive.account.type !== 'cashu') {
        throw new Error('expected cashu destination');
      }
      const lightningQuote = result.receive
        .lightningQuote as CashuReceiveLightningQuote;
      expect(
        lightningQuote.fullLockingDerivationPath.startsWith(
          BASE_CASHU_LOCKING_DERIVATION_PATH,
        ),
      ).toBe(true);
      const unhardenedIndex = lightningQuote.fullLockingDerivationPath
        .split('/')
        .pop();
      expect(recordedPubkey).toBe(
        derivePublicKey(
          await keys.getCashuLockingXpub(),
          `m/${unhardenedIndex}`,
        ),
      );
      expect(capturedPaymentRequest).toBe(lightningQuote.mintQuote.request);
    });
  });

  describe('initiate', () => {
    it('throws NoSessionError without a session, before any construction', async () => {
      let createServiceCalls = 0;
      let cashuReceiveServiceCalls = 0;
      let sparkReceiveServiceCalls = 0;
      let cashuSendServiceCalls = 0;
      let sparkSendServiceCalls = 0;
      const api = createTransferApi({
        db,
        keys: createSessionKeys(),
        getSession: () => loggedOut(),
        getAccountRepository: emptyAccountRepository,
        createService: async () => {
          createServiceCalls += 1;
          return {} as unknown as TransferService;
        },
        createCashuReceiveService: async () => {
          cashuReceiveServiceCalls += 1;
          return {} as unknown as CashuReceiveQuoteService;
        },
        createSparkReceiveService: async () => {
          sparkReceiveServiceCalls += 1;
          return {} as unknown as SparkReceiveQuoteService;
        },
        createCashuSendService: async () => {
          cashuSendServiceCalls += 1;
          return {} as unknown as CashuSendQuoteService;
        },
        createSparkSendService: async () => {
          sparkSendServiceCalls += 1;
          return {} as unknown as SparkSendQuoteService;
        },
      });

      await expect(
        api.initiate({
          quote: { marker: 'quote' } as unknown as TransferQuote,
        }),
      ).rejects.toBeInstanceOf(NoSessionError);
      expect(createServiceCalls).toBe(0);
      expect(cashuReceiveServiceCalls).toBe(0);
      expect(sparkReceiveServiceCalls).toBe(0);
      expect(cashuSendServiceCalls).toBe(0);
      expect(sparkSendServiceCalls).toBe(0);
    });

    it('passes the session userId and quote and the abort signal, and returns the three ids', async () => {
      let captured: Record<string, unknown> | undefined;
      let capturedOptions: { abortSignal?: AbortSignal } | undefined;
      const keys = createSessionKeys();
      const quote = { marker: 'quote' } as unknown as TransferQuote;
      const api = makeApi({
        session: loggedIn('user-x'),
        keys,
        service: {
          initiateTransfer: (async (
            params: Record<string, unknown>,
            options?: { abortSignal?: AbortSignal },
          ) => {
            captured = params;
            capturedOptions = options;
            return {
              transferId: 'tid-1',
              receiveTransactionId: 'tx-recv',
              sendTransactionId: 'tx-send',
            };
          }) as unknown as TransferService['initiateTransfer'],
        },
      });

      const result = await api.initiate({ quote });

      expect(captured).toEqual({ userId: 'user-x', quote });
      expect(captured?.quote).toBe(quote);
      expect(Object.keys(captured ?? {}).sort()).toEqual(['quote', 'userId']);
      expect(capturedOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(result).toStrictEqual({
        transferId: 'tid-1',
        receiveTransactionId: 'tx-recv',
        sendTransactionId: 'tx-send',
      });
      expect(Object.keys(result).sort()).toEqual([
        'receiveTransactionId',
        'sendTransactionId',
        'transferId',
      ]);
    });

    it('rejects with SessionEndedError and never calls the service when the session ends during service construction', async () => {
      const keys = createSessionKeys();
      let initiateCalls = 0;
      const api = createTransferApi({
        db,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: emptyAccountRepository,
        createService: async () => {
          keys.reset();
          return {
            initiateTransfer: (async () => {
              initiateCalls += 1;
              return {
                transferId: 'tid-1',
                receiveTransactionId: 'tx-recv',
                sendTransactionId: 'tx-send',
              };
            }) as unknown as TransferService['initiateTransfer'],
          } as unknown as TransferService;
        },
      });

      await expect(
        api.initiate({
          quote: { marker: 'quote' } as unknown as TransferQuote,
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(initiateCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the write', async () => {
      const keys = createSessionKeys();
      const api = makeApi({
        session: loggedIn('user-x'),
        keys,
        service: {
          initiateTransfer: (async () => {
            keys.reset();
            return {
              transferId: 'tid-1',
              receiveTransactionId: 'tx-recv',
              sendTransactionId: 'tx-send',
            };
          }) as unknown as TransferService['initiateTransfer'],
        },
      });

      await expect(
        api.initiate({
          quote: { marker: 'quote' } as unknown as TransferQuote,
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
    });

    it('propagates a DomainError from the service as the same instance', async () => {
      const error = new DomainError('boom');
      const api = makeApi({
        session: loggedIn('user-x'),
        service: {
          initiateTransfer: (async () => {
            throw error;
          }) as unknown as TransferService['initiateTransfer'],
        },
      });

      await expect(
        api.initiate({
          quote: { marker: 'quote' } as unknown as TransferQuote,
        }),
      ).rejects.toBe(error);
    });

    it('persists both cashu quotes with purpose TRANSFER, one transferId, and the session signal', async () => {
      let receiveParams: Record<string, unknown> | undefined;
      let receiveOptions: { abortSignal?: AbortSignal } | undefined;
      let sendParams: Record<string, unknown> | undefined;
      let sendOptions: { abortSignal?: AbortSignal } | undefined;
      let failCalls = 0;
      let sparkReceiveCreates = 0;
      let sparkSendCreates = 0;
      const keys = createSessionKeys({
        readCashuSeed: async () => {
          throw new Error('cashu seed must not be read');
        },
        readSparkMnemonic: async () => {
          throw new Error('spark mnemonic must not be read');
        },
      });
      const dst = { type: 'cashu', id: 'acct-dst' } as Account;
      const src = { type: 'cashu', id: 'acct-src' } as Account;
      const recvMarker = { marker: 'recv' };
      const paymentRequest = { marker: 'payment-request' };
      const amountRequested = { marker: 'amount-requested' };
      const amountRequestedInBtc = { marker: 'amount-btc' };
      const meltQuote = { marker: 'melt' };
      const sendMarker = {
        paymentRequest,
        amountRequested,
        amountRequestedInBtc,
        meltQuote,
      };
      const quote = {
        receive: { account: dst, lightningQuote: recvMarker },
        send: { account: src, lightningQuote: sendMarker },
      } as unknown as TransferQuote;
      const api = createTransferApi({
        db,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => {
          throw new Error('getAccountRepository must not be called');
        },
        createCashuReceiveService: async () =>
          ({
            createReceiveQuote: (async (
              params: Record<string, unknown>,
              options?: { abortSignal?: AbortSignal },
            ) => {
              receiveParams = params;
              receiveOptions = options;
              return { transactionId: 'tx-recv' } as CashuReceiveQuote;
            }) as unknown as CashuReceiveQuoteService['createReceiveQuote'],
            fail: (async () => {
              failCalls += 1;
            }) as unknown as CashuReceiveQuoteService['fail'],
          }) as unknown as CashuReceiveQuoteService,
        createCashuSendService: async () =>
          ({
            createSendQuote: (async (
              params: Record<string, unknown>,
              options?: { abortSignal?: AbortSignal },
            ) => {
              sendParams = params;
              sendOptions = options;
              return { transactionId: 'tx-send' };
            }) as unknown as CashuSendQuoteService['createSendQuote'],
          }) as unknown as CashuSendQuoteService,
        createSparkReceiveService: async () =>
          ({
            createReceiveQuote: (async () => {
              sparkReceiveCreates += 1;
              throw new Error('spark receive create must not be called');
            }) as unknown as SparkReceiveQuoteService['createReceiveQuote'],
          }) as unknown as SparkReceiveQuoteService,
        createSparkSendService: async () =>
          ({
            createSendQuote: (async () => {
              sparkSendCreates += 1;
              throw new Error('spark send create must not be called');
            }) as unknown as SparkSendQuoteService['createSendQuote'],
          }) as unknown as SparkSendQuoteService,
      });

      const result = await api.initiate({ quote });
      const sendQuote = sendParams?.sendQuote as
        | Record<string, unknown>
        | undefined;

      expect(receiveParams?.userId).toBe('user-x');
      expect(sendParams?.userId).toBe('user-x');
      expect(receiveParams?.purpose).toBe('TRANSFER');
      expect(sendParams?.purpose).toBe('TRANSFER');
      expect(typeof receiveParams?.transferId).toBe('string');
      expect(sendParams?.transferId).toBe(receiveParams?.transferId);
      expect(result.transferId).toBe(receiveParams?.transferId as string);
      expect(receiveOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(sendOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(receiveParams?.account).toBe(dst);
      expect(receiveParams?.lightningQuote).toBe(recvMarker);
      expect(receiveParams?.receiveType).toBe('LIGHTNING');
      expect(sendParams?.account).toBe(src);
      expect(sendQuote?.paymentRequest).toBe(paymentRequest);
      expect(sendQuote?.amountRequested).toBe(amountRequested);
      expect(sendQuote?.amountRequestedInBtc).toBe(amountRequestedInBtc);
      expect(sendQuote?.meltQuote).toBe(meltQuote);
      expect(result).toEqual({
        transferId: receiveParams?.transferId as string,
        receiveTransactionId: 'tx-recv',
        sendTransactionId: 'tx-send',
      });
      expect(sparkReceiveCreates).toBe(0);
      expect(sparkSendCreates).toBe(0);
      expect(failCalls).toBe(0);
    });

    it('persists both spark quotes with purpose TRANSFER, one transferId, and the session signal', async () => {
      let receiveParams: Record<string, unknown> | undefined;
      let receiveOptions: { abortSignal?: AbortSignal } | undefined;
      let sendParams: Record<string, unknown> | undefined;
      let sendOptions: { abortSignal?: AbortSignal } | undefined;
      let failCalls = 0;
      let cashuReceiveCreates = 0;
      let cashuSendCreates = 0;
      const keys = createSessionKeys({
        readCashuSeed: async () => {
          throw new Error('cashu seed must not be read');
        },
        readSparkMnemonic: async () => {
          throw new Error('spark mnemonic must not be read');
        },
      });
      const dst = { type: 'spark', id: 'acct-dst' } as Account;
      const src = { type: 'spark', id: 'acct-src' } as Account;
      const recvMarker = { marker: 'recv' };
      const sendMarker = { marker: 'send' };
      const quote = {
        receive: { account: dst, lightningQuote: recvMarker },
        send: { account: src, lightningQuote: sendMarker },
      } as unknown as TransferQuote;
      const api = createTransferApi({
        db,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => {
          throw new Error('getAccountRepository must not be called');
        },
        createSparkReceiveService: async () =>
          ({
            createReceiveQuote: (async (
              params: Record<string, unknown>,
              options?: { abortSignal?: AbortSignal },
            ) => {
              receiveParams = params;
              receiveOptions = options;
              return { transactionId: 'tx-recv' } as SparkReceiveQuote;
            }) as unknown as SparkReceiveQuoteService['createReceiveQuote'],
            fail: (async () => {
              failCalls += 1;
            }) as unknown as SparkReceiveQuoteService['fail'],
          }) as unknown as SparkReceiveQuoteService,
        createSparkSendService: async () =>
          ({
            createSendQuote: (async (
              params: Record<string, unknown>,
              options?: { abortSignal?: AbortSignal },
            ) => {
              sendParams = params;
              sendOptions = options;
              return { transactionId: 'tx-send' };
            }) as unknown as SparkSendQuoteService['createSendQuote'],
          }) as unknown as SparkSendQuoteService,
        createCashuReceiveService: async () =>
          ({
            createReceiveQuote: (async () => {
              cashuReceiveCreates += 1;
              throw new Error('cashu receive create must not be called');
            }) as unknown as CashuReceiveQuoteService['createReceiveQuote'],
          }) as unknown as CashuReceiveQuoteService,
        createCashuSendService: async () =>
          ({
            createSendQuote: (async () => {
              cashuSendCreates += 1;
              throw new Error('cashu send create must not be called');
            }) as unknown as CashuSendQuoteService['createSendQuote'],
          }) as unknown as CashuSendQuoteService,
      });

      const result = await api.initiate({ quote });

      expect(receiveParams?.userId).toBe('user-x');
      expect(sendParams?.userId).toBe('user-x');
      expect(receiveParams?.purpose).toBe('TRANSFER');
      expect(sendParams?.purpose).toBe('TRANSFER');
      expect(typeof receiveParams?.transferId).toBe('string');
      expect(sendParams?.transferId).toBe(receiveParams?.transferId);
      expect(result.transferId).toBe(receiveParams?.transferId as string);
      expect(receiveOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(sendOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(receiveParams?.lightningQuote).toBe(recvMarker);
      expect(receiveParams?.receiveType).toBe('LIGHTNING');
      expect(sendParams?.quote).toBe(sendMarker);
      expect(result).toEqual({
        transferId: receiveParams?.transferId as string,
        receiveTransactionId: 'tx-recv',
        sendTransactionId: 'tx-send',
      });
      expect(cashuReceiveCreates).toBe(0);
      expect(cashuSendCreates).toBe(0);
      expect(failCalls).toBe(0);
    });

    it('fails the receive quote with no options when the send persist throws', async () => {
      const error = new DomainError('boom');
      let failArgs: unknown[] | undefined;
      let receiveOptions: { abortSignal?: AbortSignal } | undefined;
      const receiveQuote = { transactionId: 'tx-recv' } as CashuReceiveQuote;
      const keys = createSessionKeys();
      const dst = { type: 'cashu', id: 'acct-dst' } as Account;
      const src = { type: 'cashu', id: 'acct-src' } as Account;
      const api = createTransferApi({
        db,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: emptyAccountRepository,
        createCashuReceiveService: async () =>
          ({
            createReceiveQuote: (async (
              _params: Record<string, unknown>,
              options?: { abortSignal?: AbortSignal },
            ) => {
              receiveOptions = options;
              return receiveQuote;
            }) as unknown as CashuReceiveQuoteService['createReceiveQuote'],
            fail: (async (...args: unknown[]) => {
              failArgs = args;
            }) as unknown as CashuReceiveQuoteService['fail'],
          }) as unknown as CashuReceiveQuoteService,
        createCashuSendService: async () =>
          ({
            createSendQuote: (async () => {
              throw error;
            }) as unknown as CashuSendQuoteService['createSendQuote'],
          }) as unknown as CashuSendQuoteService,
        createSparkReceiveService: async () =>
          ({
            createReceiveQuote: (async () => {
              throw new Error('spark receive create must not be called');
            }) as unknown as SparkReceiveQuoteService['createReceiveQuote'],
          }) as unknown as SparkReceiveQuoteService,
        createSparkSendService: async () =>
          ({
            createSendQuote: (async () => {
              throw new Error('spark send create must not be called');
            }) as unknown as SparkSendQuoteService['createSendQuote'],
          }) as unknown as SparkSendQuoteService,
      });

      await expect(
        api.initiate({
          quote: {
            receive: { account: dst, lightningQuote: { marker: 'recv' } },
            send: { account: src, lightningQuote: { marker: 'send' } },
          } as unknown as TransferQuote,
        }),
      ).rejects.toBe(error);
      expect(failArgs).toEqual([receiveQuote, 'Transfer initiation failed']);
      expect(failArgs?.length).toBe(2);
      expect(failArgs?.[0]).toBe(receiveQuote);
      expect(receiveOptions?.abortSignal).toBe(keys.sessionSignal());
    });

    it('fails the receive quote when the session aborts between the persists', async () => {
      const sendError = new Error('aborted write');
      let failCalls = 0;
      let failArgs: unknown[] | undefined;
      const keys = createSessionKeys();
      const api = createTransferApi({
        db,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: emptyAccountRepository,
        createCashuReceiveService: async () =>
          ({
            createReceiveQuote: (async () => {
              keys.reset();
              return { transactionId: 'tx-recv' } as CashuReceiveQuote;
            }) as unknown as CashuReceiveQuoteService['createReceiveQuote'],
            fail: (async (...args: unknown[]) => {
              failCalls += 1;
              failArgs = args;
            }) as unknown as CashuReceiveQuoteService['fail'],
          }) as unknown as CashuReceiveQuoteService,
        createCashuSendService: async () =>
          ({
            createSendQuote: (async (
              _params: Record<string, unknown>,
              options?: { abortSignal?: AbortSignal },
            ) => {
              if (options?.abortSignal?.aborted === true) {
                throw sendError;
              }
              throw new Error('expected an aborted signal');
            }) as unknown as CashuSendQuoteService['createSendQuote'],
          }) as unknown as CashuSendQuoteService,
        createSparkReceiveService: async () =>
          ({}) as unknown as SparkReceiveQuoteService,
        createSparkSendService: async () =>
          ({}) as unknown as SparkSendQuoteService,
      });

      await expect(
        api.initiate({
          quote: {
            receive: {
              account: { type: 'cashu', id: 'acct-dst' },
              lightningQuote: { marker: 'recv' },
            },
            send: {
              account: { type: 'cashu', id: 'acct-src' },
              lightningQuote: { marker: 'send' },
            },
          } as unknown as TransferQuote,
        }),
      ).rejects.toBe(sendError);
      expect(failCalls).toBe(1);
      expect(failArgs?.length).toBe(2);
    });

    it('does not persist the send quote when the receive persist throws', async () => {
      const error = new DomainError('receive failed');
      let sendCalls = 0;
      let failCalls = 0;
      const api = createTransferApi({
        db,
        keys: createSessionKeys(),
        getSession: () => loggedIn('user-x'),
        getAccountRepository: emptyAccountRepository,
        createCashuReceiveService: async () =>
          ({
            createReceiveQuote: (async () => {
              throw error;
            }) as unknown as CashuReceiveQuoteService['createReceiveQuote'],
            fail: (async () => {
              failCalls += 1;
            }) as unknown as CashuReceiveQuoteService['fail'],
          }) as unknown as CashuReceiveQuoteService,
        createCashuSendService: async () =>
          ({
            createSendQuote: (async () => {
              sendCalls += 1;
              return { transactionId: 'tx-send' };
            }) as unknown as CashuSendQuoteService['createSendQuote'],
          }) as unknown as CashuSendQuoteService,
        createSparkReceiveService: async () =>
          ({}) as unknown as SparkReceiveQuoteService,
        createSparkSendService: async () =>
          ({}) as unknown as SparkSendQuoteService,
      });

      await expect(
        api.initiate({
          quote: {
            receive: {
              account: { type: 'cashu', id: 'acct-dst' },
              lightningQuote: { marker: 'recv' },
            },
            send: {
              account: { type: 'cashu', id: 'acct-src' },
              lightningQuote: { marker: 'send' },
            },
          } as unknown as TransferQuote,
        }),
      ).rejects.toBe(error);
      expect(sendCalls).toBe(0);
      expect(failCalls).toBe(0);
    });

    it('rethrows the send error when receive cleanup fails', async () => {
      const sendError = new DomainError('send failed');
      const failError = new Error('fail failed');
      const errorSpy = spyOn(console, 'error').mockImplementation(
        () => undefined,
      );
      const api = createTransferApi({
        db,
        keys: createSessionKeys(),
        getSession: () => loggedIn('user-x'),
        getAccountRepository: emptyAccountRepository,
        createCashuReceiveService: async () =>
          ({
            createReceiveQuote: (async () =>
              ({
                transactionId: 'tx-recv',
              }) as CashuReceiveQuote) as unknown as CashuReceiveQuoteService['createReceiveQuote'],
            fail: (async () => {
              throw failError;
            }) as unknown as CashuReceiveQuoteService['fail'],
          }) as unknown as CashuReceiveQuoteService,
        createCashuSendService: async () =>
          ({
            createSendQuote: (async () => {
              throw sendError;
            }) as unknown as CashuSendQuoteService['createSendQuote'],
          }) as unknown as CashuSendQuoteService,
        createSparkReceiveService: async () =>
          ({}) as unknown as SparkReceiveQuoteService,
        createSparkSendService: async () =>
          ({}) as unknown as SparkSendQuoteService,
      });

      try {
        await expect(
          api.initiate({
            quote: {
              receive: {
                account: { type: 'cashu', id: 'acct-dst' },
                lightningQuote: { marker: 'recv' },
              },
              send: {
                account: { type: 'cashu', id: 'acct-src' },
                lightningQuote: { marker: 'send' },
              },
            } as unknown as TransferQuote,
          }),
        ).rejects.toBe(sendError);
        expect(errorSpy.mock.calls[0]?.[0]).toBe(
          'Failed to cleanup receive quote',
        );
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('repository seams', () => {
    it('forwards the session abort signal through the real cashu services', async () => {
      let receiveArgs: Record<string, unknown> | undefined;
      let receiveOptions: { abortSignal?: AbortSignal } | undefined;
      let sendArgs: Record<string, unknown> | undefined;
      let sendOptions: { abortSignal?: AbortSignal } | undefined;
      let receiveFailCalls = 0;
      let seedReads = 0;
      let mnemonicReads = 0;
      let accountRepositoryCalls = 0;
      const keys = createSessionKeys({
        readCashuSeed: async () => {
          seedReads += 1;
          throw new Error('cashu seed must not be read');
        },
        readSparkMnemonic: async () => {
          mnemonicReads += 1;
          throw new Error('spark mnemonic must not be read');
        },
      });
      const dst = { type: 'cashu', id: 'acct-dst' } as Account;
      const src = cashuSendAccount('acct-src');
      const api = createTransferApi({
        db,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => {
          accountRepositoryCalls += 1;
          return {} as unknown as AccountRepository;
        },
        createCashuReceiveRepository: async () =>
          ({
            create: async (
              args: Record<string, unknown>,
              options?: { abortSignal?: AbortSignal },
            ) => {
              receiveArgs = args;
              receiveOptions = options;
              return {
                id: 'rq-1',
                transactionId: 'tx-recv',
                state: 'UNPAID',
              } as unknown as CashuReceiveQuote;
            },
            fail: async () => {
              receiveFailCalls += 1;
            },
          }) as unknown as CashuReceiveQuoteRepository,
        createCashuSendRepository: async () =>
          ({
            create: async (
              args: Record<string, unknown>,
              options?: { abortSignal?: AbortSignal },
            ) => {
              sendArgs = args;
              sendOptions = options;
              return { transactionId: 'tx-send' };
            },
          }) as unknown as CashuSendQuoteRepository,
        createSparkReceiveRepository: async () =>
          unusedRepo('spark receive') as unknown as SparkReceiveQuoteRepository,
        createSparkSendRepository: async () =>
          unusedRepo('spark send') as unknown as SparkSendQuoteRepository,
      });

      const result = await api.initiate({
        quote: {
          receive: { account: dst, lightningQuote: cashuReceiveLightning() },
          send: { account: src, lightningQuote: cashuSendLightning() },
        } as unknown as TransferQuote,
      });

      expect(receiveOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(sendOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(receiveArgs?.purpose).toBe('TRANSFER');
      expect(sendArgs?.purpose).toBe('TRANSFER');
      expect(typeof receiveArgs?.transferId).toBe('string');
      expect(sendArgs?.transferId).toBe(receiveArgs?.transferId);
      expect(result.transferId).toBe(receiveArgs?.transferId as string);
      expect(receiveFailCalls).toBe(0);
      expect(seedReads).toBe(0);
      expect(mnemonicReads).toBe(0);
      expect(accountRepositoryCalls).toBe(0);
    });

    it('forwards the session abort signal through the real spark services', async () => {
      let receiveArgs: Record<string, unknown> | undefined;
      let receiveOptions: { abortSignal?: AbortSignal } | undefined;
      let sendArgs: Record<string, unknown> | undefined;
      let sendOptions: { abortSignal?: AbortSignal } | undefined;
      let receiveFailCalls = 0;
      let seedReads = 0;
      let mnemonicReads = 0;
      let accountRepositoryCalls = 0;
      const keys = createSessionKeys({
        readCashuSeed: async () => {
          seedReads += 1;
          throw new Error('cashu seed must not be read');
        },
        readSparkMnemonic: async () => {
          mnemonicReads += 1;
          throw new Error('spark mnemonic must not be read');
        },
      });
      const dst = sparkAccount('acct-dst');
      const src = sparkAccount('acct-src');
      const api = createTransferApi({
        db,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: async () => {
          accountRepositoryCalls += 1;
          return {} as unknown as AccountRepository;
        },
        createSparkReceiveRepository: async () =>
          ({
            create: async (
              args: Record<string, unknown>,
              options?: { abortSignal?: AbortSignal },
            ) => {
              receiveArgs = args;
              receiveOptions = options;
              return {
                id: 'spark-quote-1',
                transactionId: 'tx-recv',
                state: 'UNPAID',
              } as unknown as SparkReceiveQuote;
            },
            fail: async () => {
              receiveFailCalls += 1;
            },
          }) as unknown as SparkReceiveQuoteRepository,
        createSparkSendRepository: async () =>
          ({
            create: async (
              args: Record<string, unknown>,
              options?: { abortSignal?: AbortSignal },
            ) => {
              sendArgs = args;
              sendOptions = options;
              return { transactionId: 'tx-send' };
            },
          }) as unknown as SparkSendQuoteRepository,
        createCashuReceiveRepository: async () =>
          unusedRepo('cashu receive') as unknown as CashuReceiveQuoteRepository,
        createCashuSendRepository: async () =>
          unusedRepo('cashu send') as unknown as CashuSendQuoteRepository,
      });

      const result = await api.initiate({
        quote: {
          receive: { account: dst, lightningQuote: sparkReceiveLightning() },
          send: { account: src, lightningQuote: sparkSendLightning() },
        } as unknown as TransferQuote,
      });

      expect(receiveOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(sendOptions?.abortSignal).toBe(keys.sessionSignal());
      expect(receiveArgs?.purpose).toBe('TRANSFER');
      expect(sendArgs?.purpose).toBe('TRANSFER');
      expect(typeof receiveArgs?.transferId).toBe('string');
      expect(sendArgs?.transferId).toBe(receiveArgs?.transferId);
      expect(result.transferId).toBe(receiveArgs?.transferId as string);
      expect(receiveFailCalls).toBe(0);
      expect(seedReads).toBe(0);
      expect(mnemonicReads).toBe(0);
      expect(accountRepositoryCalls).toBe(0);
    });

    it('rejects an expired send quote through the real services and fails the receive quote', async () => {
      let receiveCreates = 0;
      let receiveFails = 0;
      let sendCreates = 0;
      const keys = createSessionKeys({
        readCashuSeed: async () => {
          throw new Error('cashu seed must not be read');
        },
        readSparkMnemonic: async () => {
          throw new Error('spark mnemonic must not be read');
        },
      });
      const api = createTransferApi({
        db,
        keys,
        getSession: () => loggedIn('user-x'),
        getAccountRepository: emptyAccountRepository,
        createSparkReceiveRepository: async () =>
          ({
            create: async () => {
              receiveCreates += 1;
              return {
                id: 'spark-quote-1',
                transactionId: 'tx-recv',
                state: 'UNPAID',
              } as unknown as SparkReceiveQuote;
            },
            fail: async () => {
              receiveFails += 1;
            },
          }) as unknown as SparkReceiveQuoteRepository,
        createSparkSendRepository: async () =>
          ({
            create: async () => {
              sendCreates += 1;
              return { transactionId: 'tx-send' };
            },
          }) as unknown as SparkSendQuoteRepository,
        createCashuReceiveRepository: async () =>
          unusedRepo('cashu receive') as unknown as CashuReceiveQuoteRepository,
        createCashuSendRepository: async () =>
          unusedRepo('cashu send') as unknown as CashuSendQuoteRepository,
      });
      const sendLightning = {
        ...sparkSendLightning(),
        expiresAt: new Date(Date.now() - 60_000),
      } as unknown as SparkLightningQuote;

      const promise = api.initiate({
        quote: {
          receive: {
            account: sparkAccount('acct-dst'),
            lightningQuote: sparkReceiveLightning(),
          },
          send: {
            account: sparkAccount('acct-src'),
            lightningQuote: sendLightning,
          },
        } as unknown as TransferQuote,
      });

      await expect(promise).rejects.toBeInstanceOf(DomainError);
      await expect(promise).rejects.toThrow('Lightning invoice has expired');
      expect(receiveCreates).toBe(1);
      expect(receiveFails).toBe(1);
      expect(sendCreates).toBe(0);
    });
  });

  describe('construction', () => {
    it('does no construction or session work when built', () => {
      let getSessionCalls = 0;
      let accountRepositoryCalls = 0;
      let privateKeyReads = 0;
      let publicKeyReads = 0;
      let seedReads = 0;
      let mnemonicReads = 0;
      let createServiceCalls = 0;
      let cashuReceiveRepositoryCalls = 0;
      let cashuReceiveServiceCalls = 0;
      let sparkReceiveRepositoryCalls = 0;
      let sparkReceiveServiceCalls = 0;
      let cashuSendRepositoryCalls = 0;
      let cashuSendServiceCalls = 0;
      let sparkSendRepositoryCalls = 0;
      let sparkSendServiceCalls = 0;
      const keys = createSessionKeys({
        readEncryptionPrivateKey: async () => {
          privateKeyReads += 1;
          throw new Error('encryption private key must not be read');
        },
        readEncryptionPublicKey: async () => {
          publicKeyReads += 1;
          throw new Error('encryption public key must not be read');
        },
        readCashuSeed: async () => {
          seedReads += 1;
          throw new Error('cashu seed must not be read');
        },
        readSparkMnemonic: async () => {
          mnemonicReads += 1;
          throw new Error('spark mnemonic must not be read');
        },
      });
      const api = createTransferApi({
        db,
        keys,
        getSession: () => {
          getSessionCalls += 1;
          return loggedOut();
        },
        getAccountRepository: async () => {
          accountRepositoryCalls += 1;
          return {} as unknown as AccountRepository;
        },
        createService: async () => {
          createServiceCalls += 1;
          return {} as unknown as TransferService;
        },
        createCashuReceiveRepository: async () => {
          cashuReceiveRepositoryCalls += 1;
          return {} as unknown as CashuReceiveQuoteRepository;
        },
        createCashuReceiveService: async () => {
          cashuReceiveServiceCalls += 1;
          return {} as unknown as CashuReceiveQuoteService;
        },
        createSparkReceiveRepository: async () => {
          sparkReceiveRepositoryCalls += 1;
          return {} as unknown as SparkReceiveQuoteRepository;
        },
        createSparkReceiveService: async () => {
          sparkReceiveServiceCalls += 1;
          return {} as unknown as SparkReceiveQuoteService;
        },
        createCashuSendRepository: async () => {
          cashuSendRepositoryCalls += 1;
          return {} as unknown as CashuSendQuoteRepository;
        },
        createCashuSendService: async () => {
          cashuSendServiceCalls += 1;
          return {} as unknown as CashuSendQuoteService;
        },
        createSparkSendRepository: async () => {
          sparkSendRepositoryCalls += 1;
          return {} as unknown as SparkSendQuoteRepository;
        },
        createSparkSendService: async () => {
          sparkSendServiceCalls += 1;
          return {} as unknown as SparkSendQuoteService;
        },
      });

      expect(typeof api.getQuote).toBe('function');
      expect(typeof api.initiate).toBe('function');
      expect(getSessionCalls).toBe(0);
      expect(accountRepositoryCalls).toBe(0);
      expect(privateKeyReads).toBe(0);
      expect(publicKeyReads).toBe(0);
      expect(seedReads).toBe(0);
      expect(mnemonicReads).toBe(0);
      expect(createServiceCalls).toBe(0);
      expect(cashuReceiveRepositoryCalls).toBe(0);
      expect(cashuReceiveServiceCalls).toBe(0);
      expect(sparkReceiveRepositoryCalls).toBe(0);
      expect(sparkReceiveServiceCalls).toBe(0);
      expect(cashuSendRepositoryCalls).toBe(0);
      expect(cashuSendServiceCalls).toBe(0);
      expect(sparkSendRepositoryCalls).toBe(0);
      expect(sparkSendServiceCalls).toBe(0);
    });
  });
});
