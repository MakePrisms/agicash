import { describe, expect, mock, test } from 'bun:test';
import type { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import type { SparkReceiveQuoteService } from './spark-receive-quote-service';
import type { CashuSendQuoteService } from './cashu-send-quote-service';
import type { SparkSendQuoteService } from './spark-send-quote-service';
import {
  TransferService,
  type TransferQuoteInternal,
} from './transfer-service';
import type { CashuAccount, SparkAccount } from '../types/account';
import { type Currency, Money } from '../types/money';

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

// The SEND leg is SPARK (canSendToLightning short-circuits `true` for spark; the send leg uses the
// stubbable `sparkSendQuoteService.getLightningSendQuote`). The RECEIVE leg is CASHU (it uses the
// stubbable `cashuReceiveQuoteService.getLightningQuote`; the gate `canReceiveFromLightning` reads
// `getMintInfo().isSupported(4)` — NUT-04 mint enabled). This avoids the two standalone-core paths
// (spark RECEIVE core + cashu SEND core) that would need a live wallet to stub.
const sparkSource = {
  id: 'spark-src',
  name: 'Spark',
  type: 'spark',
  currency: 'BTC',
  wallet: {},
} as unknown as SparkAccount;

const cashuDest = {
  id: 'cashu-dst',
  name: 'Mint',
  type: 'cashu',
  purpose: 'transactional',
  isOnline: true,
  isTestMint: false,
  currency: 'BTC',
  wallet: {
    getMintInfo: () => ({ isSupported: () => ({ disabled: false }) }),
  },
} as unknown as CashuAccount;

/**
 * Build a `TransferService` whose receive leg (cashu) yields a known mint-quote invoice + the send
 * leg (spark) yields a known fee estimate. `failSendPersist` makes the send-quote persist throw (to
 * exercise the auto-fail-the-receive path). Returns the service + the receive/send spies.
 */
function buildService({
  failSendPersist = false,
}: { failSendPersist?: boolean } = {}) {
  const cashuReceiveQuoteService = {
    getLightningQuote: mock(async () => ({
      mintQuote: { request: 'lnbc-dest' },
      mintingFee: sats(0),
    })),
    createReceiveQuote: mock(async () => ({ transactionId: 'rx-tx' })),
    fail: mock(async () => undefined),
  } as unknown as CashuReceiveQuoteService;

  const sparkReceiveQuoteService = {
    getLightningQuote: mock(async () => ({})),
    createReceiveQuote: mock(async () => ({ transactionId: 'rx-tx' })),
    fail: mock(async () => undefined),
  } as unknown as SparkReceiveQuoteService;

  const cashuSendQuoteService = {
    getLightningQuote: mock(async () => ({})),
    createSendQuote: mock(async () => ({ transactionId: 'tx-tx' })),
  } as unknown as CashuSendQuoteService;

  const sparkSendQuoteService = {
    getLightningSendQuote: mock(async () => ({
      amountToReceive: sats(100),
      estimatedTotalFee: sats(5),
    })),
    createSendQuote: failSendPersist
      ? mock(async () => {
          throw new Error('send persist failed');
        })
      : mock(async () => ({ transactionId: 'tx-tx' })),
  } as unknown as SparkSendQuoteService;

  const service = new TransferService(
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
    cashuSendQuoteService,
    sparkSendQuoteService,
  );
  return {
    service,
    sparkSendQuoteService,
    cashuReceiveQuoteService,
  };
}

describe('TransferService.getTransferQuote (composes a send leg + a receive leg)', () => {
  test('quotes both legs and sums fees/cost', async () => {
    const { service, cashuReceiveQuoteService, sparkSendQuoteService } =
      buildService();

    const quote = await service.getTransferQuote({
      sourceAccount: sparkSource,
      destinationAccount: cashuDest,
      amount: sats(100),
    });

    // The receive (cashu) leg + the send (spark) leg were BOTH quoted.
    expect(cashuReceiveQuoteService.getLightningQuote).toHaveBeenCalledTimes(1);
    expect(sparkSendQuoteService.getLightningSendQuote).toHaveBeenCalledTimes(
      1,
    );
    // The source leg paid the invoice (the destination mint-quote request) the receive leg produced.
    expect(sparkSendQuoteService.getLightningSendQuote).toHaveBeenCalledWith({
      account: sparkSource,
      paymentRequest: 'lnbc-dest',
    });
    // Money is compared by value (.toString()) — distinct equal instances aren't toEqual in bun.
    expect(quote.amount.toString()).toBe(sats(100).toString());
    expect(quote.amountToReceive.toString()).toBe(sats(100).toString());
    // totalFees = send estimatedTotalFee (5) + receive fee (cashu mintingFee = 0).
    expect(quote.totalFees.toString()).toBe(sats(5).toString());
    expect(quote.totalCost.toString()).toBe(sats(105).toString());
  });

  test('rejects when the destination cannot receive over Lightning (a test mint)', async () => {
    const { service } = buildService();
    const testMintDest = {
      ...cashuDest,
      isTestMint: true,
    } as unknown as CashuAccount;

    await expect(
      service.getTransferQuote({
        sourceAccount: sparkSource,
        destinationAccount: testMintDest,
        amount: sats(100),
      }),
    ).rejects.toThrow('cannot receive Lightning payments');
  });
});

describe('TransferService.initiateTransfer (auto-fail-receive-on-send-fail, §9)', () => {
  /** A valid internal quote (cashu receive leg + spark send leg). */
  function internalQuote(): TransferQuoteInternal {
    return {
      amount: sats(100),
      amountToReceive: sats(100),
      totalFees: sats(5),
      totalCost: sats(105),
      receive: {
        account: cashuDest,
        fee: sats(0),
        lightningQuote: {
          mintQuote: { request: 'lnbc-dest' },
        } as never,
      },
      send: {
        account: sparkSource,
        lightningQuote: {
          amountToReceive: sats(100),
          estimatedTotalFee: sats(5),
        } as never,
      },
    };
  }

  test('persists both legs and returns the transferId + both transaction ids', async () => {
    const { service } = buildService();

    const result = await service.initiateTransfer({
      userId: 'u1',
      quote: internalQuote(),
    });

    expect(result.receiveTransactionId).toBe('rx-tx');
    expect(result.sendTransactionId).toBe('tx-tx');
    expect(typeof result.transferId).toBe('string');
    expect(result.transferId.length).toBeGreaterThan(0);
  });

  test('when the SEND persist fails, the already-persisted RECEIVE quote is auto-failed', async () => {
    const { service, cashuReceiveQuoteService } = buildService({
      failSendPersist: true,
    });

    await expect(
      service.initiateTransfer({ userId: 'u1', quote: internalQuote() }),
    ).rejects.toThrow('send persist failed');

    // The receive quote must be failed to avoid an orphaned credit.
    expect(cashuReceiveQuoteService.fail).toHaveBeenCalledTimes(1);
    expect(cashuReceiveQuoteService.fail).toHaveBeenCalledWith(
      { transactionId: 'rx-tx' },
      'Transfer initiation failed',
    );
  });
});
