import type { MeltQuoteBolt11Response, Token } from '@cashu/cashu-ts';
import { Money } from '@agicash/money';
import { DomainError } from '../../errors';
import type { Account, CashuAccount, SparkAccount } from '../../types/account';
import type { CashuReceiveQuote } from '../../types/cashu';
import type { SparkReceiveQuote } from '../../types/spark';
import type { CashuReceiveLightningQuote } from '../../domains/cashu/cashu-receive-quote-core';
import type { CashuReceiveQuoteService } from '../../domains/cashu/cashu-receive-quote-service';
import {
  type SparkReceiveLightningQuote,
  getLightningQuote as defaultGetSparkLightningQuote,
} from '../../domains/spark/spark-receive-quote-core';
import type { SparkReceiveQuoteService } from '../../domains/spark/spark-receive-quote-service';
import { isClaimingToSameCashuAccount } from '../../domains/cashu/receive-cashu-token-models';
import { getCashuUnit, tokenToMoney } from '../lib/cashu';

export type CreateCrossAccountReceiveQuotesProps = {
  userId: string;
  token: Token;
  destinationAccount: Account;
  sourceAccount: CashuAccount;
  exchangeRate: string;
};

type LightningReceiveQuote = {
  id: string;
  paymentRequest: string;
  amount: Money;
  transactionId: string;
  destinationType: 'cashu' | 'spark';
};

export type CrossAccountReceiveQuotesResult = {
  cashuMeltQuote: MeltQuoteBolt11Response;
  lightningReceiveQuote: LightningReceiveQuote;
} & (
  | { destinationType: 'cashu'; destinationAccount: CashuAccount; cashuReceiveQuote: CashuReceiveQuote }
  | { destinationType: 'spark'; destinationAccount: SparkAccount; sparkReceiveQuote: SparkReceiveQuote }
);

type GetSparkLightningQuoteParams = Parameters<typeof defaultGetSparkLightningQuote>[0];

export class ReceiveCashuTokenQuoteService {
  constructor(
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
    private readonly sparkReceiveQuoteService: SparkReceiveQuoteService,
    // Injected for testability; defaults to the real Spark core function.
    private readonly getSparkLightningQuote: (
      params: GetSparkLightningQuoteParams,
    ) => Promise<SparkReceiveLightningQuote> = defaultGetSparkLightningQuote,
  ) {}

  async createCrossAccountReceiveQuotes({
    userId,
    token,
    sourceAccount,
    destinationAccount,
    exchangeRate,
  }: CreateCrossAccountReceiveQuotesProps): Promise<CrossAccountReceiveQuotesResult> {
    const tokenAmount = tokenToMoney(token);

    if (isClaimingToSameCashuAccount(sourceAccount, destinationAccount)) {
      throw new DomainError(
        'Cannot melt a token to the same account it is from.',
        'same_account',
      );
    }

    const sourceCashuUnit = getCashuUnit(sourceAccount.currency);

    const feesForProofs = sourceAccount.wallet.getFeesForProofs(token.proofs);
    const cashuReceiveFee = new Money({
      amount: feesForProofs,
      currency: tokenAmount.currency,
      unit: sourceCashuUnit,
    });
    const targetAmount = tokenAmount.subtract(cashuReceiveFee);
    if (targetAmount.isNegative()) {
      throw new DomainError('Token amount is too small to cover cashu fees.', 'token_too_small');
    }

    const quotes = await this.getCrossMintQuotesWithinTargetAmount({
      destinationAccount,
      sourceAccount,
      targetAmount,
      exchangeRate,
      description: token.memo,
    });

    const meltQuoteExpiresAt = new Date(quotes.meltQuote.expiry * 1000).toISOString();
    const lightningFeeReserve = new Money({
      amount: quotes.meltQuote.fee_reserve,
      currency: tokenAmount.currency,
      unit: sourceCashuUnit,
    });

    if (destinationAccount.type === 'cashu') {
      const cashuReceiveQuote = await this.cashuReceiveQuoteService.createReceiveQuote({
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
        lightningReceiveQuote: {
          id: cashuReceiveQuote.id,
          paymentRequest: cashuReceiveQuote.paymentRequest,
          amount: cashuReceiveQuote.amount,
          transactionId: cashuReceiveQuote.transactionId,
          destinationType: 'cashu',
        },
      };
    }

    const sparkReceiveQuote = await this.sparkReceiveQuoteService.createReceiveQuote({
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
      lightningReceiveQuote: {
        id: sparkReceiveQuote.id,
        paymentRequest: sparkReceiveQuote.paymentRequest,
        amount: sparkReceiveQuote.amount,
        transactionId: sparkReceiveQuote.transactionId,
        destinationType: 'spark',
      },
    };
  }

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
    const destinationCurrency = destinationAccount.currency;
    let attempts = 0;
    let amountToMelt = targetAmount;

    while (attempts < 5) {
      attempts++;
      const amountToMint = amountToMelt.convert(destinationCurrency, exchangeRate);
      if (amountToMint.toNumber(getCashuUnit(destinationCurrency)) < 1) {
        throw new DomainError('Token amount is too small to cover the fees.', 'token_too_small');
      }

      const { lightningQuote, paymentRequest } = await this.getLightningQuoteForDestinationAccount({
        destinationAccount,
        amount: amountToMint,
        description,
      });

      const meltQuote = await sourceAccount.wallet.createMeltQuoteBolt11(paymentRequest);
      const amountRequired = new Money({
        amount: meltQuote.amount + meltQuote.fee_reserve,
        currency: sourceAccount.currency,
        unit: getCashuUnit(sourceAccount.currency),
      });
      const diff = amountRequired.subtract(targetAmount);
      if (diff.lessThanOrEqual(Money.zero(diff.currency))) {
        return { meltQuote, amountToMint, lightningQuote };
      }
      amountToMelt = amountToMelt.subtract(diff);
    }
    throw new DomainError('Failed to find valid quotes after 5 attempts.', 'quote_unavailable');
  }

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
      const lightningQuote = await this.getSparkLightningQuote({
        wallet: destinationAccount.wallet,
        amount,
        description,
      });
      return { lightningQuote, paymentRequest: lightningQuote.invoice.paymentRequest };
    }
    const lightningQuote = await this.cashuReceiveQuoteService.getLightningQuote({
      wallet: (destinationAccount as CashuAccount).wallet,
      amount,
      description,
    });
    return { lightningQuote, paymentRequest: lightningQuote.mintQuote.request };
  }
}
