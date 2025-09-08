import type {
  MeltQuoteResponse,
  MintQuoteResponse,
  Token,
} from '@cashu/cashu-ts';
import { getCashuUnit } from '~/lib/cashu';
import { Money } from '~/lib/money';
import type { CashuAccount } from '../accounts/account';
import { tokenToMoney } from '../shared/cashu';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import {
  type CashuReceiveLightningQuote,
  type CashuReceiveQuoteService,
  useCashuReceiveQuoteService,
} from './cashu-receive-quote-service';

type CreateCrossAccountReceiveQuotesProps = {
  /** ID of the receiving user. */
  userId: string;
  /** The token to claim */
  token: Token;
  /** The account to claim the token to */
  destinationAccount: CashuAccount;
  /**
   * The account to claim the token from.
   * May be a placeholder account if the token is from a mint that we do not have an account for.
   */
  sourceAccount: CashuAccount;
  /** The exchange rate to use for the quotes */
  exchangeRate: string;
};

type CrossMintQuotesResult = {
  /** Mint quote from the destination wallet */
  mintQuote: MintQuoteResponse;
  /** Melt quote from the source wallet */
  meltQuote: MeltQuoteResponse;
  /** Amount to mint */
  amountToMint: Money;
};

export class ReceiveCashuTokenService {
  constructor(
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
  ) {}

  /**
   * Sets up quotes and prepares for cross mint/currency token claim.
   * This will create a cashu-receive-quote in the database.
   */
  async createCrossAccountReceiveQuotes({
    userId,
    token,
    sourceAccount,
    destinationAccount,
    exchangeRate,
  }: CreateCrossAccountReceiveQuotesProps): Promise<{
    cashuReceiveQuote: CashuReceiveQuote;
    cashuMeltQuote: MeltQuoteResponse;
  }> {
    const tokenAmount = tokenToMoney(token);
    const sourceCashuUnit = getCashuUnit(tokenAmount.currency);
    const destinationCashuUnit = getCashuUnit(destinationAccount.currency);

    if (
      this.areMintUrlsEqual(destinationAccount.mintUrl, token.mint) &&
      sourceCashuUnit === destinationCashuUnit
    ) {
      throw new Error(
        'Must melt token to a different mint or currency than source',
      );
    }

    const quotes = await this.getCrossMintQuotesWithinTargetAmount({
      destinationAccount,
      sourceAccount,
      targetAmount: tokenAmount,
      exchangeRate,
    });

    const cashuReceiveFee = sourceAccount.wallet.getFeesForProofs(token.proofs);

    const cashuReceiveQuote =
      await this.cashuReceiveQuoteService.createReceiveQuote({
        userId,
        account: destinationAccount,
        receiveType: 'TOKEN',
        receiveQuote: quotes.lightningQuote,
        cashuReceiveFee,
        tokenAmount,
      });

    return {
      cashuReceiveQuote,
      cashuMeltQuote: quotes.meltQuote,
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
  }: {
    destinationAccount: CashuAccount;
    sourceAccount: CashuAccount;
    targetAmount: Money;
    exchangeRate: string;
  }): Promise<
    CrossMintQuotesResult & {
      lightningQuote: CashuReceiveLightningQuote;
    }
  > {
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

      const lightningQuote =
        await this.cashuReceiveQuoteService.getLightningQuote({
          account: destinationAccount,
          amount: amountToMint,
        });

      const meltQuote = await sourceAccount.wallet.createMeltQuote(
        lightningQuote.mintQuote.request,
      );

      const amountRequired = new Money({
        amount: meltQuote.amount + meltQuote.fee_reserve,
        currency: sourceCurrency,
        unit: getCashuUnit(sourceCurrency),
      });

      const diff = amountRequired.subtract(targetAmount);

      if (diff.lessThanOrEqual(Money.zero(diff.currency))) {
        return {
          mintQuote: lightningQuote.mintQuote,
          meltQuote,
          amountToMint,
          lightningQuote,
        };
      }

      amountToMelt = amountToMelt.subtract(diff);
    }

    throw new Error('Failed to find valid quotes after 5 attempts.');
  }

  private areMintUrlsEqual(url1: string, url2: string): boolean {
    const normalize = (url: string) => url.replace(/\/+$/, '').toLowerCase();
    return normalize(url1) === normalize(url2);
  }
}

export function useReceiveCashuTokenService() {
  const cashuReceiveQuoteService = useCashuReceiveQuoteService();
  return new ReceiveCashuTokenService(cashuReceiveQuoteService);
}
