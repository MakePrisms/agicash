import type { Payment } from '@agicash/breez-sdk-spark';
import { getClaimableProofs, getUnspentProofsFromToken } from '@agicash/cashu';
import type { Money } from '@agicash/money';
import { NetworkError } from '@cashu/cashu-ts';
import type { Proof, Token } from '@cashu/cashu-ts';
import { DomainError } from '../errors';
import type { SdkCoreEventMap } from '../events';
import type { EventBus } from '../internal/event-bus';
import type { CashuReceiveLightningQuote } from '../internal/cashu/receive-quote-core';
import type { CashuReceiveQuoteRepository } from '../internal/db/cashu-receive-quote-repository';
import type { AccountRepository } from '../internal/db/account-repository';
import { AccountService } from '../internal/services/account-service';
import type { CashuReceiveQuoteService } from '../internal/services/cashu-receive-quote-service';
import type { CashuReceiveSwapService } from '../internal/services/cashu-receive-swap-service';
import { isClaimingToSameCashuAccount } from '../internal/services/receive-cashu-token-models';
import type {
  CashuAccountWithTokenFlags,
  ReceiveCashuTokenAccount,
} from '../internal/services/receive-cashu-token-models';
import { ReceiveCashuTokenService } from '../internal/services/receive-cashu-token-service';
import type {
  CrossAccountReceiveQuotesResult,
  ReceiveCashuTokenQuoteService,
} from '../internal/services/receive-cashu-token-quote-service';
import type { SparkReceiveQuoteService } from '../internal/services/spark-receive-quote-service';
import type { Ticker } from '../internal/rates/providers/types';
import type { Account, CashuAccount, SparkAccount } from './account-types';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import type { Rate } from './rates';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { TransactionPurpose } from './transaction-enums';
import type { User } from './user-types';
import {
  type TerminalResult,
  type TerminalStatus,
  awaitTerminal,
} from './await-terminal';

type Deps = {
  service: CashuReceiveQuoteService;
  repository: CashuReceiveQuoteRepository;
  events: EventBus<SdkCoreEventMap>;
  getCurrentUserId: () => Promise<string | null>;
  swapService: CashuReceiveSwapService;
  sparkReceiveQuoteService: SparkReceiveQuoteService;
  accountRepository: AccountRepository;
  accountService: AccountService;
  receiveTokenService: ReceiveCashuTokenService;
  receiveTokenQuoteService: ReceiveCashuTokenQuoteService;
  getUser: () => Promise<User | null>;
  setDefaultAccount: (params: {
    account: Account;
    setDefaultCurrency?: boolean;
  }) => Promise<User>;
  getExchangeRate: (ticker: Ticker) => Promise<Rate>;
};

export type ReceiveTokenResult = {
  transactionId: string;
  destinationAccount: Pick<Account, 'id' | 'purpose'>;
};

export type ClaimableTokenResult =
  | { claimableToken: Token; cannotClaimReason: null }
  | { claimableToken: null; cannotClaimReason: string };

export type GetTokenAccountsResult = {
  sourceAccount: CashuAccountWithTokenFlags;
  possibleDestinationAccounts: ReceiveCashuTokenAccount[];
  defaultReceiveAccount: ReceiveCashuTokenAccount | null;
};

export type CreateTokenClaimResult = {
  transactionId: string;
  account: Account;
};

/** Receiving Lightning into a cashu account. `execute` persists the quote so the
 * background processor mints on payment; `awaitTerminal` resolves on COMPLETED. */
export class CashuReceiveOps {
  constructor(private readonly deps: Deps) {}

  /** A locked mint quote (bolt11 invoice) to receive `amount`. Not persisted. */
  createLightningQuote(p: {
    account: CashuAccount;
    amount: Money;
    description?: string;
  }): Promise<CashuReceiveLightningQuote> {
    return this.deps.service.getLightningQuote({
      wallet: p.account.wallet,
      amount: p.amount,
      description: p.description,
    });
  }

  /** Persists the receive quote so the processor tracks payment. Create-only. */
  async execute(p: {
    account: CashuAccount;
    quote: CashuReceiveLightningQuote;
    purpose?: TransactionPurpose;
    transferId?: string;
  }): Promise<CashuReceiveQuote> {
    const userId = await this.requireUserId();
    return this.deps.service.createReceiveQuote({
      userId,
      account: p.account,
      lightningQuote: p.quote,
      receiveType: 'LIGHTNING',
      purpose: p.purpose,
      transferId: p.transferId,
    });
  }

  /** Persists then resolves when the payment completes (or fails/expires). */
  async executeAndAwait(p: {
    account: CashuAccount;
    quote: CashuReceiveLightningQuote;
    purpose?: TransactionPurpose;
    transferId?: string;
    signal?: AbortSignal;
  }): Promise<TerminalResult> {
    const quote = await this.execute(p);
    return this.awaitTerminal({ quoteId: quote.id, signal: p.signal });
  }

