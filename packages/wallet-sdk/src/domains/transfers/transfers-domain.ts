import type { TransfersDomain } from '../../domains';
import { SdkError } from '../../errors';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import type { AccountRepository } from '../../internal/repositories/account-repository';
import { CashuReceiveQuoteRepository } from '../../internal/repositories/cashu-receive-quote-repository';
import { CashuSendQuoteRepository } from '../../internal/repositories/cashu-send-quote-repository';
import { SparkReceiveQuoteRepository } from '../../internal/repositories/spark-receive-quote-repository';
import { SparkSendQuoteRepository } from '../../internal/repositories/spark-send-quote-repository';
import { CashuReceiveQuoteService } from '../cashu/cashu-receive-quote-service';
import { CashuSendQuoteService } from '../cashu/cashu-send-quote-service';
import { SparkReceiveQuoteService } from '../spark/spark-receive-quote-service';
import { SparkSendQuoteService } from '../spark/spark-send-quote-service';
import type { TransferLeg } from '../../types/transfer';
import type { DomainContext } from '../context';
import {
  type InternalTransferQuote,
  type TransferReceiveSide,
  type TransferSendSide,
  TransferService,
} from './transfer-service';

export function buildTransferService(
  ctx: DomainContext,
  accountRepository: AccountRepository,
): TransferService {
  const { supabase, encryption, cashuCrypto } = ctx.connections;
  const cashuReceive = new CashuReceiveQuoteService(
    cashuCrypto,
    new CashuReceiveQuoteRepository(supabase, encryption, accountRepository),
  );
  const sparkReceive = new SparkReceiveQuoteService(
    new SparkReceiveQuoteRepository(supabase, encryption),
  );
  const cashuSend = new CashuSendQuoteService(
    new CashuSendQuoteRepository(supabase, encryption),
  );
  const sparkSend = new SparkSendQuoteService(
    new SparkSendQuoteRepository(supabase, encryption),
  );
  return new TransferService(cashuReceive, sparkReceive, cashuSend, sparkSend);
}

/** Build the transfers domain: createQuote (preview) + executeQuote (persist paired quotes). */
export function createTransfersDomain(
  ctx: DomainContext,
  service: TransferService,
): TransfersDomain {
  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    return id;
  };

  const toLeg = (side: TransferReceiveSide | TransferSendSide): TransferLeg =>
    ('fee' in side
      ? { account: side.account, fee: side.fee }
      : {
          account: side.account,
          fee: side.lightningQuote.estimatedTotalFee,
        }) as TransferLeg;

  const toSlim = (q: InternalTransferQuote) => ({
    amount: q.amount,
    amountToReceive: q.amountToReceive,
    totalFees: q.totalFees,
    totalCost: q.totalCost,
    receive: toLeg(q.receive),
    send: toLeg(q.send),
  });

  return {
    async createQuote({ sourceAccount, destinationAccount, amount }) {
      const quote = await service.getTransferQuote({
        sourceAccount,
        destinationAccount,
        amount,
      });
      return toSlim(quote);
    },

    async executeQuote(quote) {
      const userId = await requireUserId();
      // The slim quote carries no live lightning quotes (and crosses the SDK boundary),
      // so re-derive fresh sides for the same amount + accounts before persisting.
      const rich = await service.getTransferQuote({
        sourceAccount: quote.send.account,
        destinationAccount: quote.receive.account,
        amount: quote.amount,
      });
      return service.initiateTransfer({ userId, quote: rich });
    },
  };
}
