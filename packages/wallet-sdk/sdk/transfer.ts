import type { TransferQuote } from '../domain/transfer/transfer-service';

export type TransferApi = {
  /** Stateless preview. */
  getQuote(params: GetTransferQuoteParams): Promise<TransferQuote>; // public projection of TransferQuote settles in step 16
  initiate(params: InitiateTransferParams): Promise<{ transactionId: string }>;
};

export type GetTransferQuoteParams = unknown; // step 16 (transfer)
export type InitiateTransferParams = unknown; // step 16 (transfer)