  awaitTerminal(p: {
    quoteId: string;
    signal?: AbortSignal;
  }): Promise<TerminalResult> {
    return awaitTerminal({
      events: this.deps.events,
      kind: 'receive',
      quoteId: p.quoteId,
      backstop: () => this.classify(p.quoteId),
      signal: p.signal,
    });
  }

  get(quoteId: string): Promise<CashuReceiveQuote | null> {
    return this.deps.repository.get(quoteId);
  }

  /**
   * Checks which proofs in a token are unspent at the mint and claimable by this
   * user, returning the token narrowed to claimable proofs — or a reason it cannot
   * be claimed. Does not throw on a mint/offline error; the reason is returned.
   * @param p.cashuPubKey - The user's cashu locking pubkey, for P2PK-locked proofs.
   */
  async getClaimableToken(p: {
    token: Token;
    cashuPubKey?: string;
  }): Promise<ClaimableTokenResult> {
    let unspentProofs: Proof[];
    try {
      unspentProofs = await getUnspentProofsFromToken(p.token);
    } catch (error) {
      if (error instanceof NetworkError) {
        return {
          claimableToken: null,
          cannotClaimReason: 'The mint that issued this ecash is offline',
        };
      }
      return {
        claimableToken: null,
        cannotClaimReason: 'An error occurred while checking the token',
      };
    }

    if (unspentProofs.length === 0) {
      return {
        claimableToken: null,
        cannotClaimReason: 'This ecash has already been spent',
      };
    }

    const { claimableProofs, cannotClaimReason } = getClaimableProofs(
      unspentProofs,
      p.cashuPubKey ? [p.cashuPubKey] : [],
    );

    return claimableProofs
      ? {
          claimableToken: { ...p.token, proofs: claimableProofs },
          cannotClaimReason: null,
        }
      : { claimableToken: null, cannotClaimReason };
  }

  /**
   * Selects the token's source account, the accounts it can be received into, and
   * the default selection — the read behind an interactive token-receive screen.
   * Reads the user's accounts internally. `defaultReceiveAccount` is null when the
   * token cannot be claimed into any account.
   */
  async getTokenAccounts(p: {
    token: Token;
    preferredReceiveAccountId?: string;
  }): Promise<GetTokenAccountsResult> {
    const user = await this.requireUser();
    const accounts = await this.deps.accountRepository.getAllActive(user.id);
    const extendedAccounts = AccountService.getExtendedAccounts(user, accounts);

    const { sourceAccount, possibleDestinationAccounts } =
      await this.deps.receiveTokenService.getSourceAndDestinationAccounts(
        p.token,
        extendedAccounts,
      );

    const defaultReceiveAccount =
      ReceiveCashuTokenService.getDefaultReceiveAccount(
        sourceAccount,
        possibleDestinationAccounts,
        p.preferredReceiveAccountId,
      );

    return {
      sourceAccount,
      possibleDestinationAccounts,
      defaultReceiveAccount,
    };
  }

  /**
   * Create-only token claim: adds the destination account if unknown, then persists
   * either a same-account swap or cross-account receive quotes and returns the
   * transaction id. Does NOT melt or complete — the background processors finalize.
   * Does NOT set a default account (matches the interactive app path). Inputs are the
   * already-selected accounts from `getTokenAccounts`.
   */
  async createTokenClaim(p: {
    token: Token;
    sourceAccount: CashuAccountWithTokenFlags;
    destinationAccount: ReceiveCashuTokenAccount;
  }): Promise<CreateTokenClaimResult> {
    const user = await this.requireUser();

    let account: Account = p.destinationAccount;
    if (
      p.destinationAccount.isUnknown &&
      p.destinationAccount.type === 'cashu'
    ) {
      account = await this.deps.accountService.addCashuAccount({
        userId: user.id,
        account: p.destinationAccount,
      });
    }

    if (isClaimingToSameCashuAccount(account, p.sourceAccount)) {
      const { swap } = await this.deps.swapService.create({
        userId: user.id,
        token: p.token,
        account: account as CashuAccount,
      });
      return { transactionId: swap.transactionId, account };
    }

    const exchangeRate = await this.deps.getExchangeRate(
      `${p.sourceAccount.currency}-${account.currency}` as Ticker,
    );
    const quotes =
      await this.deps.receiveTokenQuoteService.createCrossAccountReceiveQuotes({
        userId: user.id,
        token: p.token,
        sourceAccount: p.sourceAccount,
        destinationAccount: account,
        exchangeRate,
      });
    return {
      transactionId: quotes.lightningReceiveQuote.transactionId,
      account,
    };
  }

