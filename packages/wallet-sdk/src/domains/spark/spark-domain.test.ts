import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { Money } from '@agicash/money';
import type { SdkConfig } from '../../config';
import { DomainError } from '../../errors';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../../internal/event-emitter';
import * as lnurl from '../../internal/lib/lnurl';
import type { AccountRepository } from '../../internal/repositories/account-repository';
import { SparkReceiveQuoteRepository } from '../../internal/repositories/spark-receive-quote-repository';
import { SparkSendQuoteRepository } from '../../internal/repositories/spark-send-quote-repository';
import {
  inMemoryStorage,
  jwtWith,
  makeFakeDb,
} from '../../internal/test-support';
import type { SparkAccount } from '../../types/account';
import type { SparkSendQuote } from '../../types/spark';
import type { DomainContext } from '../context';
import { createSparkDomain } from './spark-domain';
import { SparkReceiveQuoteService } from './spark-receive-quote-service';
import {
  type SparkLightningQuote,
  SparkSendQuoteService,
} from './spark-send-quote-service';

// ---------------------------------------------------------------------------
// The domain constructs its repos/services internally, so we spy on the real
// class prototypes to drive composition without hitting the DB / a wallet /
// the network. spyOn (reverted by mock.restore) is used so sibling test files
// keep the real implementations.
// ---------------------------------------------------------------------------

const VALID_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

function btc(sats: number): Money {
  return new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money;
}

const sparkAccount = {
  id: 'acc-1',
  type: 'spark',
  currency: 'BTC',
  balance: btc(10000),
  wallet: {},
} as unknown as SparkAccount;

function makeCtx(): DomainContext {
  return {
    config: {
      storage: inMemoryStorage({ access_token: jwtWith({ sub: 'u1' }) }),
    } as unknown as SdkConfig,
    connections: {
      supabase: makeFakeDb({}) as unknown,
      encryption: {} as unknown,
    } as unknown as DomainContext['connections'],
    emitter: new SdkEventEmitter<SdkEventMap>(),
  };
}

function fakeAccountRepo(
  account: SparkAccount | null = sparkAccount,
): AccountRepository {
  return { get: async () => account } as unknown as AccountRepository;
}

// Spies on real class prototypes + the lnurl module.
const sendServiceFail = spyOn(SparkSendQuoteService.prototype, 'fail');
const sendServiceGetLightning = spyOn(
  SparkSendQuoteService.prototype,
  'getLightningSendQuote',
);
const sendServiceCreate = spyOn(
  SparkSendQuoteService.prototype,
  'createSendQuote',
);
const sendServiceInitiateSend = spyOn(
  SparkSendQuoteService.prototype,
  'initiateSend',
);
const receiveServiceCreateQuote = spyOn(
  SparkReceiveQuoteService.prototype,
  'createReceiveQuote',
);
const sendRepoGet = spyOn(SparkSendQuoteRepository.prototype, 'get');
const receiveRepoGet = spyOn(SparkReceiveQuoteRepository.prototype, 'get');
const getInvoiceFromLud16 = spyOn(lnurl, 'getInvoiceFromLud16');

afterAll(() => {
  for (const s of [
    sendServiceFail,
    sendServiceGetLightning,
    sendServiceCreate,
    sendServiceInitiateSend,
    receiveServiceCreateQuote,
    sendRepoGet,
    receiveRepoGet,
    getInvoiceFromLud16,
  ]) {
    s.mockRestore();
  }
});

beforeEach(() => {
  for (const s of [
    sendServiceFail,
    sendServiceGetLightning,
    sendServiceCreate,
    sendServiceInitiateSend,
    receiveServiceCreateQuote,
    sendRepoGet,
    receiveRepoGet,
    getInvoiceFromLud16,
  ]) {
    s.mockReset();
  }
  sendRepoGet.mockResolvedValue(null);
  receiveRepoGet.mockResolvedValue(null);
});

