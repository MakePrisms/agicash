import type { Payment, SdkEvent } from '@agicash/breez-sdk-spark';
import type { SparkSendQuoteService } from '../../domains/spark/spark-send-quote-service';
import { DomainError, SdkError } from '../../errors';
import type { SdkEventMap } from '../../events';
import type { SparkAccount } from '../../types/account';
import type { SparkSendQuote } from '../../types/spark';
import type { SdkEventEmitter } from '../event-emitter';

type SparkPaymentEventType = 'paymentSucceeded' | 'paymentFailed';

export type SparkSendOrchestratorDeps = {
  sendQuoteService: SparkSendQuoteService;
  getAccount: (accountId: string) => Promise<SparkAccount | null>;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/**
 * Drives spark lightning sends. `initiateSend` is the UNPAID→PENDING kick (Breez
 * `sendPayment`); the terminal state arrives asynchronously via the Breez payment
 * event listener (`reconcile`), surfaced as `send:completed`/`send:failed`.
 * `executeQuote` wiring + the poll cadence are S9's job.
 */
export class SparkSendOrchestrator {
  constructor(private readonly deps: SparkSendOrchestratorDeps) {}

  async initiateSend(
    account: SparkAccount,
    sendQuote: SparkSendQuote,
  ): Promise<void> {
    if (sendQuote.state !== 'UNPAID') return;
    const { sendQuoteService, emitter } = this.deps;
    try {
      const updated = await sendQuoteService.initiateSend({
        account,
        sendQuote,
      });
      if (updated.state === 'PENDING') {
        emitter.emit('send:pending', {
          quoteId: updated.id,
          transactionId: updated.transactionId,
          protocol: 'spark',
        });
      }
    } catch (error) {
      if (error instanceof DomainError) {
        const failed = await sendQuoteService.fail(sendQuote, error.message);
        if (failed.state === 'FAILED') {
          emitter.emit('send:failed', {
            quoteId: failed.id,
            error: new SdkError(error.message, 'spark_send_failed'),
            protocol: 'spark',
          });
        }
        return;
      }
      throw error;
    }
  }

  async applyPaymentEvent(
    sendQuote: SparkSendQuote,
    payment: Payment,
    eventType: SparkPaymentEventType,
  ): Promise<void> {
    const { sendQuoteService, emitter } = this.deps;

    if (eventType === 'paymentSucceeded') {
      const preimage =
        payment.details?.type === 'lightning'
          ? payment.details.htlcDetails.preimage
          : undefined;
      if (!preimage) {
        console.error('spark send payment succeeded but no preimage', {
          paymentId: payment.id,
          quoteId: sendQuote.id,
        });
        return;
      }
      const completed = await sendQuoteService.complete(sendQuote, preimage);
      if (completed.state === 'COMPLETED') {
        emitter.emit('send:completed', {
          quoteId: completed.id,
          transactionId: completed.transactionId,
          amount: completed.amount,
          protocol: 'spark',
        });
      }
      return;
    }

    const message =
      sendQuote.expiresAt && new Date(sendQuote.expiresAt) < new Date()
        ? 'Lightning invoice expired.'
        : 'Lightning payment failed.';
    const failed = await sendQuoteService.fail(sendQuote, message);
    if (failed.state === 'FAILED') {
      emitter.emit('send:failed', {
        quoteId: failed.id,
        error: new SdkError(message, 'spark_send_failed'),
        protocol: 'spark',
      });
    }
  }

  async reconcile(sendQuotes: SparkSendQuote[]): Promise<() => void> {
    if (sendQuotes.length === 0) return () => undefined;
    const triggered = new Set<string>();
    const cleanups: Array<() => void> = [];

    const pendingByAccount = new Map<
      string,
      Extract<SparkSendQuote, { state: 'PENDING' }>[]
    >();
    for (const quote of sendQuotes) {
      if (quote.state === 'UNPAID') {
        const account = await this.deps.getAccount(quote.accountId);
        if (!account) continue;
        void this.initiateSend(account, quote).catch((error) =>
          console.error('spark send initiate failed', {
            quoteId: quote.id,
            cause: error,
          }),
        );
      } else if (quote.state === 'PENDING') {
        const list = pendingByAccount.get(quote.accountId) ?? [];
        list.push(quote);
        pendingByAccount.set(quote.accountId, list);
      }
    }

    for (const [accountId, quotes] of pendingByAccount) {
      const account = await this.deps.getAccount(accountId);
      if (!account) continue;
      const quoteByTransferId = new Map(
        quotes.map((q) => [q.sparkTransferId, q]),
      );

      const handle = (payment: Payment, eventType: SparkPaymentEventType) => {
        const quote = quoteByTransferId.get(payment.id);
        if (!quote) return;
        const key = `${quote.id}:${eventType}`;
        if (triggered.has(key)) return;
        triggered.add(key);
        void this.applyPaymentEvent(quote, payment, eventType).catch((error) =>
          console.error('spark send payment event failed', {
            quoteId: quote.id,
            cause: error,
          }),
        );
      };

      const listenerPromise = account.wallet.addEventListener({
        onEvent: (event: SdkEvent) => {
          if (
            event.type === 'paymentSucceeded' ||
            event.type === 'paymentFailed'
          ) {
            handle(event.payment, event.type);
          }
        },
      });
      cleanups.push(() => {
        void listenerPromise
          .then((id) => account.wallet.removeEventListener(id))
          .catch(() =>
            console.warn('Failed to remove Spark send listener', { accountId }),
          );
      });

      for (const quote of quotes) {
        void account.wallet
          .getPayment({ paymentId: quote.sparkTransferId })
          .then(({ payment }) => {
            if (!payment) return;
            if (payment.status === 'completed')
              handle(payment, 'paymentSucceeded');
            else if (payment.status === 'failed')
              handle(payment, 'paymentFailed');
          })
          .catch((error) =>
            console.error('spark send initial status check failed', {
              sparkTransferId: quote.sparkTransferId,
              cause: error,
            }),
          );
      }
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }
}
