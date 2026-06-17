import { describe, expect, it, mock } from 'bun:test';
import type { Token } from '@cashu/cashu-ts';
import { Money } from '@agicash/money';
import type { CashuAccount, SparkAccount } from '../../types/account';
import type { CashuReceiveSwapService } from '../../domains/cashu/cashu-receive-swap-service';
import type { ReceiveCashuTokenQuoteService } from './receive-cashu-token-quote-service';
import { ClaimCashuTokenService } from './claim-cashu-token-service';

const token = { mint: 'https://mint.a', unit: 'sat', proofs: [{ amount: 10 }] } as unknown as Token;

function cashuAccount(id: string, mintUrl: string): CashuAccount {
  return { id, type: 'cashu', currency: 'BTC', mintUrl, wallet: { meltProofsIdempotent: mock(async () => ({})) } } as unknown as CashuAccount;
}

describe('ClaimCashuTokenService.claimToken', () => {
  it('same mint+currency → creates a receive swap and returns it', async () => {
    const source = cashuAccount('src', 'https://mint.a');
    const dest = cashuAccount('src', 'https://mint.a'); // same account
    const swap = { tokenHash: 'h', state: 'PENDING' };
    const receiveSwapService = { create: mock(async () => ({ swap, account: dest })) } as unknown as CashuReceiveSwapService;
    const service = new ClaimCashuTokenService({
      receiveSwapService,
      receiveCashuTokenQuoteService: {} as ReceiveCashuTokenQuoteService,
      getRate: mock(async () => '1'),
    });
    const result = await service.claimToken({ userId: 'u1', token, sourceAccount: source, destinationAccount: dest });
    expect(receiveSwapService.create).toHaveBeenCalledTimes(1);
    expect(result as unknown).toBe(swap);
  });

  it('different mint → creates cross-account quotes, melts the source, returns the destination quote', async () => {
    const source = cashuAccount('src', 'https://mint.a');
    const dest = cashuAccount('dst', 'https://mint.b');
    const cashuReceiveQuote = { id: 'dest-rq' };
    const createCrossAccountReceiveQuotes = mock(async () => ({
      destinationType: 'cashu',
      destinationAccount: dest,
      cashuReceiveQuote,
      cashuMeltQuote: { quote: 'src-melt', amount: 9, fee_reserve: 1 },
      lightningReceiveQuote: { id: 'dest-rq', paymentRequest: 'pr', amount: new Money({ amount: 9, currency: 'BTC', unit: 'sat' }), transactionId: 'tx', destinationType: 'cashu' },
    }));
    const service = new ClaimCashuTokenService({
      receiveSwapService: {} as CashuReceiveSwapService,
      receiveCashuTokenQuoteService: { createCrossAccountReceiveQuotes } as unknown as ReceiveCashuTokenQuoteService,
      getRate: mock(async () => '1'),
    });
    const result = await service.claimToken({ userId: 'u1', token, sourceAccount: source, destinationAccount: dest });
    expect(createCrossAccountReceiveQuotes).toHaveBeenCalledTimes(1);
    expect(source.wallet.meltProofsIdempotent).toHaveBeenCalledTimes(1);
    expect(result as unknown).toBe(cashuReceiveQuote);
  });

  it('cross-account to spark → returns the spark receive quote', async () => {
    const source = cashuAccount('src', 'https://mint.a');
    const dest = { id: 'spark', type: 'spark', currency: 'BTC', wallet: {} } as unknown as SparkAccount;
    const sparkReceiveQuote = { id: 'spark-rq' };
    const createCrossAccountReceiveQuotes = mock(async () => ({
      destinationType: 'spark',
      destinationAccount: dest,
      sparkReceiveQuote,
      cashuMeltQuote: { quote: 'src-melt', amount: 9, fee_reserve: 1 },
      lightningReceiveQuote: { id: 'spark-rq', paymentRequest: 'pr', amount: new Money({ amount: 9, currency: 'BTC', unit: 'sat' }), transactionId: 'tx', destinationType: 'spark' },
    }));
    const service = new ClaimCashuTokenService({
      receiveSwapService: {} as CashuReceiveSwapService,
      receiveCashuTokenQuoteService: { createCrossAccountReceiveQuotes } as unknown as ReceiveCashuTokenQuoteService,
      getRate: mock(async () => '1'),
    });
    const result = await service.claimToken({ userId: 'u1', token, sourceAccount: source, destinationAccount: dest });
    expect(result as unknown).toBe(sparkReceiveQuote);
  });
});
