/**
 * Spark Breez-event substrate — Slice 5 / PR7 (background).
 *
 * EXTRACTED (re-housed framework-free) from the Breez `addEventListener` logic in
 * `apps/web-wallet/app/features/send/spark-send-quote-hooks.ts#useProcessSparkSendQuoteTasks` and
 * `receive/spark-receive-quote-hooks.ts#useProcessSparkReceiveQuoteTasks`.
 *
 * Spark has NO mint WebSocket (unlike cashu) — a spark send/receive reaches its TERMINAL state via
 * the account's OWN Breez SDK event stream (`paymentSucceeded` / `paymentFailed` / `synced`), NOT a
 * mint subscription and NOT a DB trigger. The {@link Orchestrator} exposes the spark terminal STEP
 * cores (`stepSparkSendCompleted` / `stepSparkSendFailed` / `stepSparkReceiveCompleted` /
 * `stepSparkReceiveExpired`) but has no live Breez listener of its own (PR5c left that to "the S5
 * spark-event substrate"); THIS forwarder is that substrate — it registers the per-account Breez
 * listeners and pumps those step cores. It is the spark analogue of the orchestrator's mint-WS
 * managers, and a sibling of {@link SparkBalanceTracker} (which listens to the SAME stream for
 * balance, not quote-state).
 *
 * Matching is master-verbatim:
 *  - SEND: a PENDING send quote carries `sparkTransferId`; a `paymentSucceeded` / `paymentFailed`
 *    event's `payment.id` matches it. The lightning preimage comes from
 *    `payment.details.htlcDetails.preimage`.
 *  - RECEIVE: an UNPAID receive quote carries `paymentHash`; a `paymentSucceeded` event's
 *    `payment.details.htlcDetails.paymentHash` matches it; the transfer id is `payment.id`.
 *  - EXPIRY: a `synced` event re-checks pending receive quotes for past-expiry.
 *
 * As with master, on (re)registration each currently-pending quote also gets an INITIAL status
 * check via `getPayment` / `getPaymentByInvoice` (no realtime catch-up otherwise: an event that
 * fired before the listener attached would be missed).
 *
 * The Breez `Payment` / `SdkEvent` TYPES are imported type-only (erased; NO WASM). Only the leader
 * runs this (the {@link BackgroundProcessor} calls {@link track} with the pending spark quotes when
 * it becomes leader, and {@link stop} when it stops / on `destroy`).
 *
 * @module
 */
import type { Payment, SdkEvent } from '@agicash/breez-sdk-spark';
import type { Orchestrator } from './orchestrator';
import type { SparkAccount } from '../types/account';
import type { SparkSendQuote, SparkReceiveQuote } from '../types/spark';

/** A registered per-account Breez listener: the wallet + the (resolved) listener id, for cleanup. */
type Registration = {
  wallet: SparkAccount['wallet'];
  listenerId: Promise<string>;
};

/** The pending spark quotes to drive, grouped by their owning account (its live Breez wallet). */
export type PendingSparkWork = {
  /** The online spark accounts owning the pending quotes (their live `wallet` is listened to). */
  accounts: SparkAccount[];
  /** PENDING spark SEND quotes (awaiting their Breez payment outcome). */
  sendQuotes: SparkSendQuote[];
  /** UNPAID spark LIGHTNING RECEIVE quotes (awaiting their Breez payment). */
  receiveQuotes: SparkReceiveQuote[];
};

/**
 * Registers per-account Breez listeners and forwards spark payment events to the orchestrator's
 * spark terminal step cores. Framework-free; one instance per SDK, owned by the
 * {@link BackgroundProcessor}.
 */
export class SparkEventForwarder {
  /** accountId -> its Breez listener registration. */
  private readonly registrations = new Map<string, Registration>();
  /** sparkTransferId (`payment.id`) -> agicash SEND quote id (pending sends awaiting settlement). */
  private sendByTransferId = new Map<string, string>();
  /** paymentHash -> { agicash RECEIVE quote id, expiresAt } (pending receives awaiting payment). */
  private receiveByPaymentHash = new Map<
    string,
    { quoteId: string; expiresAt: string }
  >();

  constructor(private readonly orchestrator: Orchestrator) {}

  /**
   * (Re)point the forwarder at the given pending spark work. Registers a Breez listener for each
   * account not already tracked, drops listeners for accounts no longer present, and refreshes the
   * match maps. Idempotent per account (one listener each, like the balance tracker). Newly-pending
   * quotes also get an initial status check (catch-up for events that fired pre-listener).
   *
   * @param work - the pending spark send/receive quotes + their accounts.
   */
  track(work: PendingSparkWork): void {
    // Refresh the match maps from the current pending set.
    this.sendByTransferId = new Map(
      work.sendQuotes
        .filter((q) => q.state === 'PENDING' && q.sparkTransferId)
        .map((q) => [
          (q as Extract<SparkSendQuote, { state: 'PENDING' }>).sparkTransferId,
          q.id,
        ]),
    );
    this.receiveByPaymentHash = new Map(
      work.receiveQuotes
        .filter((q) => q.state === 'UNPAID')
        .map((q) => [q.paymentHash, { quoteId: q.id, expiresAt: q.expiresAt }]),
    );

    const incomingIds = new Set(work.accounts.map((a) => a.id));
    // Drop listeners for accounts that are no longer tracked.
    for (const id of [...this.registrations.keys()]) {
      if (!incomingIds.has(id)) {
        this.untrack(id);
      }
    }

    for (const account of work.accounts) {
      if (!this.registrations.has(account.id)) {
        this.register(account);
      }
      this.initialStatusCheck(account, work);
    }
  }

