import type { Payment } from '@agicash/breez-sdk-spark';
import type { SparkAccount } from '../accounts/account';
import type { SparkSendQuote } from '../send/spark-send-quote';
import { sparkDebugLog } from '../spark-config';

/**
 * The work-set entry the tracker watches: one unresolved spark send quote. The
 * full quote is carried (not a projection) because the callbacks fire with the
 * quote and the failure-reason branch reads `expiresAt`. The spark account that
 * owns it (resolved by `accountId`) provides the Breez wallet the listener
 * attaches to; `sparkTransferId` (present once PENDING) matches the payment
 * events.
 */
export type SparkSendWorkItem = SparkSendQuote;

export type SparkSendTrackerOptions = {
  /**
   * Resolves the spark account (and thus its Breez wallet) for a quote's
   * accountId.
   * @throws if the account is not a known spark account.
   */
  getSparkAccount: (accountId: string) => SparkAccount;
  /**
   * Called for an UNPAID quote to drive its initiation. Fired synchronously
   * when the work-set is set, deduped so a re-set of the same UNPAID quote does
   * not re-fire.
   */
  onUnpaid: (quote: SparkSendQuote) => void;
  /**
   * Called when a PENDING quote's lightning payment is detected as succeeded
   * (via the paymentSucceeded event or the initial completed-payment lookup),
   * carrying the extracted preimage.
   */
  onCompleted: (
    quote: SparkSendQuote,
    paymentData: { paymentPreimage: string },
  ) => void;
  /**
   * Called when a PENDING quote's lightning payment is detected as failed (via
   * the paymentFailed event or the initial failed-payment lookup), carrying the
   * reason (expired vs failed, decided by `expiresAt`).
   */
  onFailed: (quote: SparkSendQuote, failureReason: string) => void;
};

/**
 * Tracks a work-set of unresolved spark send quotes and:
 *  - for UNPAID quotes, fires {@link SparkSendTrackerOptions.onUnpaid} once (to
 *    drive initiation);
 *  - for PENDING quotes, groups them by spark account and registers ONE Breez
 *    listener per account's `wallet` (`addEventListener`, additive and
 *    independent of the always-on balance listener `accounts.startSparkBalanceTracking`
 *    attaches to the same shared `BreezSdk`). On `paymentSucceeded` it matches
 *    the payment by spark transfer id, extracts the preimage, and fires
 *    {@link SparkSendTrackerOptions.onCompleted}; on `paymentFailed` it fires
 *    {@link SparkSendTrackerOptions.onFailed}. The listener is registered BEFORE
 *    the initial per-quote `getPayment` check so an already-settled payment is
 *    not missed in the race window.
 *
 * A `lastTriggeredState` Map dedupes callbacks per quote (UNPAID/COMPLETED/
 * FAILED): Breez can re-fire the same payment event, and without this the same
 * transition would dispatch twice. The per-scope MutationObserver serialization
 * and the cache re-read guard in the processor do NOT cover this (a duplicate
 * event arriving after the first mutation settled would re-dispatch), so the
 * dedup is handled here. Entries for quotes no longer present are pruned on each
 * `setQuotes`.
 *
 * `setQuotes` prunes the dedup, fires UNPAID, re-groups, re-registers the
 * listeners, and re-runs the initial check for the new quote set; `stop`
 * removes the account listeners.
 */
export class SparkSendTracker {
  private readonly getSparkAccount: (accountId: string) => SparkAccount;
  private readonly onUnpaid: SparkSendTrackerOptions['onUnpaid'];
  private readonly onCompleted: SparkSendTrackerOptions['onCompleted'];
  private readonly onFailed: SparkSendTrackerOptions['onFailed'];

  // Tracks the last state a callback was fired for, per quote, to avoid
  // duplicate callbacks when Breez re-fires the same payment event.
  private readonly lastTriggeredState = new Map<
    string,
    SparkSendQuote['state']
  >();
  private registrations: {
    wallet: SparkAccount['wallet'];
    listenerPromise: Promise<string>;
  }[] = [];

  constructor(options: SparkSendTrackerOptions) {
    this.getSparkAccount = options.getSparkAccount;
    this.onUnpaid = options.onUnpaid;
    this.onCompleted = options.onCompleted;
    this.onFailed = options.onFailed;
  }

