import type { MeltQuoteResponse, Token } from '@cashu/cashu-ts';
import { getCashuUnit } from '~/lib/cashu';
import { Money } from '~/lib/money';
import {
  type Account,
  type AccountType,
  type CashuAccount,
  isSameEffectiveAccount,
} from '../accounts/account';
import { tokenToMoney } from '../shared/cashu';
import { DomainError } from '../shared/error';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import {
  type CashuReceiveLightningQuote,
  type CashuReceiveQuoteService,
  useCashuReceiveQuoteService,
} from './cashu-receive-quote-service';
import type { SparkReceiveQuote } from './spark-receive-quote';
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
 * Result of creating cross-account receive quotes.
 * This is a discriminated union based on the destination account type.
 * - For Cashu destinations: includes a cashuReceiveQuote that needs to be completed after melting
 * - For Spark destinations: Spark SDK handles completion automatically
 */
export type CrossAccountReceiveQuotesResult = {
  /** Melt quote from the source wallet */
  cashuMeltQuote: MeltQuoteResponse;
  /** Common lightning receive quote interface for unified handling */
  lightningReceiveQuote: LightningReceiveQuote;
} & (
  | {
      /** Discriminator for the destination account type */
      destinationType: 'cashu';
      /** The cashu receive quote created in the database (needed for completion) */
      cashuReceiveQuote: CashuReceiveQuote;
    }
  | {
      /** Discriminator for the destination account type */
      destinationType: 'spark';
      /** The Spark lightning receive quote (completion is automatic) */
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
   * For Spark destinations: creates a Spark lightning receive quote.
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

    if (isSameEffectiveAccount(sourceAccount, destinationAccount)) {
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
      throw new DomainError('Token amount is too small to cover cashu fees');
    }

    const quotes = await this.getCrossMintQuotesWithinTargetAmount({
      destinationAccount,
      sourceAccount,
      targetAmount,
      exchangeRate,
      userId,
    });

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
          receiveType: 'TOKEN',
          receiveQuote: quotes.lightningQuote as CashuReceiveLightningQuote,
          cashuReceiveFee,
          tokenAmount,
          lightningFeeReserve,
        });

      return {
        destinationType: 'cashu',
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

    const sparkReceiveQuote = quotes.lightningQuote as SparkReceiveQuote;
    return {
      destinationType: 'spark',
      cashuMeltQuote: quotes.meltQuote,
      sparkReceiveQuote,
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
    userId,
  }: {
    destinationAccount: Account;
    sourceAccount: CashuAccount;
    targetAmount: Money;
    exchangeRate: string;
    userId: string;
  }): Promise<{
    lightningQuote: CashuReceiveLightningQuote | SparkReceiveQuote;
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
        throw new Error('Amount is too small to get cross mint quotes');
      }

      const { lightningQuote, paymentRequest } =
        await this.getLightningQuoteForDestinationAccount({
          destinationAccount,
          amount: amountToMint,
          userId,
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
    userId,
  }: {
    destinationAccount: Account;
    amount: Money;
    userId: string;
  }): Promise<{
    lightningQuote: CashuReceiveLightningQuote | SparkReceiveQuote;
    paymentRequest: string;
  }> {
    if (destinationAccount.type === 'spark') {
      const sparkQuote = await this.sparkLightningReceiveService.createQuote({
        userId,
        account: destinationAccount,
        amount,
        type: 'CASHU_TOKEN',
      });

      return {
        lightningQuote: sparkQuote,
        paymentRequest: sparkQuote.paymentRequest,
      };
    }

    if (destinationAccount.type === 'cashu') {
      const cashuQuote = await this.cashuReceiveQuoteService.getLightningQuote({
        account: destinationAccount,
        amount,
      });

      return {
        lightningQuote: cashuQuote,
        paymentRequest: cashuQuote.mintQuote.request,
      };
    }

    throw new Error('Invalid destination account type');
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
