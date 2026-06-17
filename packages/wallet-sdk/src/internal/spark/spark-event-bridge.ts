import type { BreezSdk, Payment } from '@agicash/breez-sdk-spark';
import type { SparkSendQuote } from '../../domains/spark-send-quote';
import type { SparkReceiveQuote } from '../../domains/spark-receive-quote';

type SparkRegistration = { wallet: BreezSdk; listenerPromise: Promise<string> };

function removeSparkListeners(registrations: SparkRegistration[]): void {
  for (const { wallet, listenerPromise } of registrations) {
    listenerPromise
      .then((id) => wallet.removeEventListener(id))
      .catch(() => {
        console.warn('Failed to remove Spark event listener');
      });
  }
}

export type SparkSendStateDeps = {
  getWallet: (accountId: string) => BreezSdk;
  onUnpaid: (quote: SparkSendQuote) => void;
  onCompleted: (quote: SparkSendQuote, payment: { paymentPreimage: string }) => void;
  onFailed: (quote: SparkSendQuote, failureReason: string) => void;
};

/**
 * Framework-free port of `useOnSparkSendStateChange`. One Breez listener per account;
 * fires onUnpaid immediately for UNPAID quotes, listens for paymentSucceeded/Failed, and
 * does an initial local `getPayment` lookup per pending quote to catch events that fired
 * before the listener registered. Per-quote dedup prevents double callbacks. The caller
 * owns one instance: `update()` on work-set change, `dispose()` on teardown.
 */
export class SparkSendStateTracker {
  private readonly lastTriggeredState = new Map<string, SparkSendQuote['state']>();
  private registrations: SparkRegistration[] = [];
  private generation = 0;

  update(sendQuotes: SparkSendQuote[], deps: SparkSendStateDeps): void {
    const generation = ++this.generation;
    removeSparkListeners(this.registrations);
    this.registrations = [];

    const quoteIdSet = new Set(sendQuotes.map((q) => q.id));
    for (const trackedId of this.lastTriggeredState.keys()) {
      if (!quoteIdSet.has(trackedId)) this.lastTriggeredState.delete(trackedId);
    }
    if (quoteIdSet.size === 0) return;

    type PendingQuote = Extract<SparkSendQuote, { state: 'PENDING' }>;
    const pendingByAccount = new Map<string, PendingQuote[]>();
    for (const quote of sendQuotes) {
      if (quote.state === 'UNPAID') {
        if (this.lastTriggeredState.get(quote.id) !== 'UNPAID') {
          this.lastTriggeredState.set(quote.id, 'UNPAID');
          deps.onUnpaid(quote);
        }
      } else if (quote.state === 'PENDING') {
        const existing = pendingByAccount.get(quote.accountId);
        if (existing) existing.push(quote);
        else pendingByAccount.set(quote.accountId, [quote]);
      }
    }

    for (const [accountId, quotes] of pendingByAccount) {
      const wallet = deps.getWallet(accountId);
      const quoteByTransferId = new Map(quotes.map((q) => [q.sparkTransferId, q]));

      const handlePaymentEvent = (payment: Payment, eventType: string) => {
        if (generation !== this.generation) return;
        const quote = quoteByTransferId.get(payment.id);
        if (!quote) return;
        if (eventType === 'paymentSucceeded' && this.lastTriggeredState.get(quote.id) !== 'COMPLETED') {
          const preimage =
            payment.details?.type === 'lightning' ? payment.details.htlcDetails.preimage : undefined;
          if (!preimage) {
            console.error('Payment succeeded but no preimage', { paymentId: payment.id });
            return;
          }
          this.lastTriggeredState.set(quote.id, 'COMPLETED');
          deps.onCompleted(quote, { paymentPreimage: preimage });
        } else if (eventType === 'paymentFailed' && this.lastTriggeredState.get(quote.id) !== 'FAILED') {
          this.lastTriggeredState.set(quote.id, 'FAILED');
          const message =
            quote.expiresAt && new Date(quote.expiresAt) < new Date()
              ? 'Lightning invoice expired.'
              : 'Lightning payment failed.';
          deps.onFailed(quote, message);
        }
      };

      const listenerPromise = wallet.addEventListener({
        onEvent(event) {
          if (event.type === 'paymentSucceeded' || event.type === 'paymentFailed') {
            handlePaymentEvent(event.payment, event.type);
          }
        },
      });
      this.registrations.push({ wallet, listenerPromise });

      for (const quote of quotes) {
        wallet
          .getPayment({ paymentId: quote.sparkTransferId })
          .then(({ payment }) => {
            if (payment.status === 'completed') handlePaymentEvent(payment, 'paymentSucceeded');
            else if (payment.status === 'failed') handlePaymentEvent(payment, 'paymentFailed');
          })
          .catch((error) =>
            console.error('Error checking initial send payment status', {
              cause: error,
              sparkTransferId: quote.sparkTransferId,
            }),
          );
      }
    }
  }

  dispose(): void {
    ++this.generation;
    removeSparkListeners(this.registrations);
    this.registrations = [];
    this.lastTriggeredState.clear();
  }
}

export type SparkReceiveStateDeps = {
  getWallet: (accountId: string) => BreezSdk;
  onCompleted: (quoteId: string, payment: { sparkTransferId: string; paymentPreimage: string }) => void;
  onExpired: (quoteId: string) => void;
};

/**
 * Framework-free port of `useOnSparkReceiveStateChange`. One Breez listener per account;
 * matches paymentSucceeded by payment hash, expires quotes on `synced`, and does an initial
 * `getPaymentByInvoice` lookup per quote to catch pre-listener events.
 */
export class SparkReceiveStateTracker {
  private registrations: SparkRegistration[] = [];
  private generation = 0;

  update(pendingQuotes: SparkReceiveQuote[], deps: SparkReceiveStateDeps): void {
    const generation = ++this.generation;
    removeSparkListeners(this.registrations);
    this.registrations = [];
    if (pendingQuotes.length === 0) return;

    const quotesByAccount = new Map<string, SparkReceiveQuote[]>();
    for (const quote of pendingQuotes) {
      const existing = quotesByAccount.get(quote.accountId);
      if (existing) existing.push(quote);
      else quotesByAccount.set(quote.accountId, [quote]);
    }

    for (const [accountId, quotes] of quotesByAccount) {
      const wallet = deps.getWallet(accountId);
      const quoteByPaymentHash = new Map(quotes.map((q) => [q.paymentHash, q]));

      const handlePayment = (payment: Payment) => {
        if (generation !== this.generation) return;
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
        deps.onCompleted(quote.id, { sparkTransferId: payment.id, paymentPreimage: preimage });
      };

      const listenerPromise = wallet.addEventListener({
        onEvent(event) {
          if (event.type === 'paymentSucceeded') {
            handlePayment(event.payment);
          } else if (event.type === 'synced') {
            for (const quote of quotes) {
              if (new Date(quote.expiresAt) < new Date()) {
                deps.onExpired(quote.id);
              }
            }
          }
        },
      });
      this.registrations.push({ wallet, listenerPromise });

      for (const quote of quotes) {
        wallet
          .getPaymentByInvoice({ invoice: quote.paymentRequest })
          .then((response) => {
            if (response.payment && response.payment.status === 'completed') {
              handlePayment(response.payment);
            }
          })
          .catch((error) =>
            console.error('Error checking initial receive payment', {
              cause: error,
              accountId,
              quoteId: quote.id,
            }),
          );
      }
    }
  }

  dispose(): void {
    ++this.generation;
    removeSparkListeners(this.registrations);
    this.registrations = [];
  }
}