  /**
   * Updates the work-set: tears down the previous account listeners, prunes
   * dedup entries for quotes no longer present, fires onUnpaid for UNPAID
   * quotes, then for the PENDING quotes registers one listener per spark
   * account and runs the initial settled-payment check per quote.
   */
  setQuotes(quotes: SparkSendWorkItem[]): void {
    this.teardown();
    this.register(quotes);
  }

  /** Tears down the account listeners (removes each registered listener). */
  stop(): void {
    this.teardown();
    this.lastTriggeredState.clear();
  }

  private register(quotes: SparkSendWorkItem[]): void {
    const quoteIdSet = new Set(quotes.map((q) => q.id));

    // Clean up tracked states for quotes that are no longer in the list.
    for (const trackedQuoteId of this.lastTriggeredState.keys()) {
      if (!quoteIdSet.has(trackedQuoteId)) {
        this.lastTriggeredState.delete(trackedQuoteId);
      }
    }

    if (quotes.length === 0) {
      return;
    }

    type PendingQuote = Extract<SparkSendQuote, { state: 'PENDING' }>;
    const pendingQuotesByAccount = new Map<string, PendingQuote[]>();

    for (const quote of quotes) {
      if (quote.state === 'UNPAID') {
        if (this.lastTriggeredState.get(quote.id) !== 'UNPAID') {
          this.lastTriggeredState.set(quote.id, 'UNPAID');
          this.onUnpaid(quote);
        }
      } else if (quote.state === 'PENDING') {
        const existing = pendingQuotesByAccount.get(quote.accountId);
        if (existing) {
          existing.push(quote);
        } else {
          pendingQuotesByAccount.set(quote.accountId, [quote]);
        }
      }
    }

    for (const [accountId, accountQuotes] of pendingQuotesByAccount) {
      const account = this.getSparkAccount(accountId);
      const quoteByTransferId = new Map(
        accountQuotes.map((q) => [q.sparkTransferId, q]),
      );

      const handlePaymentEvent = (payment: Payment, eventType: string) => {
        const quote = quoteByTransferId.get(payment.id);
        if (!quote) return;

        if (
          eventType === 'paymentSucceeded' &&
          this.lastTriggeredState.get(quote.id) !== 'COMPLETED'
        ) {
          const preimage =
            payment.details?.type === 'lightning'
              ? payment.details.htlcDetails.preimage
              : undefined;
          if (!preimage) {
            console.error('Payment succeeded but no preimage', {
              paymentId: payment.id,
            });
            return;
          }
          this.lastTriggeredState.set(quote.id, 'COMPLETED');
          sparkDebugLog('Send payment detected as completed', {
            quoteId: quote.id,
            accountId,
          });
          this.onCompleted(quote, { paymentPreimage: preimage });
        } else if (
          eventType === 'paymentFailed' &&
          this.lastTriggeredState.get(quote.id) !== 'FAILED'
        ) {
          this.lastTriggeredState.set(quote.id, 'FAILED');
          const message =
            quote.expiresAt && new Date(quote.expiresAt) < new Date()
              ? 'Lightning invoice expired.'
              : 'Lightning payment failed.';
          this.onFailed(quote, message);
        }
      };

      // Register event listener before initial check to avoid race conditions.
      const listenerPromise = account.wallet.addEventListener({
        onEvent: (event) => {
          if (
            event.type === 'paymentSucceeded' ||
            event.type === 'paymentFailed'
          ) {
            handlePaymentEvent(event.payment, event.type);
          }
        },
      });
      this.registrations.push({ wallet: account.wallet, listenerPromise });

      // Initial status check per quote (catches events that fired before the
      // listener was registered).
      for (const quote of accountQuotes) {
        account.wallet
          .getPayment({ paymentId: quote.sparkTransferId })
          .then(({ payment }) => {
            if (payment.status === 'completed') {
              handlePaymentEvent(payment, 'paymentSucceeded');
            } else if (payment.status === 'failed') {
              handlePaymentEvent(payment, 'paymentFailed');
            }
          })
          .catch((error) => {
            console.error('Error checking initial send payment status', {
              cause: error,
              sparkTransferId: quote.sparkTransferId,
            });
          });
      }
    }
  }

  private teardown(): void {
    const registrations = this.registrations;
    this.registrations = [];
    for (const { wallet, listenerPromise } of registrations) {
      listenerPromise
        .then((id) => wallet.removeEventListener(id))
        .catch(() => {
          console.warn('Failed to remove Spark event listener');
        });
    }
  }
}
