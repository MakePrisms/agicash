import { afterEach, describe, expect, mock, test } from 'bun:test';

// Mock the LNURL module so the ln-address fold is exercised without a real HTTP call.
// `getInvoiceFromLud16` returns whatever the test queues (an invoice result or an LNURL error).
let lnurlResult: unknown = {
  pr: 'lnbc-resolved',
  verify: undefined,
  routes: [],
};
const getInvoiceFromLud16 = mock(async () => lnurlResult);
mock.module('../internal/lib-lnurl', () => ({
  getInvoiceFromLud16,
  isLNURLError: (o: unknown) =>
    typeof o === 'object' &&
    o !== null &&
    (o as { status?: string }).status === 'ERROR',
}));

import type { Currency, Money as MoneyType } from '../types/money';

const { SparkSendOpsImpl, SparkReceiveOpsImpl } = await import('./spark');
const { DomainError } = await import('../errors');
const { Money } = await import('../types/money');

// -- Fakes ----------------------------------------------------------------------------------

const sats = (n: number): MoneyType =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

const session = {
  requireCurrentUser: async () => ({ id: 'u1' }),
} as never;

const sparkAccount = {
  id: 'acc1',
  type: 'spark',
  currency: 'BTC',
  balance: sats(10_000),
} as never;

/** A send-quote service whose getLightningSendQuote echoes the payment request it was given. */
function fakeSendQuoteService() {
  return {
    getLightningSendQuote: mock(
      async ({ paymentRequest }: { paymentRequest: string }) => ({
        paymentRequest,
        paymentHash: 'ph1',
        amountRequested: sats(100),
        amountRequestedInBtc: sats(100),
        amountToReceive: sats(100),
        estimatedLightningFee: sats(1),
        estimatedTotalFee: sats(1),
        estimatedTotalAmount: sats(101),
        paymentRequestIsAmountless: false,
        expiresAt: null,
      }),
    ),
    createSendQuote: mock(
      async (args: { quote: { paymentRequest: string } }) => ({
        id: 'q1',
        state: 'UNPAID',
        paymentRequest: args.quote.paymentRequest,
      }),
    ),
    fail: mock(async (_quote: unknown, _reason: string) => ({
      id: 'q1',
      state: 'FAILED',
    })),
    get: mock(async (id: string) => ({ id, state: 'UNPAID' })),
  };
}

function makeSendOps(
  sendQuoteService = fakeSendQuoteService(),
  orchestrator: unknown = {},
) {
  const ops = new SparkSendOpsImpl(
    // biome-ignore lint/suspicious/noExplicitAny: minimal service stub for the fold tests.
    sendQuoteService as any,
    session,
    orchestrator as never,
  );
  return { ops, sendQuoteService };
}

/** A receive-quote service whose getLightningQuote echoes the description it was given. */
function fakeReceiveQuoteService() {
  return {
    getLightningQuote: mock(
      async ({ description }: { description?: string }) => ({
        id: 'spark-recv-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        invoice: {
          paymentRequest: 'lnbc-invoice',
          paymentHash: 'ph1',
          amount: sats(100),
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          memo: description,
        },
        status: 'PENDING',
      }),
    ),
    createReceiveQuote: mock(
      async (args: {
        lightningQuote: { invoice: { memo?: string } };
        purpose?: string;
        receiveType?: string;
      }) => ({
        id: 'rq1',
        state: 'UNPAID',
        type: 'LIGHTNING',
        description: args.lightningQuote.invoice.memo,
      }),
    ),
    get: mock(async (id: string) => ({ id, state: 'UNPAID' })),
  };
}

function makeReceiveOps(receiveQuoteService = fakeReceiveQuoteService()) {
  // biome-ignore lint/suspicious/noExplicitAny: minimal service stub for the create tests.
  const ops = new SparkReceiveOpsImpl(receiveQuoteService as any, session);
  return { ops, receiveQuoteService };
}

afterEach(() => {
  getInvoiceFromLud16.mockClear();
  lnurlResult = { pr: 'lnbc-resolved', verify: undefined, routes: [] };
});

// -- Tests ----------------------------------------------------------------------------------

