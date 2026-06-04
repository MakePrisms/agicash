import { describe, expect, mock, test } from 'bun:test';
import { TransfersDomainImpl } from './transfers';
import type { SessionResolver } from '../internal/session';
import type { TransferService } from '../internal/transfer-service';
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

/**
 * The VERBATIM-FULL transfer quote the service returns from `getTransferQuote`: each leg carries
 * its live `lightningQuote` as a VISIBLE, plain-data field (no symbol carrier). This is exactly
 * what `createQuote` exposes and what `executeQuote` hands straight back to `initiateTransfer`.
 */
const fullQuote: TransferQuote = {
  amount: sats(100),
  amountToReceive: sats(98),
  totalFees: sats(2),
  totalCost: sats(100),
  receive: {
    account: sparkDest,
    fee: sats(0),
    lightningQuote: { invoice: { paymentRequest: 'lnbc-dest' } } as never,
  },
  send: {
    account: cashuSource,
    lightningQuote: { amountToReceive: sats(98) } as never,
  },
};

describe('TransfersDomain createQuote → executeQuote (verbatim-full quote, no symbol)', () => {
  test('createQuote returns the VERBATIM-FULL quote — legs are visible plain data WITH their lightningQuote', async () => {
    const transferService = {
      getTransferQuote: mock(async () => fullQuote),
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

    // The full quote IS what the service produced (no slim projection).
    expect(quote).toBe(fullQuote);
    expect(quote.amount.toString()).toBe(sats(100).toString());
    expect(quote.amountToReceive.toString()).toBe(sats(98).toString());
    expect(quote.totalFees.toString()).toBe(sats(2).toString());
    expect(quote.totalCost.toString()).toBe(sats(100).toString());
    // Both legs expose the account AND the live lightningQuote as VISIBLE plain-data fields.
    expect(quote.receive.account).toBe(sparkDest);
    expect(quote.send.account).toBe(cashuSource);
    expect(quote.receive.lightningQuote).toBeDefined();
    expect(quote.send.lightningQuote).toBeDefined();
    // The live legs ENUMERATE (no non-enumerable symbol carrier).
    expect(Object.keys(quote.receive)).toEqual([
      'account',
      'fee',
      'lightningQuote',
    ]);
    expect(Object.keys(quote.send)).toEqual(['account', 'lightningQuote']);
  });

  test('executeQuote reads the live legs DIRECTLY off the full quote and initiates the transfer with it', async () => {
    const transferService = {
      getTransferQuote: mock(async () => fullQuote),
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

    // The EXACT full quote (with the live legs) was handed to initiateTransfer — no recovery step.
    expect(transferService.initiateTransfer).toHaveBeenCalledWith({
      userId: 'u1',
      quote: fullQuote,
    });
    expect(result).toEqual({
      transferId: 't1',
      receiveTransactionId: 'rx',
      sendTransactionId: 'tx',
    });
  });

  test('executeQuote accepts ANY full quote (no "must be created via createQuote" guard)', async () => {
    const transferService = {
      getTransferQuote: mock(async () => fullQuote),
      initiateTransfer: mock(async () => ({
        transferId: 't2',
        receiveTransactionId: 'r2',
        sendTransactionId: 's2',
      })),
    } as unknown as TransferService;
    const domain = new TransfersDomainImpl(transferService, session);

    // A hand-built full quote (the verbatim-full shape, never passed through createQuote) executes
    // directly — the legs are just data; there is no provenance guard.
    const handBuilt: TransferQuote = {
      amount: sats(50),
      amountToReceive: sats(49),
      totalFees: sats(1),
      totalCost: sats(50),
      receive: {
        account: sparkDest,
        fee: sats(0),
        lightningQuote: { invoice: { paymentRequest: 'lnbc-x' } } as never,
      },
      send: {
        account: cashuSource,
        lightningQuote: { amountToReceive: sats(49) } as never,
      },
    };

    const result = await domain.executeQuote(handBuilt);

    expect(transferService.initiateTransfer).toHaveBeenCalledWith({
      userId: 'u1',
      quote: handBuilt,
    });
    expect(result.transferId).toBe('t2');
  });
});
