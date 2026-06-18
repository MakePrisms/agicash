import type { Payment } from '@agicash/breez-sdk-spark';
import type { SparkAccount } from '../accounts/account';
import { sparkDebugLog } from '../spark-config';

/**
 * The work-set entry the tracker watches: one pending spark receive quote, the
 * spark account that owns it (resolves the Breez wallet the listener attaches
 * to), the invoice the initial lookup matches on, the payment hash the
 * paymentSucceeded event matches on, and the expiry the `synced` sweep checks.
 */
export type SparkReceiveWorkItem = {
  /** The receive quote id (the id the callbacks fire with). */
  id: string;
  /** The id of the spark account that owns the quote. */
  accountId: string;
  /** The quote's bolt11 invoice (used for the initial getPaymentByInvoice check). */
  paymentRequest: string;
  /** The lightning invoice's payment hash (matches the paymentSucceeded event). */
  paymentHash: string;
  /** Quote expiry as an ISO 8601 timestamp (the `synced` sweep compares to now). */
  expiresAt: string;
};

export type SparkReceiveTrackerOptions = {
  /**
   * Resolves the spark account (and thus its Breez wallet) for a work-item's
   * accountId.
   * @throws if the account is not a known spark account.
   */
  getSparkAccount: (accountId: string) => SparkAccount;
  /**
   * Called when a quote's lightning payment is detected as completed (via the
   * paymentSucceeded event or the initial completed-payment lookup), carrying
   * the spark transfer id and the extracted preimage.
   */
  onCompleted: (
    quoteId: string,
    paymentData: { sparkTransferId: string; paymentPreimage: string },
  ) => void;
  /** Called for a quote that is past its expiry when the wallet emits `synced`. */
  onExpired: (quoteId: string) => void;
};

/**
 * Tracks a work-set of pending spark receive quotes: groups them by spark
 * account and registers ONE Breez listener per account's `wallet`
 * (`addEventListener`, additive and independent of the always-on balance
 * listener `accounts.startSparkBalanceTracking` attaches to the same shared `BreezSdk`).
 * On `paymentSucceeded` it matches the lightning payment by htlc payment hash,
 * extracts the preimage, and fires {@link SparkReceiveTrackerOptions.onCompleted};
 * on `synced` it sweeps the account's quotes for any past their expiry and fires
 * {@link SparkReceiveTrackerOptions.onExpired}. The listener is registered BEFORE
 * the initial per-quote `getPaymentByInvoice` check so an already-completed
 * payment is not missed in the race window.
 *
 * `setQuotes` re-groups, re-registers the listeners, and re-runs the initial
 * check for the new quote set; `stop` awaits each listener promise then
 * removes it.
 */
export class SparkReceiveTracker {
  private readonly getSparkAccount: (accountId: string) => SparkAccount;
  private readonly onCompleted: SparkReceiveTrackerOptions['onCompleted'];
  private readonly onExpired: SparkReceiveTrackerOptions['onExpired'];

  private quotes: SparkReceiveWorkItem[] = [];
  private registrations: {
    wallet: SparkAccount['wallet'];
    listenerPromise: Promise<string>;
  }[] = [];

  constructor(options: SparkReceiveTrackerOptions) {
    this.getSparkAccount = options.getSparkAccount;
    this.onCompleted = options.onCompleted;
    this.onExpired = options.onExpired;
  }

  /**
   * Updates the work-set: tears down the previous account listeners, then for
   * the new set registers one listener per spark account and runs the initial
   * completed-payment check per quote.
   */
  setQuotes(quotes: SparkReceiveWorkItem[]): void {
    this.teardown();
    this.quotes = quotes;
    this.register();
  }

  /** Tears down the account listeners (awaits each promise then removes it). */
  stop(): void {
    this.teardown();
    this.quotes = [];
  }

  private register(): void {
    if (this.quotes.length === 0) {
      return;
    }

    const quotesByAccount = new Map<string, SparkReceiveWorkItem[]>();
    for (const quote of this.quotes) {
      const existing = quotesByAccount.get(quote.accountId);
      if (existing) {
        existing.push(quote);
      } else {
        quotesByAccount.set(quote.accountId, [quote]);
      }
    }

    for (const [accountId, quotes] of quotesByAccount) {
      const account = this.getSparkAccount(accountId);

      const quoteByPaymentHash = new Map(quotes.map((q) => [q.paymentHash, q]));

      const handlePayment = (payment: Payment) => {
        const details = payment.details;
        if (details?.type !== 'lightning') return;
        const quote = quoteByPaymentHash.get(details.htlcDetails.paymentHash);
        if (!quote) return;

        const preimage = details.htlcDetails.preimage;
        if (!preimage) {
          console.error('Receive payment succeeded but no preimage', {
            paymentId: payment.id,
            quoteId: quote.id,
          });
          return;
        }

        sparkDebugLog('Receive payment detected as completed', {
          quoteId: quote.id,
          accountId,
          sparkTransferId: payment.id,
        });
        this.onCompleted(quote.id, {
          sparkTransferId: payment.id,
          paymentPreimage: preimage,
        });
      };

      // Register event listener before initial check to avoid race conditions
      const listenerPromise = account.wallet.addEventListener({
        onEvent: (event) => {
          if (event.type === 'paymentSucceeded') {
            handlePayment(event.payment);
          } else if (event.type === 'synced') {
            for (const quote of quotes) {
              if (new Date(quote.expiresAt) < new Date()) {
                this.onExpired(quote.id);
              }
            }
          }
        },
      });
      this.registrations.push({ wallet: account.wallet, listenerPromise });

      // Initial status check per quote using local lookup (no network call)
      for (const quote of quotes) {
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
              accountId,
              quoteId: quote.id,
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