describe('SparkSendOps.createLightningQuote — destination resolution', () => {
  test('a bolt11 invoice is passed through (no LNURL call)', async () => {
    const { ops, sendQuoteService } = makeSendOps();

    await ops.createLightningQuote({
      account: sparkAccount,
      destination: 'lnbc1pjinvoice',
    });

    expect(getInvoiceFromLud16).not.toHaveBeenCalled();
    expect(
      sendQuoteService.getLightningSendQuote.mock.calls[0][0].paymentRequest,
    ).toBe('lnbc1pjinvoice');
  });

  test('an ln-address is resolved via LNURL-pay using the amount', async () => {
    const { ops, sendQuoteService } = makeSendOps();

    await ops.createLightningQuote({
      account: sparkAccount,
      destination: 'alice@example.com',
      amount: sats(100),
    });

    expect(getInvoiceFromLud16).toHaveBeenCalledTimes(1);
    expect(
      sendQuoteService.getLightningSendQuote.mock.calls[0][0].paymentRequest,
    ).toBe('lnbc-resolved');
  });

  test('an ln-address without an amount is rejected (LNURL needs the amount)', async () => {
    const { ops } = makeSendOps();
    await expect(
      ops.createLightningQuote({
        account: sparkAccount,
        destination: 'alice@example.com',
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(getInvoiceFromLud16).not.toHaveBeenCalled();
  });

  test('an LNURL error surfaces as a DomainError', async () => {
    lnurlResult = { status: 'ERROR', reason: 'amount out of range' };
    const { ops } = makeSendOps();

    await expect(
      ops.createLightningQuote({
        account: sparkAccount,
        destination: 'alice@example.com',
        amount: sats(100),
      }),
    ).rejects.toThrow(/amount out of range/);
  });
});

describe('SparkSendOps.executeQuote — wired to the orchestrator (PR5d)', () => {
  test('delegates the full quote to orchestrator.executeSparkSendQuote', async () => {
    const quote = { id: 'q1', state: 'UNPAID' } as never;
    const executeSparkSendQuote = mock(async (q: unknown) => q);
    const { ops } = makeSendOps(fakeSendQuoteService(), {
      executeSparkSendQuote,
    });

    const result = await ops.executeQuote(quote);

    expect(executeSparkSendQuote).toHaveBeenCalledTimes(1);
    expect(executeSparkSendQuote).toHaveBeenCalledWith(quote);
    expect(result).toBe(quote);
  });
});

describe('SparkSendOps.failQuote / get', () => {
  test('failQuote delegates to the service', async () => {
    const { ops, sendQuoteService } = makeSendOps();
    await ops.failQuote({ id: 'q1', state: 'UNPAID' } as never, 'because');
    expect(sendQuoteService.fail).toHaveBeenCalledTimes(1);
    expect(sendQuoteService.fail.mock.calls[0][1]).toBe('because');
  });

  test('get delegates to the service', async () => {
    const { ops, sendQuoteService } = makeSendOps();
    const quote = await ops.get('q1');
    expect(sendQuoteService.get).toHaveBeenCalledWith('q1');
    expect((quote as { id: string }).id).toBe('q1');
  });
});

describe('SparkReceiveOps.createLightningQuote', () => {
  test('a PAYMENT receive passes the given description and tags LIGHTNING', async () => {
    const { ops, receiveQuoteService } = makeReceiveOps();

    await ops.createLightningQuote({
      account: sparkAccount,
      amount: sats(100),
      description: 'coffee',
    });

    expect(
      receiveQuoteService.getLightningQuote.mock.calls[0][0].description,
    ).toBe('coffee');
    expect(
      receiveQuoteService.createReceiveQuote.mock.calls[0][0].purpose,
    ).toBe('PAYMENT');
    expect(
      receiveQuoteService.createReceiveQuote.mock.calls[0][0].receiveType,
    ).toBe('LIGHTNING');
  });

  test("a BUY_CASHAPP receive uses the 'Pay to Agicash' description + purpose", async () => {
    const { ops, receiveQuoteService } = makeReceiveOps();

    await ops.createLightningQuote({
      account: sparkAccount,
      amount: sats(100),
      purpose: 'BUY_CASHAPP',
    });

    expect(
      receiveQuoteService.getLightningQuote.mock.calls[0][0].description,
    ).toBe('Pay to Agicash');
    expect(
      receiveQuoteService.createReceiveQuote.mock.calls[0][0].purpose,
    ).toBe('BUY_CASHAPP');
  });

  test('get delegates to the service', async () => {
    const { ops, receiveQuoteService } = makeReceiveOps();
    await ops.get('rq1');
    expect(receiveQuoteService.get).toHaveBeenCalledWith('rq1');
  });
});
