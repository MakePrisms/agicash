import { describe, expect, it, mock } from 'bun:test';
import type { MeltQuoteBolt11Response, Token } from '@cashu/cashu-ts';
import { Money } from '@agicash/money';
import type { CashuAccount, SparkAccount } from '../../types/account';
import type { CashuReceiveQuoteService } from '../../domains/cashu/cashu-receive-quote-service';
import type { SparkReceiveQuoteService } from '../../domains/spark/spark-receive-quote-service';
import type { SparkReceiveLightningQuote } from '../../domains/spark/spark-receive-quote-core';
import { ReceiveCashuTokenQuoteService } from './receive-cashu-token-quote-service';

const token = {
  mint: 'https://source.mint',
  unit: 'sat',
  proofs: [{ amount: 50, id: 'k', secret: 's', C: 'c' }],
} as unknown as Token;

function makeSourceAccount() {
  return {
    id: 'src',
    type: 'cashu',
    currency: 'BTC',
    mintUrl: 'https://source.mint',
    wallet: {
      getFeesForProofs: mock(() => 1),
      createMeltQuoteBolt11: mock(
        async (): Promise<MeltQuoteBolt11Response> =>
          ({ quote: 'src-melt', amount: 45, fee_reserve: 1, expiry: 9_999_999_999 }) as MeltQuoteBolt11Response,
      ),
    },
  } as unknown as CashuAccount;
}

describe('ReceiveCashuTokenQuoteService.createCrossAccountReceiveQuotes (cashu destination)', () => {
  it('creates the destination cashu receive quote linked to the source melt', async () => {
    const sourceAccount = makeSourceAccount();
    const destinationAccount = {
      id: 'dst',
      type: 'cashu',
      currency: 'BTC',
      mintUrl: 'https://dest.mint',
      wallet: {},
    } as unknown as CashuAccount;

    const cashuReceiveQuoteService = {
      getLightningQuote: mock(async () => ({
        mintQuote: { request: 'lnbc-dest' },
        amount: new Money({ amount: 45, currency: 'BTC', unit: 'sat' }),
      })),
      createReceiveQuote: mock(async () => ({
        id: 'dest-rq',
        paymentRequest: 'lnbc-dest',
        amount: new Money({ amount: 45, currency: 'BTC', unit: 'sat' }),
        transactionId: 'tx',
      })),
    } as unknown as CashuReceiveQuoteService;
    const sparkReceiveQuoteService = {} as unknown as SparkReceiveQuoteService;

    const service = new ReceiveCashuTokenQuoteService(
      cashuReceiveQuoteService,
      sparkReceiveQuoteService,
    );
    const result = await service.createCrossAccountReceiveQuotes({
      userId: 'u1',
      token,
      sourceAccount,
      destinationAccount,
      exchangeRate: '1',
    });

    expect(result.destinationType).toBe('cashu');
    expect(result.cashuMeltQuote.quote).toBe('src-melt');
    const createArg = (
      cashuReceiveQuoteService.createReceiveQuote as ReturnType<typeof mock>
    ).mock.calls[0][0] as {
      receiveType: string;
      meltQuoteId: string;
      sourceMintUrl: string;
    };
    expect(createArg.receiveType).toBe('CASHU_TOKEN');
    expect(createArg.meltQuoteId).toBe('src-melt');
    expect(createArg.sourceMintUrl).toBe('https://source.mint');
  });

  it('throws when the token cannot cover the cashu fee', async () => {
    const sourceAccount = makeSourceAccount();
    (sourceAccount.wallet.getFeesForProofs as ReturnType<typeof mock>).mockReturnValue(1000);
    const service = new ReceiveCashuTokenQuoteService(
      { getLightningQuote: mock(), createReceiveQuote: mock() } as never,
      {} as never,
    );
    await expect(
      service.createCrossAccountReceiveQuotes({
        userId: 'u1',
        token,
        sourceAccount,
        destinationAccount: {
          id: 'dst',
          type: 'cashu',
          currency: 'BTC',
          mintUrl: 'https://dest.mint',
          wallet: {},
        } as unknown as CashuAccount,
        exchangeRate: '1',
      }),
    ).rejects.toThrow();
  });
});

describe('ReceiveCashuTokenQuoteService.createCrossAccountReceiveQuotes (spark destination)', () => {
  it('creates the destination spark receive quote linked to the source melt', async () => {
    const sourceAccount = makeSourceAccount();
    const destinationAccount = {
      id: 'spark-dst',
      type: 'spark',
      currency: 'BTC',
      wallet: {},
    } as unknown as SparkAccount;

    const sparkLightningQuote: Partial<SparkReceiveLightningQuote> = {
      id: 'spark-lq',
      invoice: {
        paymentRequest: 'lnbc-spark',
        paymentHash: 'ph',
        amount: new Money({ amount: 45, currency: 'BTC', unit: 'sat' }),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    };

    const fakeGetSparkLightningQuote = mock(
      async () => sparkLightningQuote as SparkReceiveLightningQuote,
    );

    const cashuReceiveQuoteService = {} as unknown as CashuReceiveQuoteService;
    const sparkReceiveQuoteService = {
      createReceiveQuote: mock(async () => ({
        id: 'spark-rq',
        paymentRequest: 'lnbc-spark',
        amount: new Money({ amount: 45, currency: 'BTC', unit: 'sat' }),
        transactionId: 'tx',
      })),
    } as unknown as SparkReceiveQuoteService;

    const service = new ReceiveCashuTokenQuoteService(
      cashuReceiveQuoteService,
      sparkReceiveQuoteService,
      fakeGetSparkLightningQuote,
    );

    const result = await service.createCrossAccountReceiveQuotes({
      userId: 'u1',
      token,
      sourceAccount,
      destinationAccount,
      exchangeRate: '1',
    });

    expect(result.destinationType).toBe('spark');
    expect(result.cashuMeltQuote.quote).toBe('src-melt');
    expect(fakeGetSparkLightningQuote).toHaveBeenCalledTimes(1);

    const createArg = (
      sparkReceiveQuoteService.createReceiveQuote as ReturnType<typeof mock>
    ).mock.calls[0][0] as {
      receiveType: string;
      meltQuoteId: string;
      sourceMintUrl: string;
    };
    expect(createArg.receiveType).toBe('CASHU_TOKEN');
    expect(createArg.meltQuoteId).toBe('src-melt');
    expect(createArg.sourceMintUrl).toBe('https://source.mint');
  });
});
