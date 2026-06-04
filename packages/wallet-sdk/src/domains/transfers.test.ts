import { describe, expect, mock, test } from 'bun:test';
import { TransfersDomainImpl } from './transfers';
import type { SessionResolver } from '../internal/session';
import type {
  TransferQuoteInternal,
  TransferService,
} from '../internal/transfer-service';
import type { CashuAccount, SparkAccount } from '../types/account';
import { type Currency, Money } from '../types/money';
import type { TransferQuote } from '../types/transfer';

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

const cashuSource = { id: 'cashu-src', type: 'cashu' } as CashuAccount;
const sparkDest = { id: 'spark-dst', type: 'spark' } as SparkAccount;

const session = {
  requireCurrentUser: mock(async () => ({ id: 'u1' })),
} as unknown as SessionResolver;

/** An internal transfer quote (with live legs) the fake service returns from getTransferQuote. */
const internal: TransferQuoteInternal = {
  amount: sats(100),
  amountToReceive: sats(98),
  totalFees: sats(2),
  totalCost: sats(100),
  receive: { account: sparkDest, fee: sats(0), lightningQuote: {} as never },
  send: { account: cashuSource, lightningQuote: {} as never },
};

describe('TransfersDomain createQuote → executeQuote (two-mode full-object carry)', () => {
  test('createQuote returns the SLIM public quote (no live lightningQuote leaks)', async () => {
    const transferService = {
      getTransferQuote: mock(async () => internal),
      initiateTransfer: mock(async () => ({
        transferId: 't',
        receiveTransactionId: 'r',
        sendTransactionId: 's',
      })),
    } as unknown as TransferService;
    const domain = new TransfersDomainImpl(transferService, session);

    const quote = await domain.createQuote({
      sourceAccount: cashuSource,
      destinationAccount: sparkDest,
      amount: sats(100),
    });

    expect(quote.amount.toString()).toBe(sats(100).toString());
    expect(quote.amountToReceive.toString()).toBe(sats(98).toString());
    expect(quote.totalFees.toString()).toBe(sats(2).toString());
    expect(quote.totalCost.toString()).toBe(sats(100).toString());
    // The public legs carry only { account, fee } — the live lightningQuote stays internal.
    expect(quote.receive.account).toBe(sparkDest);
    expect(quote.send.account).toBe(cashuSource);
    expect(
      (quote.receive as { lightningQuote?: unknown }).lightningQuote,
    ).toBeUndefined();
    // The slim shape does not enumerate the internal carrier.
    expect(Object.keys(quote)).toEqual([
      'amount',
      'amountToReceive',
      'totalFees',
      'totalCost',
      'receive',
      'send',
    ]);
  });

  test('executeQuote recovers the internal (live-leg) quote and initiates the transfer with it', async () => {
    const transferService = {
      getTransferQuote: mock(async () => internal),
      initiateTransfer: mock(async () => ({
        transferId: 't1',
        receiveTransactionId: 'rx',
        sendTransactionId: 'tx',
      })),
    } as unknown as TransferService;
    const domain = new TransfersDomainImpl(transferService, session);

    const quote = await domain.createQuote({
      sourceAccount: cashuSource,
      destinationAccount: sparkDest,
      amount: sats(100),
    });
    const result = await domain.executeQuote(quote);

    // The EXACT internal quote (with the live legs) was handed to initiateTransfer.
    expect(transferService.initiateTransfer).toHaveBeenCalledWith({
      userId: 'u1',
      quote: internal,
    });
    expect(result).toEqual({
      transferId: 't1',
      receiveTransactionId: 'rx',
      sendTransactionId: 'tx',
    });
  });

  test('executeQuote rejects a quote not produced by createQuote (missing live legs)', async () => {
    const transferService = {
      getTransferQuote: mock(async () => internal),
      initiateTransfer: mock(async () => ({
        transferId: 't',
        receiveTransactionId: 'r',
        sendTransactionId: 's',
      })),
    } as unknown as TransferService;
    const domain = new TransfersDomainImpl(transferService, session);

    // A hand-built public quote (no internal carrier) cannot be executed.
    const foreign: TransferQuote = {
      amount: sats(100),
      amountToReceive: sats(98),
      totalFees: sats(2),
      totalCost: sats(100),
      receive: { account: sparkDest, fee: sats(0) },
      send: { account: cashuSource, fee: sats(2) },
    };

    await expect(domain.executeQuote(foreign)).rejects.toThrow(
      'must be created via transfers.createQuote',
    );
    expect(transferService.initiateTransfer).not.toHaveBeenCalled();
  });
});
