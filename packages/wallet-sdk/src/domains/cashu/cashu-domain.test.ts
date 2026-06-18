import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import type { SdkConfig } from '../../config';
import { DomainError, NotImplementedError } from '../../errors';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../../internal/event-emitter';
import * as lnurl from '../../internal/lib/lnurl';
import type { AccountRepository } from '../../internal/repositories/account-repository';
import { CashuReceiveQuoteRepository } from '../../internal/repositories/cashu-receive-quote-repository';
import { CashuSendQuoteRepository } from '../../internal/repositories/cashu-send-quote-repository';
import { CashuSendSwapRepository } from '../../internal/repositories/cashu-send-swap-repository';
import { inMemoryStorage, jwtWith } from '../../internal/test-support';
import type { CashuAccount } from '../../types/account';
import type { CashuSendQuote } from '../../types/cashu';
import type { DomainContext } from '../context';
import { createCashuDomain } from './cashu-domain';
import { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import { CashuSendQuoteService } from './cashu-send-quote-service';
import { CashuSendSwapService } from './cashu-send-swap-service';

// ---------------------------------------------------------------------------
// The domain constructs its repos/services internally, so we spy on the real
// class prototypes + the lnurl resolver to drive composition without hitting
// the DB / a wallet / the network. spyOn (reverted by mock.restore) is used
// rather than mock.module so sibling test files keep the real implementations.
// ---------------------------------------------------------------------------

function btc(sats: number): Money<Currency> {
  return new Money({
    amount: sats,
    currency: 'BTC',
    unit: 'sat',
  }) as Money<Currency>;
}

const cashuAccount = {
  id: 'acc-1',
  type: 'cashu',
  currency: 'BTC',
  mintUrl: 'https://mint.test',
  wallet: { id: 'fake-wallet' },
} as unknown as CashuAccount;

/** Build a cashu account with a custom wallet for tests that exercise wallet methods. */
function cashuAccountWithWallet(wallet: Record<string, unknown>): CashuAccount {
  return { ...cashuAccount, wallet } as unknown as CashuAccount;
}

function makeCtx(): DomainContext {
  return {
    config: {
      storage: inMemoryStorage({ access_token: jwtWith({ sub: 'u1' }) }),
    } as unknown as SdkConfig,
    connections: {
      supabase: {} as unknown,
      encryption: {} as unknown,
      cashuCrypto: {} as unknown,
    } as unknown as DomainContext['connections'],
    emitter: new SdkEventEmitter<SdkEventMap>(),
  };
}

const fakeAccountRepo = (
  over: Partial<AccountRepository> = {},
): AccountRepository =>
  ({
    get: async (id: string) => (id === 'acc-1' ? cashuAccount : null),
    ...over,
  }) as unknown as AccountRepository;

// Spies on the real class prototypes + lnurl module.
const sendQuoteGetLightning = spyOn(
  CashuSendQuoteService.prototype,
  'getLightningQuote',
);
const sendQuoteCreate = spyOn(
  CashuSendQuoteService.prototype,
  'createSendQuote',
);
const sendQuoteInitiateSend = spyOn(
  CashuSendQuoteService.prototype,
  'initiateSend',
);
const sendQuoteMarkPending = spyOn(
  CashuSendQuoteService.prototype,
  'markSendQuoteAsPending',
);
const swapCreate = spyOn(CashuSendSwapService.prototype, 'create');
const receiveGetLightning = spyOn(
  CashuReceiveQuoteService.prototype,
  'getLightningQuote',
);
const receiveCreate = spyOn(
  CashuReceiveQuoteService.prototype,
  'createReceiveQuote',
);
const sendQuoteRepoGet = spyOn(CashuSendQuoteRepository.prototype, 'get');
const sendSwapRepoGet = spyOn(CashuSendSwapRepository.prototype, 'get');
const receiveQuoteRepoGet = spyOn(CashuReceiveQuoteRepository.prototype, 'get');
const getInvoiceFromLud16 = spyOn(lnurl, 'getInvoiceFromLud16');

afterAll(() => {
  for (const s of [
    sendQuoteGetLightning,
    sendQuoteCreate,
    sendQuoteInitiateSend,
    sendQuoteMarkPending,
    swapCreate,
    receiveGetLightning,
    receiveCreate,
    sendQuoteRepoGet,
    sendSwapRepoGet,
    receiveQuoteRepoGet,
    getInvoiceFromLud16,
  ]) {
    s.mockRestore();
  }
});

beforeEach(() => {
  for (const s of [
    sendQuoteGetLightning,
    sendQuoteCreate,
    sendQuoteInitiateSend,
    sendQuoteMarkPending,
    swapCreate,
    receiveGetLightning,
    receiveCreate,
    sendQuoteRepoGet,
    sendSwapRepoGet,
    receiveQuoteRepoGet,
    getInvoiceFromLud16,
  ]) {
    s.mockReset();
  }
  // Default repo gets: not found.
  sendQuoteRepoGet.mockResolvedValue(null);
  sendSwapRepoGet.mockResolvedValue(null);
  receiveQuoteRepoGet.mockResolvedValue(null);
});

describe('cashu domain', () => {
  it('receiveToken throws NotImplementedError', () => {
    const domain = createCashuDomain(makeCtx(), fakeAccountRepo());
    expect(() => domain.receive.receiveToken({} as never)).toThrow(
      NotImplementedError,
    );
  });

  it('createTokenQuote calls through to the swap service with senderPaysFee', async () => {
    const swap = { id: 'swap-1', state: 'DRAFT' };
    swapCreate.mockResolvedValue(swap as never);
    const domain = createCashuDomain(makeCtx(), fakeAccountRepo());

    const amount = btc(100);
    const result = await domain.send.createTokenQuote({
      account: cashuAccount,
      amount,
    });

    expect(result as unknown).toBe(swap);
    expect(swapCreate).toHaveBeenCalledTimes(1);
    expect(swapCreate.mock.calls[0][0] as unknown).toEqual({
      userId: 'u1',
      account: cashuAccount,
      amount,
      senderPaysFee: true,
    });
  });

  it('send.get returns the send quote when present', async () => {
    const quote = { id: 'q-1', state: 'UNPAID' };
    sendQuoteRepoGet.mockResolvedValue(quote as never);
    const domain = createCashuDomain(makeCtx(), fakeAccountRepo());

    const result = await domain.send.get('q-1');

    expect(result as unknown).toBe(quote);
    expect(sendQuoteRepoGet).toHaveBeenCalledWith('q-1');
    expect(sendSwapRepoGet).not.toHaveBeenCalled();
  });

  it('send.get falls back to the swap when no send quote', async () => {
    const swap = { id: 's-1', state: 'PENDING' };
    sendQuoteRepoGet.mockResolvedValue(null);
    sendSwapRepoGet.mockResolvedValue(swap as never);
    const domain = createCashuDomain(makeCtx(), fakeAccountRepo());

    const result = await domain.send.get('s-1');

    expect(result as unknown).toBe(swap);
    expect(sendQuoteRepoGet).toHaveBeenCalledWith('s-1');
    expect(sendSwapRepoGet).toHaveBeenCalledWith('s-1');
  });

  it('send.get returns null when neither exists', async () => {
    const domain = createCashuDomain(makeCtx(), fakeAccountRepo());
    const result = await domain.send.get('missing');
    expect(result).toBeNull();
  });

  it('receive.createLightningQuote composes getLightningQuote + createReceiveQuote', async () => {
    const lightningQuote = { mintQuote: { quote: 'mq-1' } };
    const receiveQuote = { id: 'rq-1', state: 'UNPAID' };
    receiveGetLightning.mockResolvedValue(lightningQuote as never);
    receiveCreate.mockResolvedValue(receiveQuote as never);
    const domain = createCashuDomain(makeCtx(), fakeAccountRepo());

    const amount = btc(50);
    const result = await domain.receive.createLightningQuote({
      account: cashuAccount,
      amount,
    });

    expect(result as unknown).toBe(receiveQuote);
    expect(receiveGetLightning.mock.calls[0][0] as unknown).toEqual({
      wallet: cashuAccount.wallet,
      amount,
    });
    expect(receiveCreate.mock.calls[0][0] as unknown).toEqual({
      userId: 'u1',
      account: cashuAccount,
      receiveType: 'LIGHTNING',
      lightningQuote,
      purpose: 'PAYMENT',
    });
  });

  it('receive.createLightningQuote forwards a non-default purpose', async () => {
    receiveGetLightning.mockResolvedValue({ mintQuote: {} } as never);
    receiveCreate.mockResolvedValue({ id: 'rq-2' } as never);
    const domain = createCashuDomain(makeCtx(), fakeAccountRepo());

    await domain.receive.createLightningQuote({
      account: cashuAccount,
      amount: btc(50),
      purpose: 'BUY_CASHAPP',
    });

    expect(
      (receiveCreate.mock.calls[0][0] as { purpose: string }).purpose,
    ).toBe('BUY_CASHAPP');
  });

  it('send.createLightningQuote (bolt11) previews then persists the quote', async () => {
    const lightningQuote = {
      paymentRequest: 'lnbc-direct',
      amountRequested: btc(100),
      amountRequestedInBtc: btc(100),
      meltQuote: { quote: 'melt-1', amount: 100, fee_reserve: 1 },
    };
    const sendQuote = { id: 'sq-1', state: 'UNPAID' };
    sendQuoteGetLightning.mockResolvedValue(lightningQuote as never);
    sendQuoteCreate.mockResolvedValue(sendQuote as never);
    const domain = createCashuDomain(makeCtx(), fakeAccountRepo());

    const result = await domain.send.createLightningQuote({
      account: cashuAccount,
      destination: 'lnbc-direct',
    });

    expect(result as unknown).toBe(sendQuote);
    expect(getInvoiceFromLud16).not.toHaveBeenCalled();
    expect(sendQuoteGetLightning.mock.calls[0][0]).toMatchObject({
      account: cashuAccount,
      paymentRequest: 'lnbc-direct',
    });
    const createArg = sendQuoteCreate.mock.calls[0][0] as {
      userId: string;
      destinationDetails?: unknown;
      sendQuote: { paymentRequest: string; meltQuote: unknown };
    };
    expect(createArg.userId).toBe('u1');
    expect(createArg.destinationDetails).toBeUndefined();
    expect(createArg.sendQuote.paymentRequest).toBe('lnbc-direct');
    expect(createArg.sendQuote.meltQuote).toEqual(lightningQuote.meltQuote);
  });

  it('send.createLightningQuote (ln-address) resolves the invoice + sets destinationDetails', async () => {
    getInvoiceFromLud16.mockResolvedValue({
      pr: 'lnbc-resolved',
      routes: [],
    } as never);
    const lightningQuote = {
      paymentRequest: 'lnbc-resolved',
      amountRequested: btc(100),
      amountRequestedInBtc: btc(100),
      meltQuote: { quote: 'melt-2', amount: 100, fee_reserve: 1 },
    };
    sendQuoteGetLightning.mockResolvedValue(lightningQuote as never);
    sendQuoteCreate.mockResolvedValue({ id: 'sq-2' } as never);
    const domain = createCashuDomain(makeCtx(), fakeAccountRepo());

    await domain.send.createLightningQuote({
      account: cashuAccount,
      destination: 'alice@example.com',
      amount: btc(100),
    });

    expect(getInvoiceFromLud16).toHaveBeenCalledTimes(1);
    const [lnAddr, amountArg] = getInvoiceFromLud16.mock.calls[0] as [
      string,
      Money<'BTC'>,
    ];
    expect(lnAddr).toBe('alice@example.com');
    expect(amountArg.currency).toBe('BTC');
    expect(sendQuoteGetLightning.mock.calls[0][0]).toMatchObject({
      paymentRequest: 'lnbc-resolved',
    });
    const createArg = sendQuoteCreate.mock.calls[0][0] as {
      destinationDetails?: { sendType: string; lnAddress: string };
    };
    expect(createArg.destinationDetails).toEqual({
      sendType: 'LN_ADDRESS',
      lnAddress: 'alice@example.com',
    });
  });

  it('send.createLightningQuote (ln-address) surfaces an LNURL error', async () => {
    getInvoiceFromLud16.mockResolvedValue({
      status: 'ERROR',
      reason: 'bad address',
    } as never);
    const domain = createCashuDomain(makeCtx(), fakeAccountRepo());

    await expect(
      domain.send.createLightningQuote({
        account: cashuAccount,
        destination: 'alice@example.com',
        amount: btc(100),
      }),
    ).rejects.toThrow('bad address');
  });

  it('send.createLightningQuote (ln-address) requires an amount', async () => {
    const domain = createCashuDomain(makeCtx(), fakeAccountRepo());
    await expect(
      domain.send.createLightningQuote({
        account: cashuAccount,
        destination: 'alice@example.com',
      }),
    ).rejects.toThrow('Amount is required');
  });

  describe('cashu.send.executeQuote', () => {
    it('initiates the send and marks it pending, emitting send:pending', async () => {
      const account = cashuAccountWithWallet({
        checkMeltQuoteBolt11: async () => ({ quote: 'mq-1', amount: 100 }),
      });
      const pendingQuote = {
        id: 'sq-1',
        state: 'PENDING',
        transactionId: 'tx-1',
      } as unknown as CashuSendQuote;
      sendQuoteInitiateSend.mockResolvedValue(undefined as never);
      sendQuoteMarkPending.mockResolvedValue(pendingQuote as never);

      const ctx = makeCtx();
      const domain = createCashuDomain(
        ctx,
        fakeAccountRepo({
          get: async (id) => (id === 'acc-1' ? account : null),
        }),
      );
      const pendingEvents: unknown[] = [];
      ctx.emitter.on('send:pending', (e) => pendingEvents.push(e));

      const quote = {
        id: 'sq-1',
        state: 'UNPAID',
        accountId: 'acc-1',
        quoteId: 'mq-1',
      } as unknown as CashuSendQuote;
      const result = await domain.send.executeQuote(quote);

      expect(sendQuoteInitiateSend).toHaveBeenCalledTimes(1);
      expect(sendQuoteMarkPending).toHaveBeenCalledTimes(1);
      expect(result.state).toBe('PENDING');
      expect(pendingEvents).toEqual([
        { quoteId: 'sq-1', transactionId: 'tx-1', protocol: 'cashu' },
      ]);
    });

    it('propagates a DomainError from initiateSend (foreground surfaces fee/balance errors)', async () => {
      const account = cashuAccountWithWallet({
        checkMeltQuoteBolt11: async () => ({ quote: 'mq-1', amount: 100 }),
      });
      sendQuoteInitiateSend.mockRejectedValue(
        new DomainError(
          'Insufficient balance',
          'insufficient_balance',
        ) as never,
      );

      const domain = createCashuDomain(
        makeCtx(),
        fakeAccountRepo({
          get: async (id) => (id === 'acc-1' ? account : null),
        }),
      );
      const quote = {
        id: 'sq-1',
        state: 'UNPAID',
        accountId: 'acc-1',
        quoteId: 'mq-1',
      } as unknown as CashuSendQuote;

      await expect(domain.send.executeQuote(quote)).rejects.toMatchObject({
        code: 'insufficient_balance',
      });
    });
  });
});