  /** Register one account's Breez listener (the persistent realtime path). */
  private register(account: SparkAccount): void {
    const listenerId = account.wallet.addEventListener({
      onEvent: (event: SdkEvent) => {
        if (event.type === 'paymentSucceeded') {
          this.handlePaymentSucceeded(event.payment);
        } else if (event.type === 'paymentFailed') {
          this.handlePaymentFailed(event.payment);
        } else if (event.type === 'synced') {
          this.handleSynced();
        }
      },
    });
    this.registrations.set(account.id, { wallet: account.wallet, listenerId });
  }

  /**
   * Initial per-quote status check on (re)registration: master fetches the current payment so an
   * event that fired before the listener attached is not missed. Best-effort (errors are logged).
   */
  private initialStatusCheck(
    account: SparkAccount,
    work: PendingSparkWork,
  ): void {
    for (const quote of work.sendQuotes) {
      if (quote.accountId !== account.id || quote.state !== 'PENDING') {
        continue;
      }
      const sparkTransferId = (
        quote as Extract<SparkSendQuote, { state: 'PENDING' }>
      ).sparkTransferId;
      account.wallet
        .getPayment({ paymentId: sparkTransferId })
        .then(({ payment }) => {
          if (payment.status === 'completed') {
            this.handlePaymentSucceeded(payment);
          } else if (payment.status === 'failed') {
            this.handlePaymentFailed(payment);
          }
        })
        .catch((error) => {
          console.warn('Error checking initial spark send payment status', {
            cause: error,
            sparkTransferId,
          });
        });
    }
    for (const quote of work.receiveQuotes) {
      if (quote.accountId !== account.id || quote.state !== 'UNPAID') {
        continue;
      }
      account.wallet
        .getPaymentByInvoice({ invoice: quote.paymentRequest })
        .then(({ payment }) => {
          if (payment && payment.status === 'completed') {
            this.handlePaymentSucceeded(payment);
          }
        })
        .catch((error) => {
          console.warn('Error checking initial spark receive payment', {
            cause: error,
            quoteId: quote.id,
          });
        });
    }
  }

  /** A succeeded payment: match it to a pending send OR receive quote and step the orchestrator. */
  private handlePaymentSucceeded(payment: Payment): void {
    const preimage = lightningPreimage(payment);

    // SEND: matched by sparkTransferId (= payment.id).
    const sendQuoteId = this.sendByTransferId.get(payment.id);
    if (sendQuoteId) {
      if (!preimage) {
        console.error('Spark send payment succeeded but no preimage', {
          paymentId: payment.id,
        });
        return;
      }
      this.sendByTransferId.delete(payment.id);
      void this.orchestrator.stepSparkSendCompleted({
        quoteId: sendQuoteId,
        paymentPreimage: preimage,
      });
      return;
    }

    // RECEIVE: matched by paymentHash.
    const paymentHash = lightningPaymentHash(payment);
    if (!paymentHash) {
      return;
    }
    const receive = this.receiveByPaymentHash.get(paymentHash);
    if (!receive) {
      return;
    }
    if (!preimage) {
      console.error('Spark receive payment succeeded but no preimage', {
        paymentId: payment.id,
        quoteId: receive.quoteId,
      });
      return;
    }
    this.receiveByPaymentHash.delete(paymentHash);
    void this.orchestrator.stepSparkReceiveCompleted({
      quoteId: receive.quoteId,
      paymentPreimage: preimage,
      sparkTransferId: payment.id,
    });
  }

  /** A failed payment: match it to a pending SEND quote and fail it. */
  private handlePaymentFailed(payment: Payment): void {
    const sendQuoteId = this.sendByTransferId.get(payment.id);
    if (!sendQuoteId) {
      return;
    }
    this.sendByTransferId.delete(payment.id);
    void this.orchestrator.stepSparkSendFailed({
      quoteId: sendQuoteId,
      reason: 'Lightning payment failed.',
    });
  }

  /** A `synced` event: expire any pending receive quote whose `expiresAt` has passed (master). */
  private handleSynced(): void {
    const now = new Date();
    for (const [hash, { quoteId, expiresAt }] of [
      ...this.receiveByPaymentHash,
    ]) {
      if (new Date(expiresAt) < now) {
        this.receiveByPaymentHash.delete(hash);
        void this.orchestrator.stepSparkReceiveExpired(quoteId);
      }
    }
  }

  /** Remove one account's Breez listener. */
  private untrack(accountId: string): void {
    const registration = this.registrations.get(accountId);
    if (!registration) {
      return;
    }
    this.registrations.delete(accountId);
    registration.listenerId
      .then((id) => registration.wallet.removeEventListener(id))
      .catch(() => {
        console.warn('Failed to remove Spark event listener', { accountId });
      });
  }

  /** Remove ALL Breez listeners + clear the match maps (on `background.stop()` / `Sdk.destroy()`). */
  stop(): void {
    for (const id of [...this.registrations.keys()]) {
      this.untrack(id);
    }
    this.sendByTransferId.clear();
    this.receiveByPaymentHash.clear();
  }
}

/** Extract the lightning preimage from a payment (master: `details.htlcDetails.preimage`). */
function lightningPreimage(payment: Payment): string | undefined {
  const details = payment.details;
  if (details?.type !== 'lightning') {
    return undefined;
  }
  return details.htlcDetails.preimage;
}

/** Extract the lightning payment hash from a payment (master: `details.htlcDetails.paymentHash`). */
function lightningPaymentHash(payment: Payment): string | undefined {
  const details = payment.details;
  if (details?.type !== 'lightning') {
    return undefined;
  }
  return details.htlcDetails.paymentHash;
}
