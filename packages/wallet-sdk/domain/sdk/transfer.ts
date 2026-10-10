import type { Money } from '@agicash/money';
import type { Account } from '../accounts/account';
import type { TransferQuote } from '../transfer/transfer-service';

export type TransferApi = {
  /** Stateless preview. Computes lightning quotes and does not persist them. */
  getQuote(params: GetTransferQuoteParams): Promise<TransferQuote>;
  /** Persists the receive quote, then the send quote. Completion is background-only. */
  initiate(params: InitiateTransferParams): Promise<InitiateTransferResult>;
};
export type GetTransferQuoteParams = {
  /** Caller-supplied sending account. The SDK does not re-fetch it. */
  sourceAccount: Account;
  /** Caller-supplied receiving account. The SDK does not re-fetch it. */
  destinationAccount: Account;
  /** The amount to transfer. */
  amount: Money;
};
export type InitiateTransferParams = {
  /** The quote returned by `getQuote`. */
  quote: TransferQuote;
};
export type InitiateTransferResult = {
  /** UUID linking the receive and send quotes. */
  transferId: string;
  /** Transaction id of the receive leg. */
  receiveTransactionId: string;
  /** Transaction id of the send leg. */
  sendTransactionId: string;
};
