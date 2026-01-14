import { LightningReceiveRequestStatus } from '@buildonspark/spark-sdk/types';
import type { Token } from '@cashu/cashu-ts';
import type { QueryClient } from '@tanstack/react-query';
import { getExchangeRate } from '~/hooks/use-exchange-rate';
import type { Account, CashuAccount, SparkAccount } from '../accounts/account';
import { AccountsCache, accountsQueryOptions } from '../accounts/account-hooks';
import type { AccountRepository } from '../accounts/account-repository';
import { AccountService } from '../accounts/account-service';
import { DomainError } from '../shared/error';
import { sparkBalanceQueryKey } from '../shared/spark';
import type { User } from '../user/user';
import { userQueryKey } from '../user/user-hooks';
import type { UserService } from '../user/user-service';
import type { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import type { CashuTokenSwap } from './cashu-token-swap';
import type { CashuTokenSwapService } from './cashu-token-swap-service';
import { isClaimingToSameCashuAccount } from './receive-cashu-token-models';
import type {
  CrossAccountReceiveQuotesResult,
  ReceiveCashuTokenQuoteService,
} from './receive-cashu-token-quote-service';
import { ReceiveCashuTokenService } from './receive-cashu-token-service';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { SparkReceiveQuoteService } from './spark-receive-quote-service';

type ClaimTokenResult = { success: true } | { success: false; message: string };

export class ClaimCashuTokenService {
  private readonly accountsCache: AccountsCache;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly accountRepository: AccountRepository,
    private readonly accountService: AccountService,
    private readonly tokenSwapService: CashuTokenSwapService,
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
    private readonly sparkReceiveQuoteService: SparkReceiveQuoteService,
    private readonly receiveCashuTokenService: ReceiveCashuTokenService,
    private readonly receiveCashuTokenQuoteService: ReceiveCashuTokenQuoteService,
    private readonly userService: UserService,
  ) {
    this.accountsCache = new AccountsCache(queryClient);
  }

  /**
   * Claims the cashu token for the user.
   * If the account chosen to receive the token is unknown to the user, it will be added.
   * The method starts the claim flow and attempts to complete it, but if the complete step fails, it will not fail the entire claim flow.
   * The background processing will pick up the failed claim and retry it.
   * @param user - The user to claim the token for.
   * @param token - The token to claim.
   * @param claimTo - Whether to claim the token to a cashu or spark account.
   * @returns The result of the claim.
   */
  async claimToken(
    user: User,
    token: Token,
    claimTo: 'cashu' | 'spark',
  ): Promise<ClaimTokenResult> {
    try {
      return await this.handleClaim(user, token, claimTo);
    } catch (error) {
      if (error instanceof DomainError) {
        return {
          success: false,
          message: error.message,
        };
      }

      const message = 'Unexpected error while claiming the token';
      // TODO: do we need to send this error to Sentry or Sentry can make alert from error log?
      console.error(message, { cause: error, time: new Date().toISOString() });
      return {
        success: false,
        message,
      };
    }
  }

  private async handleClaim(
    user: User,
    token: Token,
    claimTo: 'cashu' | 'spark',
  ): Promise<ClaimTokenResult> {
    const accounts = await this.queryClient.fetchQuery(
      accountsQueryOptions({
        userId: user.id,
        accountRepository: this.accountRepository,
      }),
    );
    const extendedAccounts = AccountService.getExtendedAccounts(user, accounts);
    const preferredReceiveAccountId =
      claimTo === 'spark'
        ? extendedAccounts.find((a) => a.type === 'spark')?.id
        : undefined;

    const { sourceAccount, possibleDestinationAccounts } =
      await this.receiveCashuTokenService.getSourceAndDestinationAccounts(
        token,
        extendedAccounts,
      );

    let receiveAccount = ReceiveCashuTokenService.getDefaultReceiveAccount(
      sourceAccount,
      possibleDestinationAccounts,
      preferredReceiveAccountId,
    );

    if (!receiveAccount) {
      return {
        success: false,
        message: 'Token from this mint cannot be claimed',
      };
    }

    if (receiveAccount.isUnknown && receiveAccount.type === 'cashu') {
      const addedAccount = await this.accountService.addCashuAccount({
        userId: user.id,
        account: receiveAccount,
      });
      this.accountsCache.upsert(addedAccount);
      receiveAccount = { ...receiveAccount, ...addedAccount };
    }

    if (
      receiveAccount.currency !== user.defaultCurrency ||
      !AccountService.isDefaultAccount(user, receiveAccount)
    ) {
      // We don't want to fail the entire claim flow if setting the default account fails because it's not
      // critical and the user can still claim the token, it just won't be as nice UX because the balance
      // when home page loads might not show the correct currency.
      const result = await this.trySetDefaultAccount(user, receiveAccount);
      if (result.success) {
        this.queryClient.setQueryData([userQueryKey], result.user);
      }
    }

    const isSameAccountClaim = isClaimingToSameCashuAccount(
      receiveAccount,
      sourceAccount,
    );

    if (isSameAccountClaim) {
      const { swap, account } = await this.tokenSwapService.create({
        userId: user.id,
        token,
        account: receiveAccount as CashuAccount,
      });
      this.accountsCache.upsert(account);

      // We want to fail the entire claim flow if completing the swap fails only if the swap is in failed state (non
      // recoverable error). Otherwise, the background processing can pick it up and retry when the app loads. If the
      // background processing manages to complete it, it would just be a minor UX issue because the balance would be
      // credited with some delay. If the background processing fails to complete it, the app already has a way to
      // handle the failed swap.
      const result = await this.tryCompleteSwap(account, swap);
      if (result.success) {
        this.accountsCache.upsert(result.account);
      } else if (result.swap?.state === 'FAILED') {
        return {
          success: false,
          message: result.swap.failureReason,
        };
      }
    } else {
      const exchangeRate = await getExchangeRate(
        this.queryClient,
        `${sourceAccount.currency}-${receiveAccount.currency}`,
      );
      const quotes =
        await this.receiveCashuTokenQuoteService.createCrossAccountReceiveQuotes(
          {
            userId: user.id,
            token,
            sourceAccount,
            destinationAccount: receiveAccount,
            exchangeRate,
          },
        );

      await sourceAccount.wallet.meltProofsIdempotent(
        quotes.cashuMeltQuote,
        token.proofs,
      );

      // We don't want to fail the entire claim flow if completing the receive fails because the background processing
      // can pick it up and retry when the app loads. If the background processing manages to complete it, it would just
      // be a minor UX issue because the balance would be credited with some delay. If the background processing fails to
      // complete it, the app already has a way to handle the failed receive.
      const result = await this.tryCompleteReceive(quotes);
      if (result.success && result.account) {
        this.accountsCache.upsert(result.account);
      }
    }

    return { success: true };
  }

  private async trySetDefaultAccount(
    user: User,
    account: Account,
  ): Promise<{ success: true; user: User } | { success: false }> {
    try {
      const updatedUser = await this.userService.setDefaultAccount(
        user,
        account,
        {
          setDefaultCurrency: true,
        },
      );
      return { success: true, user: updatedUser };
    } catch (error) {
      console.error('Failed to set default account while claiming the token', {
        cause: error,
        accountId: account.id,
      });
      return { success: false };
    }
  }

  private async tryCompleteSwap(
    account: CashuAccount,
    tokenSwap: CashuTokenSwap,
  ): Promise<
    | { success: true; swap: CashuTokenSwap; account: CashuAccount }
    | { success: false; swap?: CashuTokenSwap }
  > {
    try {
      const { swap: updatedSwap, account: updatedAccount } =
        await this.tokenSwapService.completeSwap(account, tokenSwap);

      if (updatedSwap.state === 'FAILED') {
        return { success: false, swap: updatedSwap };
      }

      return { success: true, swap: updatedSwap, account: updatedAccount };
    } catch (error) {
      console.error('Failed to complete the swap while claiming the token', {
        cause: error,
        tokenSwapId: tokenSwap.tokenHash,
        accountId: account.id,
      });
      return { success: false };
    }
  }

  private async tryCompleteReceive(
    quotes: CrossAccountReceiveQuotesResult,
  ): Promise<{ success: true; account?: CashuAccount } | { success: false }> {
    try {
      if (quotes.destinationType === 'cashu') {
        const { account: updatedAccount } =
          await this.cashuReceiveQuoteService.completeReceive(
            quotes.destinationAccount,
            quotes.cashuReceiveQuote,
          );
        return { success: true, account: updatedAccount };
      }

      if (quotes.destinationType === 'spark') {
        const { sparkTransferId, paymentPreimage } =
          await this.waitForSparkReceiveToComplete(
            quotes.destinationAccount,
            quotes.sparkReceiveQuote,
          );
        await this.sparkReceiveQuoteService.complete(
          quotes.sparkReceiveQuote,
          paymentPreimage,
          sparkTransferId,
        );
        // To make sure the new balance is immidiatelly reflected in the UI, we invalidate the spark balance query.
        await this.queryClient.invalidateQueries({
          queryKey: sparkBalanceQueryKey(quotes.destinationAccount.id),
        });
        return { success: true };
      }
    } catch (error) {
      console.error('Failed to complete the receive while claiming the token', {
        cause: error,
        destinationType: quotes.destinationType,
        accountId: quotes.destinationAccount.id,
        receiveQuoteId:
          quotes.destinationType === 'cashu'
            ? quotes.cashuReceiveQuote.id
            : quotes.sparkReceiveQuote.id,
      });
    }

    return { success: false };
  }

  /**
   * Polls for the spark receive request to complete.
   * Polls every 1 second with a hard timeout of 10 seconds total.
   * @throws Error if it doesn't complete in that time or if getting receive request throws.
   */
  private waitForSparkReceiveToComplete(
    account: SparkAccount,
    quote: SparkReceiveQuote,
  ): Promise<{ sparkTransferId: string; paymentPreimage: string }> {
    if (!account.wallet) {
      throw new Error(`Spark account ${account.id} wallet not initialized`);
    }

    const timeoutMs = 10_000;
    const pollIntervalMs = 1000;
    const wallet = account.wallet;

    return new Promise((resolve, reject) => {
      let intervalId: ReturnType<typeof setInterval> | null = null;

      const timeoutId = setTimeout(() => {
        if (intervalId) clearInterval(intervalId);
        reject(
          new Error(
            `Spark receive request ${quote.sparkId} timed out after ${timeoutMs / 1000} seconds`,
          ),
        );
      }, timeoutMs);

      const checkReceiveRequest = async () => {
        try {
          const receiveRequest = await wallet.getLightningReceiveRequest(
            quote.sparkId,
          );

          if (
            receiveRequest?.status ===
            LightningReceiveRequestStatus.TRANSFER_COMPLETED
          ) {
            clearTimeout(timeoutId);
            if (intervalId) clearInterval(intervalId);

            if (!receiveRequest.paymentPreimage) {
              reject(
                new Error(
                  'Payment preimage is required when receive request has TRANSFER_COMPLETED status.',
                ),
              );
              return;
            }
            if (!receiveRequest.transfer?.sparkId) {
              reject(
                new Error(
                  'Spark transfer ID is required when receive request has TRANSFER_COMPLETED status.',
                ),
              );
              return;
            }

            resolve({
              sparkTransferId: receiveRequest.transfer.sparkId,
              paymentPreimage: receiveRequest.paymentPreimage,
            });
          }
        } catch (error) {
          clearTimeout(timeoutId);
          if (intervalId) clearInterval(intervalId);
          reject(error);
        }
      };

      checkReceiveRequest();
      intervalId = setInterval(checkReceiveRequest, pollIntervalMs);
    });
  }
}
