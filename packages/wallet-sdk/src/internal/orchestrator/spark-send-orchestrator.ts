import type { Payment } from '@agicash/breez-sdk-spark';
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
}