describe('spark domain', () => {
  describe('spark.send.executeQuote', () => {
    it('initiates the send (returns PENDING) and emits send:pending', async () => {
      const ctx = makeCtx();
      const pending: unknown[] = [];
      ctx.emitter.on('send:pending', (e) => pending.push(e));

      sendServiceInitiateSend.mockResolvedValue({
        id: 'sq-1',
        state: 'PENDING',
        transactionId: 'tx-1',
      } as never);

      const domain = createSparkDomain(ctx, fakeAccountRepo());
      const quote = {
        id: 'sq-1',
        state: 'UNPAID',
        accountId: 'acc-1',
        transactionId: 'tx-1',
      } as unknown as SparkSendQuote;
      const result = await domain.send.executeQuote(quote);

      expect(sendServiceInitiateSend).toHaveBeenCalledWith({
        account: expect.objectContaining({ id: 'acc-1' }),
        sendQuote: quote,
      });
      expect(result.state).toBe('PENDING');
      expect(pending).toEqual([
        { quoteId: 'sq-1', transactionId: 'tx-1', protocol: 'spark' },
      ] as never);
    });

    it('propagates a DomainError from initiateSend (fee_changed surfaces to the UI)', async () => {
      sendServiceInitiateSend.mockImplementation(async () => {
        throw new DomainError(
          'Lightning network fee has changed',
          'fee_changed',
        );
      });

      const domain = createSparkDomain(makeCtx(), fakeAccountRepo());
      const quote = {
        id: 'sq-1',
        state: 'UNPAID',
        accountId: 'acc-1',
      } as unknown as SparkSendQuote;
      await expect(domain.send.executeQuote(quote)).rejects.toMatchObject({
        code: 'fee_changed',
      });
    });
  });

  it('failQuote calls through to the send service', async () => {
    sendServiceFail.mockResolvedValue({ id: 'q1', state: 'FAILED' } as never);
    const domain = createSparkDomain(makeCtx(), fakeAccountRepo());
    const quote = { id: 'q1', state: 'UNPAID' } as SparkSendQuote;
    await domain.send.failQuote(quote, 'test reason');
    expect(sendServiceFail).toHaveBeenCalledTimes(1);
    expect(sendServiceFail.mock.calls[0]).toEqual([quote, 'test reason']);
  });

  describe('send.previewLightningQuote', () => {
    it('quotes fees without persisting', async () => {
      const lightningQuoteStub: SparkLightningQuote = {
        paymentRequest: VALID_INVOICE,
        paymentHash: 'abc123',
        amountRequested: btc(2500),
        amountRequestedInBtc: btc(2500) as Money<'BTC'>,
        amountToReceive: btc(2500),
        estimatedLightningFee: btc(1) as Money<'BTC'>,
        estimatedTotalFee: btc(1),
        estimatedTotalAmount: btc(2501),
        paymentRequestIsAmountless: false,
        expiresAt: null,
      };
      sendServiceGetLightning.mockResolvedValue(lightningQuoteStub as never);

      const domain = createSparkDomain(makeCtx(), fakeAccountRepo());
      const preview = await domain.send.previewLightningQuote({
        account: sparkAccount,
        destination: VALID_INVOICE,
      });

      expect(preview.estimatedTotalFee).toBeInstanceOf(Money);
      expect(sendServiceCreate).not.toHaveBeenCalled();
      expect(preview).toBe(lightningQuoteStub);
    });
  });

  describe('send.createLightningQuote', () => {
    it('bolt11 path: resolves invoice unchanged and wires getLightningSendQuote + createSendQuote', async () => {
      const lightningQuoteStub: SparkLightningQuote = {
        paymentRequest: VALID_INVOICE,
        paymentHash: 'abc123',
        amountRequested: btc(2500),
        amountRequestedInBtc: btc(2500) as Money<'BTC'>,
        amountToReceive: btc(2500),
        estimatedLightningFee: btc(1) as Money<'BTC'>,
        estimatedTotalFee: btc(1),
        estimatedTotalAmount: btc(2501),
        paymentRequestIsAmountless: false,
        expiresAt: null,
      };
      const unpaidQuoteStub = { id: 'sq-1', state: 'UNPAID' } as SparkSendQuote;

      sendServiceGetLightning.mockResolvedValue(lightningQuoteStub as never);
      sendServiceCreate.mockResolvedValue(unpaidQuoteStub as never);

      const domain = createSparkDomain(makeCtx(), fakeAccountRepo());
      const result = await domain.send.createLightningQuote({
        account: sparkAccount,
        destination: VALID_INVOICE,
        amount: undefined,
      });

      expect(result as unknown).toBe(unpaidQuoteStub);
      expect(sendServiceGetLightning).toHaveBeenCalledTimes(1);
      expect(
        (sendServiceGetLightning.mock.calls[0][0] as { paymentRequest: string })
          .paymentRequest,
      ).toBe(VALID_INVOICE);
      expect(sendServiceCreate).toHaveBeenCalledTimes(1);
      expect(
        (sendServiceCreate.mock.calls[0][0] as { userId: string }).userId,
      ).toBe('u1');
      expect(
        (sendServiceCreate.mock.calls[0][0] as { quote: SparkLightningQuote })
          .quote,
      ).toBe(lightningQuoteStub);
    });

    it('ln-address path: resolves via LNURL and forwards the resolved bolt11', async () => {
      const resolvedPr = 'lnbc-resolved-from-lnurl';
      getInvoiceFromLud16.mockResolvedValue({
        pr: resolvedPr,
        routes: [],
      } as never);

      const lightningQuoteStub: SparkLightningQuote = {
        paymentRequest: resolvedPr,
        paymentHash: 'def456',
        amountRequested: btc(100),
        amountRequestedInBtc: btc(100) as Money<'BTC'>,
        amountToReceive: btc(100),
        estimatedLightningFee: btc(1) as Money<'BTC'>,
        estimatedTotalFee: btc(1),
        estimatedTotalAmount: btc(101),
        paymentRequestIsAmountless: false,
        expiresAt: null,
      };
      const unpaidQuoteStub = { id: 'sq-2', state: 'UNPAID' } as SparkSendQuote;

      sendServiceGetLightning.mockResolvedValue(lightningQuoteStub as never);
      sendServiceCreate.mockResolvedValue(unpaidQuoteStub as never);

      const domain = createSparkDomain(makeCtx(), fakeAccountRepo());
      await domain.send.createLightningQuote({
        account: sparkAccount,
        destination: 'someuser@example.com',
        amount: btc(100),
      });

      expect(getInvoiceFromLud16).toHaveBeenCalledTimes(1);
      expect(
        (getInvoiceFromLud16.mock.calls[0] as [string, ...unknown[]])[0],
      ).toBe('someuser@example.com');
      expect(sendServiceGetLightning).toHaveBeenCalledTimes(1);
      expect(
        (sendServiceGetLightning.mock.calls[0][0] as { paymentRequest: string })
          .paymentRequest,
      ).toBe(resolvedPr);
    });
  });

  it('receive.createLightningQuote composes getLightningQuote + createReceiveQuote', async () => {
    const receiveQuote = { id: 'rq-1', state: 'UNPAID', type: 'LIGHTNING' };

    // getLightningQuote is a module-level function, not a class method — we spy
    // on receiveQuoteService.createReceiveQuote and test the full wallet path
    // by making wallet.receivePayment + the receive service spy work together.
    receiveServiceCreateQuote.mockResolvedValue(receiveQuote as never);

    // We need getLightningQuote (the core fn) to actually run — it calls
    // wallet.receivePayment and parseBolt11Invoice. So provide a real wallet
    // mock and a real bolt11 invoice for the account.
    const accountWithWallet = {
      ...sparkAccount,
      wallet: {
        receivePayment: async () => ({
          paymentRequest: VALID_INVOICE,
          lightningReceiveDetails: {
            receiveRequestId: 'rr-1',
            status: 'pending',
            createdAt: 1_700_000_000,
            updatedAt: 1_700_000_000,
          },
        }),
      },
    } as unknown as SparkAccount;

    const domain = createSparkDomain(makeCtx(), fakeAccountRepo());
    const amount = btc(500);
    const result = await domain.receive.createLightningQuote({
      account: accountWithWallet,
      amount,
    });

    expect(result as unknown).toBe(receiveQuote);
    expect(receiveServiceCreateQuote).toHaveBeenCalledTimes(1);
    const createArg = receiveServiceCreateQuote.mock.calls[0][0] as {
      userId: string;
      receiveType: string;
      purpose?: string;
      lightningQuote: { invoice: { paymentRequest: string } };
    };
    expect(createArg.userId).toBe('u1');
    expect(createArg.receiveType).toBe('LIGHTNING');
    expect(createArg.lightningQuote.invoice.paymentRequest).toBe(VALID_INVOICE);
  });

  it('receive.createLightningQuote forwards purpose', async () => {
    receiveServiceCreateQuote.mockResolvedValue({ id: 'rq-2' } as never);
    const accountWithWallet = {
      ...sparkAccount,
      wallet: {
        receivePayment: async () => ({
          paymentRequest: VALID_INVOICE,
          lightningReceiveDetails: {
            receiveRequestId: 'rr-2',
            status: 'pending',
            createdAt: 1_700_000_000,
            updatedAt: 1_700_000_000,
          },
        }),
      },
    } as unknown as SparkAccount;

    const domain = createSparkDomain(makeCtx(), fakeAccountRepo());
    await domain.receive.createLightningQuote({
      account: accountWithWallet,
      amount: btc(200),
      purpose: 'BUY_CASHAPP',
    });

    const createArg = receiveServiceCreateQuote.mock.calls[0][0] as {
      purpose?: string;
    };
    expect(createArg.purpose).toBe('BUY_CASHAPP');
  });

  it('send.get delegates to the send repo', async () => {
    const quote = { id: 'sq-1', state: 'UNPAID' };
    sendRepoGet.mockResolvedValue(quote as never);
    const domain = createSparkDomain(makeCtx(), fakeAccountRepo());

    const result = await domain.send.get('sq-1');
    expect(result as unknown).toBe(quote);
    expect(sendRepoGet).toHaveBeenCalledWith('sq-1');
  });

  it('send.get returns null when not found', async () => {
    const domain = createSparkDomain(makeCtx(), fakeAccountRepo());
    const result = await domain.send.get('missing');
    expect(result).toBeNull();
  });

  it('receive.get delegates to the receive repo', async () => {
    const quote = { id: 'rq-1', state: 'UNPAID', type: 'LIGHTNING' };
    receiveRepoGet.mockResolvedValue(quote as never);
    const domain = createSparkDomain(makeCtx(), fakeAccountRepo());

    const result = await domain.receive.get('rq-1');
    expect(result as unknown).toBe(quote);
    expect(receiveRepoGet).toHaveBeenCalledWith('rq-1');
  });

  it('receive.get returns null when not found', async () => {
    const domain = createSparkDomain(makeCtx(), fakeAccountRepo());
    const result = await domain.receive.get('missing');
    expect(result).toBeNull();
  });
});
