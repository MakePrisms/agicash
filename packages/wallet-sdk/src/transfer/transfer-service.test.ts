import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/utils/money';
import type { CashuAccount } from '../accounts/account';
import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import type { CashuReceiveQuoteService } from '../receive/cashu-receive-quote-service';
import type { SparkReceiveQuoteService } from '../receive/spark-receive-quote-service';
import type { CashuSendQuoteService } from '../send/cashu-send-quote-service';
import type { SparkSendQuoteService } from '../send/spark-send-quote-service';
import { type TransferQuote, TransferService } from './transfer-service';

const cashuAccount = {
  id: 'acc-1',
  type: 'cashu',
  name: 'Cashu',
} as unknown as CashuAccount;

const sats = (amount: number) =>
  new Money({ amount, currency: 'BTC', unit: 'sat' });

// Only the fields initiateTransfer's cashu path reads (persistSendQuote +
// persistReceiveQuote); getTransferQuote is not exercised here.
const baseQuote = (): TransferQuote =>
  ({
    amount: sats(1000),
    amountToReceive: sats(1000),
    totalFees: Money.zero('BTC'),
    totalCost: sats(1000),
    receive: {
      account: cashuAccount,
      fee: Money.zero('BTC'),
      lightningQuote: { mintQuote: { request: 'lnbc-receive' } },
    },
    send: {
      account: cashuAccount,
      lightningQuote: {
        paymentRequest: 'lnbc-send',
        amountRequested: sats(1000),
        amountRequestedInBtc: sats(1000),
        meltQuote: { quote: 'melt-1' },
      },
    },
  }) as unknown as TransferQuote;

describe('TransferService.initiateTransfer fail-cleanup', () => {
  it('fails the receive quote and rethrows when the send quote creation throws', async () => {
    const receiveQuote = {
      id: 'rq-1',
      transactionId: 'rx-1',
    } as unknown as CashuReceiveQuote;
    const sendError = new Error('send quote create failed');

    const createReceiveQuote = mock(async () => receiveQuote);
    const fail = mock(async (): Promise<void> => undefined);
    const createSendQuote = mock(async () => {
      throw sendError;
    });

    const service = new TransferService(
      {
        createReceiveQuote,
        fail,
      } as unknown as CashuReceiveQuoteService,
      {} as SparkReceiveQuoteService,
      { createSendQuote } as unknown as CashuSendQuoteService,
      {} as SparkSendQuoteService,
    );

    await expect(
      service.initiateTransfer({ userId: 'user-1', quote: baseQuote() }),
    ).rejects.toBe(sendError);

    expect(createReceiveQuote).toHaveBeenCalledTimes(1);
    expect(createSendQuote).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledWith(
      receiveQuote,
      'Transfer initiation failed',
    );
  });

  it('swallows a cleanup failure and still rethrows the original send error', async () => {
    const receiveQuote = {
      id: 'rq-2',
      transactionId: 'rx-2',
    } as unknown as CashuReceiveQuote;
    const sendError = new Error('send quote create failed');

    const createReceiveQuote = mock(async () => receiveQuote);
    const fail = mock(async () => {
      throw new Error('cleanup also failed');
    });
    const createSendQuote = mock(async () => {
      throw sendError;
    });

    const service = new TransferService(
      {
        createReceiveQuote,
        fail,
      } as unknown as CashuReceiveQuoteService,
      {} as SparkReceiveQuoteService,
      { createSendQuote } as unknown as CashuSendQuoteService,
      {} as SparkSendQuoteService,
    );

    await expect(
      service.initiateTransfer({ userId: 'user-2', quote: baseQuote() }),
    ).rejects.toBe(sendError);
    expect(fail).toHaveBeenCalledTimes(1);
  });
});

describe('TransferService.initiateTransfer happy path', () => {
  it('returns the transfer id and both transaction ids when both quotes persist', async () => {
    const receiveQuote = {
      id: 'rq-3',
      transactionId: 'receive-tx',
    } as unknown as CashuReceiveQuote;

    const createReceiveQuote = mock(async () => receiveQuote);
    const fail = mock(async (): Promise<void> => undefined);
    const createSendQuote = mock(async () => ({ transactionId: 'send-tx' }));

    const service = new TransferService(
      {
        createReceiveQuote,
        fail,
      } as unknown as CashuReceiveQuoteService,
      {} as SparkReceiveQuoteService,
      { createSendQuote } as unknown as CashuSendQuoteService,
      {} as SparkSendQuoteService,
    );

    const result = await service.initiateTransfer({
      userId: 'user-3',
      quote: baseQuote(),
    });

    expect(result.receiveTransactionId).toBe('receive-tx');
    expect(result.sendTransactionId).toBe('send-tx');
    expect(typeof result.transferId).toBe('string');
    expect(result.transferId.length).toBeGreaterThan(0);
    expect(fail).not.toHaveBeenCalled();
  });
});
