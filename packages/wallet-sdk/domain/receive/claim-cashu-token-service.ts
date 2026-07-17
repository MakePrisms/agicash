import type { Payment } from '@agicash/breez-sdk-spark';
import type { Token } from '@cashu/cashu-ts';
import { DomainError } from '../../lib/error';
import type { Account, CashuAccount, SparkAccount } from '../accounts/account';
import type { AccountService } from '../accounts/account-service';
import type { Ticker } from '../exchange-rate';
import type { User } from '../user/user';
import { UserService } from '../user/user-service';
import type { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import type { CashuReceiveSwapService } from './cashu-receive-swap-service';
import { isClaimingToSameCashuAccount } from './receive-cashu-token-models';
import type {
  CrossAccountReceiveQuotesResult,
  ReceiveCashuTokenQuoteService,
} from './receive-cashu-token-quote-service';
import { ReceiveCashuTokenService } from './receive-cashu-token-service';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { SparkReceiveQuoteService } from './spark-receive-quote-service';

type ClaimTokenResult =
  | {
      success: true;
      /** The account the token was claimed into. */
      receiveAccount: Account;
      /** Accounts created or updated while claiming, for the caller to write into its cache. */
      changedAccounts: Account[];
    }
  | { success: false; message: string; error?: unknown };

export class ClaimCashuTokenService {
  constructor(
    private readonly accountService: AccountService,
    private readonly receiveSwapService: CashuReceiveSwapService,
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
    private readonly sparkReceiveQuoteService: SparkReceiveQuoteService,
    private readonly receiveCashuTokenService: ReceiveCashuTokenService,
    private readonly receiveCashuTokenQuoteService: ReceiveCashuTokenQuoteService,
    private readonly getExchangeRate: (ticker: Ticker) => Promise<string>,
  ) {}

  /**
   * Claims the cashu token for the user.
   * If the account chosen to receive the token is unknown to the user, it will be added.
   * The method starts the claim flow and attempts to complete it, but if the complete step fails, it will not fail the entire claim flow.
   * The background processing will pick up the failed claim and retry it.
   * @param user - The user to claim the token for.
   * @param token - The token to claim.
   * @param claimTo - Whether to claim the token to a cashu or spark account.
   * @param accounts - The user's accounts used to resolve the token's source and possible destination accounts.
   * @returns The result of the claim.
   */
  async claimToken(
    user: User,
    token: Token,
    claimTo: 'cashu' | 'spark',
    accounts: Account[],
  ): Promise<ClaimTokenResult> {
    try {
      return await this.handleClaim(user, token, claimTo, accounts);
    } catch (error) {
      if (error instanceof DomainError) {
        return {
          success: false,
          message: error.message,
        };
      }

      return {
        success: false,
        message: 'Unexpected error while claiming the token',
        error,
      };
    }
  }

  private async handleClaim(
    user: User,
    token: Token,
    claimTo: 'cashu' | 'spark',
    accounts: Account[],
  ): Promise<ClaimTokenResult> {
    const changedAccounts: Account[] = [];

    const extendedAccounts = UserService.getExtendedAccounts(user, accounts);
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
      changedAccounts.push(addedAccount);
      receiveAccount = { ...receiveAccount, ...addedAccount };
    }

    const isSameAccountClaim = isClaimingToSameCashuAccount(
      receiveAccount,
      sourceAccount,
    );

    if (isSameAccountClaim) {
      const { swap, account } = await this.receiveSwapService.create({
        userId: user.id,
        token,
        account: receiveAccount as CashuAccount,
      });
      changedAccounts.push(account);

      // We want to fail the entire claim flow if completing the swap fails only if the swap is in failed state (non
      // recoverable error). Otherwise, the background processing can pick it up and retry when the app loads. If the
      // background processing manages to complete it, it would just be a minor UX issue because the balance would be
      // credited with some delay. If the background processing fails to complete it, the app already has a way to
      // handle the failed swap.
      const result = await this.tryCompleteSwap(account, swap);
      if (result.success) {
        changedAccounts.push(result.account);
      } else if (result.swap?.state === 'FAILED') {
        return {
          success: false,
          message: result.swap.failureReason,
        };
      }
    } else {
      const exchangeRate = await this.getExchangeRate(
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
        undefined,
        // Use random outputs for change to avoid counter collisions with the
        // source account's persisted keyset counter. The change is currently
        // discarded (see CashuTokenMeltData), so deterministic recovery is
        // unused. If we ever start keeping change here, switch to a reserved
        // deterministic counter persisted on the receive quote.
        { type: 'random' },
      );

      // We don't want to fail the entire claim flow if completing the receive fails because the background processing
      // can pick it up and retry when the app loads. If the background processing manages to complete it, it would just
      // be a minor UX issue because the balance would be credited with some delay. If the background processing fails to
      // complete it, the app already has a way to handle the failed receive.
      const result = await this.tryCompleteReceive(quotes);
      if (result.success && result.account) {
        changedAccounts.push(result.account);
      }
    }

    return {
      success: true,
      receiveAccount,
      changedAccounts,
    };
  }

  private async tryCompleteSwap(
    account: CashuAccount,
    receiveSwap: CashuReceiveSwap,
  ): Promise<
    | { success: true; swap: CashuReceiveSwap; account: CashuAccount }
    | { success: false; swap?: CashuReceiveSwap }
  > {
    try {
      const { swap: updatedSwap, account: updatedAccount } =
        await this.receiveSwapService.completeSwap(account, receiveSwap);

      if (updatedSwap.state === 'FAILED') {
        return { success: false, swap: updatedSwap };
      }

      return { success: true, swap: updatedSwap, account: updatedAccount };
    } catch (error) {
      console.error('Failed to complete the swap while claiming the token', {
        cause: error,
        tokenHash: receiveSwap.tokenHash,
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
   * Waits for a Spark lightning receive to complete using event-driven detection.
   * Registers a Breez SDK event listener and does an initial status check to
   * catch payments that arrived before the listener was registered.
   * @throws Error if the payment does not complete within the timeout.
   */
  private waitForSparkReceiveToComplete(
    account: SparkAccount,
    quote: SparkReceiveQuote,
  ): Promise<{ sparkTransferId: string; paymentPreimage: string }> {
    const timeoutMs = 10_000;

    return new Promise((resolve, reject) => {
      let listenerId: string | undefined;
      let resolved = false;

      const cleanup = () => {
        if (listenerId)
          account.wallet.removeEventListener(listenerId).catch(() => {
            console.warn('Failed to remove Spark event listener', {
              listenerId,
            });
          });
      };

      const timeoutId = setTimeout(() => {
        resolved = true;
        cleanup();
        reject(
          new Error(
            `Spark receive request ${quote.sparkId} timed out after ${timeoutMs / 1000} seconds`,
          ),
        );
      }, timeoutMs);

      const handlePayment = (payment: Payment) => {
        if (resolved) return;
        const details = payment.details;
        if (details?.type !== 'lightning') return;
        if (details.htlcDetails.paymentHash !== quote.paymentHash) return;

        resolved = true;
        clearTimeout(timeoutId);
        cleanup();

        const preimage = details.htlcDetails.preimage;
        if (!preimage) {
          reject(new Error('Payment preimage missing'));
          return;
        }

        resolve({
          sparkTransferId: payment.id,
          paymentPreimage: preimage,
        });
      };

      // Register event listener before initial check to avoid race conditions
      account.wallet
        .addEventListener({
          onEvent(event) {
            if (event.type === 'paymentSucceeded') {
              handlePayment(event.payment);
            }
          },
        })
        .then((id) => {
          listenerId = id;
          if (resolved) {
            account.wallet.removeEventListener(id).catch(() => {
              console.warn('Failed to remove Spark event listener', {
                listenerId,
              });
            });
          }
        });

      // Initial status check — local lookup, no network call
      account.wallet
        .getPaymentByInvoice({ invoice: quote.paymentRequest })
        .then((response) => {
          if (response.payment && response.payment.status === 'completed') {
            handlePayment(response.payment);
          }
        })
        .catch((error) => {
          console.error('Error checking initial receive payment', {
            cause: error,
          });
        });
    });
  }
}
