import type { Token } from '@cashu/cashu-ts';
import type { Account, CashuAccount } from '../../types/account';
import type { CashuReceiveQuote, CashuReceiveSwap } from '../../types/cashu';
import type { SparkReceiveQuote } from '../../types/spark';
import type { CashuReceiveSwapService } from '../../domains/cashu/cashu-receive-swap-service';
import { isClaimingToSameCashuAccount } from '../../domains/cashu/receive-cashu-token-models';
import type { ReceiveCashuTokenQuoteService } from './receive-cashu-token-quote-service';

export type ClaimCashuTokenServiceDeps = {
  receiveSwapService: CashuReceiveSwapService;
  receiveCashuTokenQuoteService: ReceiveCashuTokenQuoteService;
  getRate: (ticker: string) => Promise<string>;
};

/**
 * Claims a cashu token. Same mint+currency → a free receive-swap (returned as a
 * CashuReceiveSwap). Otherwise melt-then-mint into the destination account: create
 * the cross-account quotes, kick off the SOURCE melt, and return the destination
 * receive quote (cashu or spark). Completion is driven by the background orchestrators.
 */
export class ClaimCashuTokenService {
  constructor(private readonly deps: ClaimCashuTokenServiceDeps) {}

  async claimToken({
    userId,
    token,
    sourceAccount,
    destinationAccount,
  }: {
    userId: string;
    token: Token;
    sourceAccount: CashuAccount;
    destinationAccount: Account;
  }): Promise<CashuReceiveQuote | SparkReceiveQuote | CashuReceiveSwap> {
    if (isClaimingToSameCashuAccount(destinationAccount, sourceAccount)) {
      const { swap } = await this.deps.receiveSwapService.create({
        userId,
        token,
        account: destinationAccount as CashuAccount,
      });
      return swap;
    }

    const exchangeRate = await this.deps.getRate(
      `${sourceAccount.currency}-${destinationAccount.currency}`,
    );
    const quotes = await this.deps.receiveCashuTokenQuoteService.createCrossAccountReceiveQuotes({
      userId,
      token,
      sourceAccount,
      destinationAccount,
      exchangeRate,
    });

    // Kick off the source-mint melt. Random change outputs (change is discarded
    // here, see CashuTokenMeltData) avoid counter collisions with the source
    // account's persisted keyset counter. Idempotent: safe if a retry re-melts.
    await sourceAccount.wallet.meltProofsIdempotent(
      quotes.cashuMeltQuote,
      token.proofs,
      undefined,
      { type: 'random' },
    );

    return quotes.destinationType === 'cashu'
      ? quotes.cashuReceiveQuote
      : quotes.sparkReceiveQuote;
  }
}
