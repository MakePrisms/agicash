import type { Money } from '@agicash/money';
import type { SparkDomain } from '../../domains';
import { DomainError, NotImplementedError, SdkError } from '../../errors';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import {
  buildLightningAddressFormatValidator,
  getInvoiceFromLud16,
  isLNURLError,
} from '../../internal/lib/lnurl';
import { SparkReceiveQuoteRepository } from '../../internal/repositories/spark-receive-quote-repository';
import { SparkSendQuoteRepository } from '../../internal/repositories/spark-send-quote-repository';
import type { DomainContext } from '../context';
import { createExchangeRateDomain } from '../exchange-rate/exchange-rate-domain';
import { getLightningQuote as getReceiveLightningQuote } from './spark-receive-quote-core';
import { SparkReceiveQuoteService } from './spark-receive-quote-service';
import { SparkSendQuoteService } from './spark-send-quote-service';

/**
 * Build the spark domain over the shared context.
 *
 * `send.createLightningQuote`/`failQuote`/`get` and `receive.createLightningQuote`/`get`
 * are implemented here. `send.executeQuote` (the Breez-event-driven send orchestrator)
 * throws {@link NotImplementedError}.
 */
export function createSparkDomain(ctx: DomainContext): SparkDomain {
  const { supabase, encryption } = ctx.connections;

  const sendQuoteRepo = new SparkSendQuoteRepository(supabase, encryption);
  const receiveQuoteRepo = new SparkReceiveQuoteRepository(
    supabase,
    encryption,
  );

  const sendQuoteService = new SparkSendQuoteService(sendQuoteRepo);
  const receiveQuoteService = new SparkReceiveQuoteService(receiveQuoteRepo);

  const exchangeRate = createExchangeRateDomain();

  const isLightningAddress = buildLightningAddressFormatValidator({
    message: 'invalid',
    allowLocalhost: ctx.config.allowLocalhostLightningAddress ?? false,
  });

  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    return id;
  };

  /** Resolve `destination` to a bolt11 invoice; ln-address resolves via LNURL-pay using `amountBtc`. */
  const resolveDestination = async (
    destination: string,
    amountBtc?: Money<'BTC'>,
  ): Promise<string> => {
    if (isLightningAddress(destination) !== true) return destination;
    if (!amountBtc) {
      throw new DomainError(
        'Amount is required to send to a lightning address',
        'amount_required',
      );
    }
    const result = await getInvoiceFromLud16(destination, amountBtc);
    if (isLNURLError(result))
      throw new DomainError(result.reason, 'lnurl_error');
    return result.pr;
  };

  return {
    send: {
      async createLightningQuote({ account, destination, amount }) {
        const userId = await requireUserId();
        const amountBtc =
          amount === undefined
            ? undefined
            : amount.currency === 'BTC'
              ? (amount as Money<'BTC'>)
              : ((await exchangeRate.convert({
                  amount,
                  to: 'BTC',
                })) as Money<'BTC'>);

        const paymentRequest = await resolveDestination(destination, amountBtc);

        const quote = await sendQuoteService.getLightningSendQuote({
          account,
          paymentRequest,
          amount: amountBtc,
        });

        return sendQuoteService.createSendQuote({ userId, account, quote });
      },

      executeQuote() {
        throw new NotImplementedError('spark.send.executeQuote');
      },

      async failQuote(quote, reason) {
        await sendQuoteService.fail(quote, reason);
      },

      async get(quoteId) {
        return sendQuoteRepo.get(quoteId);
      },
    },

    receive: {
      async createLightningQuote({ account, amount, description, purpose }) {
        const userId = await requireUserId();
        const lightningQuote = await getReceiveLightningQuote({
          wallet: account.wallet,
          amount,
          description,
        });

        return receiveQuoteService.createReceiveQuote({
          userId,
          account,
          lightningQuote,
          receiveType: 'LIGHTNING',
          purpose,
        });
      },

      async get(quoteId) {
        return receiveQuoteRepo.get(quoteId);
      },
    },
  };
}
