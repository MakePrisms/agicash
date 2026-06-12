import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/utils/money';
import type { CashuAccount } from '../accounts/account';
import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import type { CashuReceiveQuoteService } from '../receive/cashu-receive-quote-service';
import type { SparkReceiveQuoteService } from '../receive/spark-receive-quote-service';
import type { CashuSendQuoteService } from '../send/cashu-send-quote-service';
import type { SparkSendQuoteService } from '../send/spark-send-quote-service';
import { createTransferApi } from './transfer-api';
import type { TransferQuote } from './transfer-service';

const cashuAccount = {
  id: 'acc-1',
  type: 'cashu',
  name: 'Cashu',
} as unknown as CashuAccount;

const sats = (amount: number) =>
  new Money({ amount, currency: 'BTC', unit: 'sat' });

const quote = {
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
} as unknown as TransferQuote;

describe('createTransferApi initiateTransfer identity', () => {
  it('derives the user id from getCurrentUserId, not the caller', async () => {
    const receiveQuote = {
      id: 'rq-1',
      transactionId: 'receive-tx',
    } as unknown as CashuReceiveQuote;
    const createReceiveQuote = mock(async () => receiveQuote);
    const createSendQuote = mock(async () => ({ transactionId: 'send-tx' }));

    const { api } = createTransferApi({
      getCurrentUserId: () => 'derived-user',
      cashuReceiveQuoteService: {
        createReceiveQuote,
        fail: mock(async (): Promise<void> => undefined),
      } as unknown as CashuReceiveQuoteService,
      sparkReceiveQuoteService: {} as SparkReceiveQuoteService,
      cashuSendQuoteService: {
        createSendQuote,
      } as unknown as CashuSendQuoteService,
      sparkSendQuoteService: {} as SparkSendQuoteService,
    });

    const result = await api.initiateTransfer({ quote });

    expect(result).toEqual({
      transferId: expect.any(String),
      receiveTransactionId: 'receive-tx',
      sendTransactionId: 'send-tx',
    });
    expect(createReceiveQuote).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'derived-user' }),
    );
    expect(createSendQuote).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'derived-user' }),
    );
  });
});
