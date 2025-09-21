import type { Token } from '@cashu/cashu-ts';
import type { QueryClient } from '@tanstack/react-query';
import { exchangeRateQueryOptions } from '~/hooks/use-exchange-rate';
import { areMintUrlsEqual } from '~/lib/cashu';
import type { CashuAccount } from '../accounts/account';
import { AccountsCache, accountsQueryOptions } from '../accounts/account-hooks';
import type { AccountRepository } from '../accounts/account-repository';
import { AccountService } from '../accounts/account-service';
import type { User } from '../user/user';
import { userQueryKey } from '../user/user-hooks';
import type { UserService } from '../user/user-service';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import type { CashuTokenSwap } from './cashu-token-swap';
import type { CashuTokenSwapService } from './cashu-token-swap-service';
import type { ReceiveCashuTokenQuoteService } from './receive-cashu-token-quote-service';
import { ReceiveCashuTokenService } from './receive-cashu-token-service';

type ClaimTokenResult = { success: true } | { success: false; message: string };

export class ClaimCashuTokenService {
  private readonly accountsCache: AccountsCache;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly accountRepository: AccountRepository,
    private readonly accountService: AccountService,
    private readonly tokenSwapService: CashuTokenSwapService,
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
    private readonly receiveCashuTokenService: ReceiveCashuTokenService,
    private readonly receiveCashuTokenQuoteService: ReceiveCashuTokenQuoteService,
    private readonly userService: UserService,
  ) {
    this.accountsCache = new AccountsCache(queryClient);
  }

  /**
   * Claims the cashu token for the user.
   * The mathod starts the claim flow and attempts to complete it, but if the complete step fails, it will not fail the entire claim flow.
   * The background processing will pick up the failed claim and retry it.
   * @param user - The user to claim the token for.
   * @param token - The token to claim.
   * @param preferredReceiveAccountId - The preferred receive account ID to claim the token to.
   * @returns The result of the claim.
   */
  async claimToken(
    user: User,
    token: Token,
    preferredReceiveAccountId?: string,
  ): Promise<ClaimTokenResult> {
    try {
      return await this.handleClaim(user, token, preferredReceiveAccountId);
    } catch (error) {
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
    preferredReceiveAccountId?: string,
  ): Promise<ClaimTokenResult> {
    const accounts = await this.queryClient.fetchQuery(
      accountsQueryOptions({
        userId: user.id,
        accountRepository: this.accountRepository,
      }),
    );
    const extendedAccounts = AccountService.getExtendedAccounts(user, accounts);
    const cashuAccounts = extendedAccounts.filter(
      (account) => account.type === 'cashu',
    );

    const { sourceAccount, possibleDestinationAccounts } =
      await this.receiveCashuTokenService.getSourceAndDestinationAccounts(
        token,
        cashuAccounts,
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

    if (receiveAccount.isUnknown) {
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
      // critical and the user can still claim the token, it's just won't be as nice UX becuase the balance
      // when home page loads might not show the correct currency.
      const result = await this.trySetDefaultAccount(user, receiveAccount);
      if (result.success) {
        this.queryClient.setQueryData([userQueryKey], result.user);
      }
    }

    const isSameAccountClaim =
      receiveAccount.currency === sourceAccount.currency &&
      areMintUrlsEqual(receiveAccount.mintUrl, sourceAccount.mintUrl);

    if (isSameAccountClaim) {
      const { tokenSwap, account } = await this.tokenSwapService.create({
        userId: user.id,
        token,
        account: receiveAccount,
      });
      this.accountsCache.upsert(account);

      // We don't want to fail the entire claim flow if completing the swap fails because the background processing
      // can pick it up and retry when the app loads. If the background processing manages to complete it, it would just
      // be a minor UX issue because the balance would be credited with some delay. If the background processing fails to
      // complete it, the app already has a way to handle the failed swap.
      const result = await this.tryCompleteSwap(account, tokenSwap);
      if (result.success) {
        this.accountsCache.upsert(result.account);
      }
    } else {
      const exchangeRate = await this.queryClient.fetchQuery(
        exchangeRateQueryOptions(
          `${sourceAccount.currency}-${receiveAccount.currency}`,
        ),
      );
      const { cashuMeltQuote, cashuReceiveQuote } =
        await this.receiveCashuTokenQuoteService.createCrossAccountReceiveQuotes(
          {
            userId: user.id,
            token,
            sourceAccount,
            destinationAccount: receiveAccount,
            exchangeRate,
          },
        );

      await sourceAccount.wallet.meltProofs(cashuMeltQuote, token.proofs);

      // We don't want to fail the entire claim flow if completing the receive fails because the background processing
      // can pick it up and retry when the app loads. If the background processing manages to complete it, it would just
      // be a minor UX issue because the balance would be credited with some delay. If the background processing fails to
      // complete it, the app already has a way to handle the failed receive.
      const result = await this.tryCompleteReceive(
        receiveAccount,
        cashuReceiveQuote,
      );
      if (result.success) {
        this.accountsCache.upsert(result.account);
      }
    }

    return { success: true };
  }

  private async trySetDefaultAccount(
    user: User,
    account: CashuAccount,
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
  ): Promise<{ success: true; account: CashuAccount } | { success: false }> {
    try {
      const { account: updatedAccount } =
        await this.tokenSwapService.completeSwap(account, tokenSwap);
      return { success: true, account: updatedAccount };
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
    account: CashuAccount,
    cashuReceiveQuote: CashuReceiveQuote,
  ): Promise<{ success: true; account: CashuAccount } | { success: false }> {
    try {
      const { account: updatedAccount } =
        await this.cashuReceiveQuoteService.completeReceive(
          account,
          cashuReceiveQuote,
        );
      return { success: true, account: updatedAccount };
    } catch (error) {
      console.error('Failed to complete the receive while claiming the token', {
        cause: error,
        cashuReceiveQuoteId: cashuReceiveQuote.id,
        accountId: account.id,
      });
      return { success: false };
    }
  }
}
