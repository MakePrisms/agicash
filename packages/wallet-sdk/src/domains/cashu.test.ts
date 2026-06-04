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

const { CashuSendOpsImpl, CashuReceiveOpsImpl } = await import('./cashu');
const { DomainError } = await import('../errors');
const { Money } = await import('../types/money');

// -- Fakes ----------------------------------------------------------------------------------

const sats = (n: number): MoneyType =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

const session = {
  requireCurrentUser: async () => ({ id: 'u1' }),
} as never;

const cashuAccount = {
  id: 'acc1',
  type: 'cashu',
  currency: 'BTC',
  mintUrl: 'https://mint.example',
} as never;

/** A send-quote service whose getLightningQuote echoes the payment request it was given. */
function fakeSendQuoteService() {
  return {
    getLightningQuote: mock(
      async ({ paymentRequest }: { paymentRequest: string }) => ({
        paymentRequest,
        amountRequested: sats(100),
        amountRequestedInBtc: sats(100),
        meltQuote: { quote: 'melt1' },
      }),
    ),
    createSendQuote: mock(
      async (args: {
        sendQuote: { paymentRequest: string };
        destinationDetails?: unknown;
      }) => ({
        id: 'q1',
        state: 'UNPAID',
        paymentRequest: args.sendQuote.paymentRequest,
        destinationDetails: args.destinationDetails,
      }),
    ),
  };
}

function makeSendOps(sendQuoteService = fakeSendQuoteService()) {
  const ops = new CashuSendOpsImpl(
    // biome-ignore lint/suspicious/noExplicitAny: minimal service/repo stubs for the fold tests.
    sendQuoteService as any,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    session,
    {} as never,
  );
  return { ops, sendQuoteService };
}

afterEach(() => {
  getInvoiceFromLud16.mockClear();
  lnurlResult = { pr: 'lnbc-resolved', verify: undefined, routes: [] };
});

// -- Tests ----------------------------------------------------------------------------------

describe('CashuSendOps.createLightningQuote — destination resolution', () => {
  test('a bolt11 invoice is passed through (no LNURL call, no destinationDetails)', async () => {
    const { ops, sendQuoteService } = makeSendOps();

    const quote = await ops.createLightningQuote({
      account: cashuAccount,
      destination: 'lnbc1pjinvoice',
    });

    expect(getInvoiceFromLud16).not.toHaveBeenCalled();
    expect(
      sendQuoteService.getLightningQuote.mock.calls[0][0].paymentRequest,
    ).toBe('lnbc1pjinvoice');
    expect(
      (quote as { destinationDetails?: unknown }).destinationDetails,
    ).toBeUndefined();
  });

  test('an ln-address is resolved via LNURL-pay and tagged LN_ADDRESS', async () => {
    const { ops, sendQuoteService } = makeSendOps();

    const quote = await ops.createLightningQuote({
      account: cashuAccount,
      destination: 'alice@example.com',
      amount: sats(100),
    });

    expect(getInvoiceFromLud16).toHaveBeenCalledTimes(1);
    // The resolved invoice flows into the quote service.
    expect(
      sendQuoteService.getLightningQuote.mock.calls[0][0].paymentRequest,
    ).toBe('lnbc-resolved');
    expect(
      (quote as { destinationDetails?: unknown }).destinationDetails,
    ).toEqual({
      sendType: 'LN_ADDRESS',
      lnAddress: 'alice@example.com',
    });
  });

  test('an ln-address without an amount is rejected (LNURL needs the amount)', async () => {
    const { ops } = makeSendOps();
    await expect(
      ops.createLightningQuote({
        account: cashuAccount,
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
        account: cashuAccount,
        destination: 'alice@example.com',
        amount: sats(100),
      }),
    ).rejects.toThrow(/amount out of range/);
  });
});

describe('CashuSendOps.executeQuote — wired to the orchestrator (PR5d)', () => {
  test('delegates the full quote to orchestrator.executeCashuSendQuote', async () => {
    const quote = { id: 'q1', state: 'UNPAID' } as never;
    const executeCashuSendQuote = mock(async (q: unknown) => q);
    const orchestrator = { executeCashuSendQuote } as never;
    const ops = new CashuSendOpsImpl(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      session,
      orchestrator,
    );

    const result = await ops.executeQuote(quote);

    expect(executeCashuSendQuote).toHaveBeenCalledTimes(1);
    expect(executeCashuSendQuote).toHaveBeenCalledWith(quote);
    expect(result).toBe(quote);
  });
});

describe('CashuReceiveOps.receiveToken — wired to the claim flow (PR5d)', () => {
  test('a SAME-MINT claim returns { success:true, destinationAccount } (no throw)', async () => {
    // The same-mint branch creates an internal CashuReceiveSwap + kicks the orchestrator; the flow
    // reports kind:'same-mint' with the destination account projection (the swap stays internal).
    const claim = mock(async () => ({
      kind: 'same-mint' as const,
      destinationAccount: { id: 'acc1', purpose: 'transactional' },
    }));
    const ops = new CashuReceiveOpsImpl({} as never, {} as never, session, {
      claim,
    } as never);

    const result = await ops.receiveToken({ token: 'cashuAabc' });

    expect(claim).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      destinationAccount: { id: 'acc1', purpose: 'transactional' },
    });
  });

  test('a CROSS-account claim returns { success:true, destinationAccount }', async () => {
    const claim = mock(async () => ({
      kind: 'cross-account' as const,
      destinationAccount: { id: 'spark1', purpose: 'transactional' },
    }));
    const ops = new CashuReceiveOpsImpl({} as never, {} as never, session, {
      claim,
    } as never);

    const result = await ops.receiveToken({
      token: 'cashuAabc',
      destinationAccount: { id: 'spark1', type: 'spark' } as never,
    });

    expect(claim).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      destinationAccount: { id: 'spark1', purpose: 'transactional' },
    });
  });

  test('a DomainError from the flow is swallowed to { success:false, message } (no throw)', async () => {
    const claim = mock(async () => {
      throw new DomainError(
        'Claiming a token from a new mint is not supported yet',
      );
    });
    const ops = new CashuReceiveOpsImpl({} as never, {} as never, session, {
      claim,
    } as never);

    const result = await ops.receiveToken({ token: 'cashuAabc' });

    expect(result).toEqual({
      success: false,
      message: 'Claiming a token from a new mint is not supported yet',
    });
  });

  test('an unexpected (non-Domain) error is swallowed to a generic { success:false } result', async () => {
    const claim = mock(async () => {
      throw new TypeError('boom');
    });
    const ops = new CashuReceiveOpsImpl({} as never, {} as never, session, {
      claim,
    } as never);

    const result = await ops.receiveToken({ token: 'cashuAabc' });

    expect(result).toEqual({
      success: false,
      message: 'Unexpected error while claiming the token',
    });
  });
});
