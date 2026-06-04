/**
 * Cross-account cashu-token receive QUOTE service — Slice 3 / PR5d.
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/receive/receive-cashu-token-quote-service.ts`. Master's
 * `ReceiveCashuTokenQuoteService` is ALREADY a plain class (only `useReceiveCashuTokenQuoteService`
 * couples it to React) over the cashu + spark receive-quote services — lifted near-verbatim,
 * dropping the factory.
 *
 * It builds the paired quotes for a CROSS-account cashu-token claim (token → a DIFFERENT cashu
 * mint, or token → spark): it iterates a SOURCE-mint melt quote against a DESTINATION mint/spark
 * mint quote until the melt covers the destination amount, then persists a CASHU_TOKEN receive
 * quote on the destination. The orchestrator's cross-account melt machine
 * (`stepCashuTokenReceiveMelt` / `stepSparkTokenReceiveMelt`) then drives the source melt and the
 * destination completion.
 *
 * @module
 */
import type { MeltQuoteBolt11Response, Token } from '@cashu/cashu-ts';
import type { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import type { CashuReceiveLightningQuote } from './cashu-receive-quote-core';
import { getCashuUnit, tokenToMoney } from './lib-cashu-quotes';
import type { SparkReceiveQuoteService } from './spark-receive-quote-service';
import type { SparkReceiveLightningQuote } from './spark-receive-quote-core';
import { getLightningQuote as getSparkLightningQuote } from './spark-receive-quote-core';
import { DomainError } from '../errors';
import type { Account, CashuAccount, SparkAccount } from '../types/account';
import { type Currency, Money } from '../types/money';
import type { CashuReceiveQuote } from '../types/cashu';
import type { SparkReceiveQuote } from '../types/spark';

/** Params for {@link ReceiveCashuTokenQuoteService.createCrossAccountReceiveQuotes} (master verbatim). */
type CreateCrossAccountReceiveQuotesProps = {
  /** ID of the receiving user. */
  userId: string;
  /** The token to claim. */
  token: Token;
  /** The account to claim the token to (a DIFFERENT mint/currency than the source). */
  destinationAccount: Account;
  /** The account to claim the token from (a placeholder if the user has no account for the mint). */
  sourceAccount: CashuAccount;
  /** The source→destination exchange rate (string Big; `'1'` for same-currency). */
  exchangeRate: string;
};

/**
 * The result of building cross-account receive quotes. A discriminated union on the destination
 * account type: a cashu destination carries the {@link CashuReceiveQuote} to complete after the
 * melt, a spark destination the {@link SparkReceiveQuote}. Master verbatim.
 */
export type CrossAccountReceiveQuotesResult = {
  /** The melt quote on the SOURCE mint (the token proofs are melted against it). */
  cashuMeltQuote: MeltQuoteBolt11Response;
} & (
  | {
      destinationType: 'cashu';
      destinationAccount: CashuAccount;
      cashuReceiveQuote: CashuReceiveQuote;
    }
  | {
      destinationType: 'spark';
      destinationAccount: SparkAccount;
      sparkReceiveQuote: SparkReceiveQuote;
    }
);

/** Cross-account cashu-token receive quote builder (master verbatim, framework-free). */
export class ReceiveCashuTokenQuoteService {
  constructor(
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
    private readonly sparkReceiveQuoteService: SparkReceiveQuoteService,
  ) {}

  /**
   * Build the paired source-melt + destination-mint quotes for a cross-account token claim and
   * persist the destination receive quote (CASHU_TOKEN). Master verbatim.
   *
   * @throws DomainError if the token is too small to cover the cashu/lightning fees.
   */
  async createCrossAccountReceiveQuotes({
    userId,
    token,
    sourceAccount,
    destinationAccount,
    exchangeRate,
  }: CreateCrossAccountReceiveQuotesProps): Promise<CrossAccountReceiveQuotesResult> {
    const tokenAmount = tokenToMoney(token);
    const sourceCashuUnit = getCashuUnit(sourceAccount.currency);

    const feesForProofs = sourceAccount.wallet.getFeesForProofs(token.proofs);
    const cashuReceiveFee = new Money({
      amount: feesForProofs,
      currency: tokenAmount.currency,
      unit: sourceCashuUnit,
    });

    const targetAmount = tokenAmount.subtract(cashuReceiveFee);

    if (targetAmount.isNegative()) {
      throw new DomainError('Token amount is too small to cover cashu fees.');
    }

    const quotes = await this.getCrossMintQuotesWithinTargetAmount({
      destinationAccount,
      sourceAccount,
      targetAmount,
      exchangeRate,
      description: token.memo,
    });

    const meltQuoteExpiresAt = new Date(
      quotes.meltQuote.expiry * 1000,
    ).toISOString();

    const lightningFeeReserve = new Money({
      amount: quotes.meltQuote.fee_reserve,
      currency: tokenAmount.currency,
      unit: sourceCashuUnit,
    });

    if (destinationAccount.type === 'cashu') {
      const cashuReceiveQuote =
        await this.cashuReceiveQuoteService.createReceiveQuote({
          userId,
          account: destinationAccount,
          receiveType: 'CASHU_TOKEN',
          lightningQuote: quotes.lightningQuote as CashuReceiveLightningQuote,
          tokenAmount,
          sourceMintUrl: sourceAccount.mintUrl,
          tokenProofs: token.proofs,
          meltQuoteId: quotes.meltQuote.quote,
          meltQuoteExpiresAt,
          cashuReceiveFee,
          lightningFeeReserve,
        });

      return {
        destinationType: 'cashu',
        destinationAccount,
        cashuReceiveQuote,
        cashuMeltQuote: quotes.meltQuote,
      };
    }

    const sparkReceiveQuote =
      await this.sparkReceiveQuoteService.createReceiveQuote({
        userId,
        account: destinationAccount,
        receiveType: 'CASHU_TOKEN',
        lightningQuote: quotes.lightningQuote as SparkReceiveLightningQuote,
        tokenAmount,
        sourceMintUrl: sourceAccount.mintUrl,
        tokenProofs: token.proofs,
        meltQuoteId: quotes.meltQuote.quote,
        meltQuoteExpiresAt,
        cashuReceiveFee,
        lightningFeeReserve,
      });

    return {
      destinationType: 'spark',
      destinationAccount,
      sparkReceiveQuote,
      cashuMeltQuote: quotes.meltQuote,
    };
  }

  /**
   * Iterate the source melt quote against the destination mint quote until the melt (amount +
   * reserve) covers the destination amount (or 5 attempts). Master verbatim.
   *
   * @throws DomainError if the token is too small; Error if no valid quote is found in 5 tries.
   */
  private async getCrossMintQuotesWithinTargetAmount({
    destinationAccount,
    sourceAccount,
    targetAmount,
    exchangeRate,
    description,
  }: {
    destinationAccount: Account;
    sourceAccount: CashuAccount;
    targetAmount: Money;
    exchangeRate: string;
    description?: string;
  }): Promise<{
    lightningQuote: CashuReceiveLightningQuote | SparkReceiveLightningQuote;
    meltQuote: MeltQuoteBolt11Response;
    amountToMint: Money;
  }> {
    const sourceCurrency = sourceAccount.currency;
    const destinationCurrency = destinationAccount.currency;

    let attempts = 0;
    let amountToMelt = targetAmount;

    while (attempts < 5) {
      attempts++;

      const amountToMint = amountToMelt.convert(
        destinationCurrency,
        exchangeRate,
      );
      const amountToMintNumber = amountToMint.toNumber(
        getCashuUnit(destinationCurrency),
      );

      if (amountToMintNumber < 1) {
        throw new DomainError('Token amount is too small to cover the fees.');
      }

      const { lightningQuote, paymentRequest } =
        await this.getLightningQuoteForDestinationAccount({
          destinationAccount,
          amount: amountToMint,
          description,
        });

      const meltQuote =
        await sourceAccount.wallet.createMeltQuoteBolt11(paymentRequest);

      const amountRequired = new Money({
        amount: meltQuote.amount + meltQuote.fee_reserve,
        currency: sourceCurrency,
        unit: getCashuUnit(sourceCurrency),
      });

      const diff = amountRequired.subtract(targetAmount);

      if (diff.lessThanOrEqual(Money.zero(diff.currency as Currency))) {
        return {
          meltQuote,
          amountToMint,
          lightningQuote,
        };
      }

      amountToMelt = amountToMelt.subtract(diff);
    }

    throw new Error('Failed to find valid quotes after 5 attempts.');
  }

  /** Create the destination mint/spark quote (the lightning invoice the melt pays). Master verbatim. */
  private async getLightningQuoteForDestinationAccount({
    destinationAccount,
    amount,
    description,
  }: {
    destinationAccount: Account;
    amount: Money;
    description?: string;
  }): Promise<{
    lightningQuote: CashuReceiveLightningQuote | SparkReceiveLightningQuote;
    paymentRequest: string;
  }> {
    if (destinationAccount.type === 'spark') {
      const lightningQuote = await getSparkLightningQuote({
        wallet: destinationAccount.wallet,
        amount,
      });

      return {
        lightningQuote,
        paymentRequest: lightningQuote.invoice.paymentRequest,
      };
    }

    const lightningQuote =
      await this.cashuReceiveQuoteService.getLightningQuote({
        wallet: destinationAccount.wallet,
        amount,
        description,
      });

    return {
      lightningQuote,
      paymentRequest: lightningQuote.mintQuote.request,
    };
  }
}
