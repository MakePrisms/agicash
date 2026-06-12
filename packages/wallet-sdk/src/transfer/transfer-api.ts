import type { Money } from '@agicash/utils/money';
import type { Account } from '../accounts/account';
import type { CashuReceiveQuoteService } from '../receive/cashu-receive-quote-service';
import type { SparkReceiveQuoteService } from '../receive/spark-receive-quote-service';
import type { CashuSendQuoteService } from '../send/cashu-send-quote-service';
import type { SparkSendQuoteService } from '../send/spark-send-quote-service';
import { type TransferQuote, TransferService } from './transfer-service';

export type TransferApi = {
  /**
   * Gets a transfer quote for moving the amount from the source account to the
   * destination account. Only fetches the lightning quotes; nothing is
   * persisted.
   * @throws DomainError when the source cannot send or the destination cannot
   * receive Lightning payments.
   */
  getTransferQuote: (params: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }) => Promise<TransferQuote>;
  /**
   * Initiates a transfer for the current user by persisting the receive and
   * send quotes (the background task processor picks up the send quote). If the
   * send quote fails to persist the receive quote is failed (best-effort
   * cleanup).
   * @throws when the receive or send quote fails to persist.
   */
  initiateTransfer: (params: { quote: TransferQuote }) => Promise<{
    transferId: string;
    receiveTransactionId: string;
    sendTransactionId: string;
  }>;
};

export type TransferApiDeps = {
  /**
   * Resolves the current user's id from the SDK's user state.
   * @throws if no user is loaded yet.
   */
  getCurrentUserId: () => string;
  cashuReceiveQuoteService: CashuReceiveQuoteService;
  sparkReceiveQuoteService: SparkReceiveQuoteService;
  cashuSendQuoteService: CashuSendQuoteService;
  sparkSendQuoteService: SparkSendQuoteService;
};

export function createTransferApi(deps: TransferApiDeps): {
  api: TransferApi;
} {
  const {
    getCurrentUserId,
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
    cashuSendQuoteService,
    sparkSendQuoteService,
  } = deps;

  const transferService = new TransferService(
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
    cashuSendQuoteService,
    sparkSendQuoteService,
  );

  const api: TransferApi = {
    getTransferQuote: (params) => transferService.getTransferQuote(params),
    initiateTransfer: ({ quote }) =>
      transferService.initiateTransfer({ userId: getCurrentUserId(), quote }),
  };

  return { api };
}
