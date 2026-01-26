import type { MeltQuoteResponse, Token } from '@cashu/cashu-ts';
import { getCashuUnit } from '~/lib/cashu';
import { Money } from '~/lib/money';
import type {
  Account,
  AccountType,
  CashuAccount,
  SparkAccount,
} from '../accounts/account';
import { tokenToMoney } from '../shared/cashu';
import { DomainError } from '../shared/error';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { CashuReceiveLightningQuote } from './cashu-receive-quote-core';
import {
  type CashuReceiveQuoteService,
  useCashuReceiveQuoteService,
} from './cashu-receive-quote-service';
import { isClaimingToSameCashuAccount } from './receive-cashu-token-models';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { SparkReceiveLightningQuote } from './spark-receive-quote-core';
import { getLightningQuote as getSparkLightningQuote } from './spark-receive-quote-core';
import {
  type SparkReceiveQuoteService,
  useSparkReceiveQuoteService,
} from './spark-receive-quote-service';

/**
 * Common interface for lightning receive quotes across different account types.
 */
type LightningReceiveQuote = {
  /** UUID of the quote. */
  id: string;
  /** Lightning invoice to be paid. */
  paymentRequest: string;
  /** Amount to receive. */
  amount: Money;
  /** ID of the corresponding transaction. */
  transactionId: string;
  /** The type of destination account this quote is for. */
  destinationType: AccountType;
};

type CreateCrossAccountReceiveQuotesProps = {
  /** ID of the receiving user. */
  userId: string;
  /** The token to claim */
  token: Token;
  /** The account to claim the token to */
  destinationAccount: Account;
  /**
   * The account to claim the token from.
   * May be a placeholder account if the token is from a mint that we do not have an account for.
   */
  sourceAccount: CashuAccount;
  /** The exchange rate to use for the quotes */
  exchangeRate: string;
};

/**
 * Result of creating cross-account receive quotes for cashu tokens..
 * This is a discriminated union based on the destination account type.
 * - For Cashu destinations: includes a cashuReceiveQuote that needs to be completed after melting
 * - For Spark destinations: includes a sparkReceiveQuote that needs to be completed after melting
 */
export type CrossAccountReceiveQuotesResult = {
  /** Melt quote from the source wallet */
  cashuMeltQuote: MeltQuoteResponse;
  /** Common lightning receive quote interface for unified handling */
  lightningReceiveQuote: LightningReceiveQuote;
} & (
  | {
      destinationType: 'cashu';
      destinationAccount: CashuAccount;
      /** The cashu receive quote created in the database (needed for completion) */
      cashuReceiveQuote: CashuReceiveQuote;
    }
  | {
      destinationType: 'spark';
      destinationAccount: SparkAccount;
      /** The spark receive quote created in the database (needed for completion) */
      sparkReceiveQuote: SparkReceiveQuote;
    }
);

export class ReceiveCashuTokenQuoteService {
  constructor(
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
    private readonly sparkLightningReceiveService: SparkReceiveQuoteService,
  ) {}

  /**
   * Sets up quotes and prepares for cross mint/currency token claim.
   * For Cashu destinations: creates a cashu-receive-quote in the database.
   * For Spark destinations: creates a spark-receive-quote in the database.
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

    if (isClaimingToSameCashuAccount(sourceAccount, destinationAccount)) {
      throw new Error('Must melt token to a different account than source');
    }

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
        lightningReceiveQuote: {
          id: cashuReceiveQuote.id,
          paymentRequest: cashuReceiveQuote.paymentRequest,
          amount: cashuReceiveQuote.amount,
          transactionId: cashuReceiveQuote.transactionId,
          destinationType: 'cashu',
        },
      };
    }

    const sparkReceiveQuote =
      await this.sparkLightningReceiveService.createReceiveQuote({
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

  /**
   * Gets mint and melt quotes for claiming a token from one mint to another.
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
    meltQuote: MeltQuoteResponse;
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
        await sourceAccount.wallet.createMeltQuote(paymentRequest);

      const amountRequired = new Money({
        amount: meltQuote.amount + meltQuote.fee_reserve,
        currency: sourceCurrency,
        unit: getCashuUnit(sourceCurrency),
      });

      const diff = amountRequired.subtract(targetAmount);

      if (diff.lessThanOrEqual(Money.zero(diff.currency))) {
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
        paymentRequest: lightningQuote.invoice.encodedInvoice,
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

export function useReceiveCashuTokenQuoteService() {
  const cashuReceiveQuoteService = useCashuReceiveQuoteService();
  const sparkLightningReceiveService = useSparkReceiveQuoteService();
  return new ReceiveCashuTokenQuoteService(
    cashuReceiveQuoteService,
    sparkLightningReceiveService,
  );
}