  /**
   * Claims a cashu token: selects source + destination accounts, opportunistically
   * adds + defaults the destination, then completes inline (same-account swap, or
   * cross-account melt+receive). Best-effort completion — anything left is finalized
   * by the background processors. Throws `DomainError` on a non-recoverable failure.
   */
  async receiveToken(p: {
    token: Token;
    claimTo: 'cashu' | 'spark';
  }): Promise<ReceiveTokenResult> {
    const { token, claimTo } = p;
    const user = await this.requireUser();

    const accounts = await this.deps.accountRepository.getAllActive(user.id);
    const extendedAccounts = AccountService.getExtendedAccounts(user, accounts);
    const preferredReceiveAccountId =
      claimTo === 'spark'
        ? extendedAccounts.find((a) => a.type === 'spark')?.id
        : undefined;

    const { sourceAccount, possibleDestinationAccounts } =
      await this.deps.receiveTokenService.getSourceAndDestinationAccounts(
        token,
        extendedAccounts,
      );

    let receiveAccount = ReceiveCashuTokenService.getDefaultReceiveAccount(
      sourceAccount,
      possibleDestinationAccounts,
      preferredReceiveAccountId,
    );

    if (!receiveAccount) {
      throw new DomainError('Token from this mint cannot be claimed');
    }

    if (receiveAccount.isUnknown && receiveAccount.type === 'cashu') {
      const addedAccount = await this.deps.accountService.addCashuAccount({
        userId: user.id,
        account: receiveAccount,
      });
      receiveAccount = { ...receiveAccount, ...addedAccount };
    }

    if (
      receiveAccount.currency !== user.defaultCurrency ||
      !AccountService.isDefaultAccount(user, receiveAccount)
    ) {
      // Best-effort: failing to set the default account must not fail the claim.
      await this.trySetDefaultAccount(receiveAccount);
    }

    let transactionId: string;

    if (isClaimingToSameCashuAccount(receiveAccount, sourceAccount)) {
      const { swap, account } = await this.deps.swapService.create({
        userId: user.id,
        token,
        account: receiveAccount as CashuAccount,
      });
      transactionId = swap.transactionId;

      // Fail the claim only on a terminal FAILED swap state; a thrown (recoverable)
      // completion error is swallowed so the background processor can retry.
      const result = await this.tryCompleteSwap(account, swap);
      if (!result.success && result.swap?.state === 'FAILED') {
        throw new DomainError(result.swap.failureReason);
      }
    } else {
      const exchangeRate = await this.deps.getExchangeRate(
        `${sourceAccount.currency}-${receiveAccount.currency}` as Ticker,
      );
      const quotes =
        await this.deps.receiveTokenQuoteService.createCrossAccountReceiveQuotes(
          {
            userId: user.id,
            token,
            sourceAccount,
            destinationAccount: receiveAccount,
            exchangeRate,
          },
        );
      transactionId = quotes.lightningReceiveQuote.transactionId;

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

      // Best-effort: failure here is left for the background processor to retry.
      await this.tryCompleteReceive(quotes);
    }

    return {
      transactionId,
      destinationAccount: {
        id: receiveAccount.id,
        purpose: receiveAccount.purpose,
      },
    };
  }

  private async requireUser(): Promise<User> {
    const user = await this.deps.getUser();
    if (!user) throw new Error('No authenticated user');
    return user;
  }

  private async trySetDefaultAccount(account: Account): Promise<void> {
    try {
      await this.deps.setDefaultAccount({ account, setDefaultCurrency: true });
    } catch (error) {
      console.error('Failed to set default account while claiming the token', {
        cause: error,
        accountId: account.id,
      });
    }
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
        await this.deps.swapService.completeSwap(account, receiveSwap);

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
          await this.deps.service.completeReceive(
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
        await this.deps.sparkReceiveQuoteService.complete(
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

  private async classify(quoteId: string): Promise<TerminalStatus> {
    const quote = await this.deps.repository.get(quoteId);
    if (!quote) return { status: 'pending' };
    // Terminal sets must stay in lockstep with internal/realtime/lifecycle-events.ts.
    switch (quote.state) {
      case 'COMPLETED':
        return {
          status: 'completed',
          result: {
            protocol: 'cashu',
            quoteId: quote.id,
            transactionId: quote.transactionId,
            amount: quote.amount,
          },
        };
      case 'EXPIRED':
        return { status: 'expired' };
      case 'FAILED':
        return {
          status: 'failed',
          error: new DomainError(quote.failureReason),
        };
      default:
        // UNPAID, PAID — PAID is non-terminal (COMPLETED fires later).
        return { status: 'pending' };
    }
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
