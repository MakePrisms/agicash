/**
 * TransactionDetails — the 6-variant PUBLIC domain union (§7 of the contract).
 *
 * Lifted verbatim (as the zod/mini `z.infer` shapes) from
 * `app/features/transactions/transaction-details/transaction-details-types.ts`
 * + the 6 per-variant files. The SDK OWNS this domain type (public); the parallel
 * DB-data union + its `z.pipe` parsers are INTERNAL to the SDK (decision 7-ii) and
 * are NOT part of PR1.
 */
import type { Money } from './money';
import type { DestinationDetails } from './cashu';

// --- Cashu token send ------------------------------------------------------
export type CashuTokenSendTransactionDetails = {
  tokenAmount: Money;
  tokenMintUrl: string;
  amountReserved: Money;
  amount: Money;
  amountReceived: Money;
  cashuReceiveFee: Money;
  cashuSendFee: Money;
  totalFee: Money;
};

// --- Cashu token receive ---------------------------------------------------
export type CashuTokenReceiveTransactionDetails = {
  tokenAmount: Money;
  tokenMintUrl: string;
  description?: string;
  amount: Money;
  cashuReceiveFee: Money;
  mintingFee?: Money;
  lightningFeeReserve?: Money;
  totalFee: Money;
};

// --- Cashu lightning send (Incomplete | Completed) -------------------------
export type IncompleteCashuLightningSendTransactionDetails = {
  paymentRequest: string;
  paymentHash: string;
  destinationDetails?: DestinationDetails;
  amountReserved: Money;
  amountReceived: Money;
  lightningFeeReserve: Money;
  cashuSendFee: Money;
  estimatedTotalFee: Money;
  amount: Money;
  transferId?: string;
};
export type CompletedCashuLightningSendTransactionDetails =
  IncompleteCashuLightningSendTransactionDetails & {
    preimage: string;
    lightningFee: Money;
    totalFee: Money;
  };
export type CashuLightningSendTransactionDetails =
  | IncompleteCashuLightningSendTransactionDetails
  | CompletedCashuLightningSendTransactionDetails;

// --- Cashu lightning receive ----------------------------------------------
export type CashuLightningReceiveTransactionDetails = {
  paymentRequest: string;
  paymentHash: string;
  description?: string;
  mintingFee?: Money;
  amount: Money;
  totalFee: Money;
  transferId?: string;
};

// --- Spark lightning send (Incomplete | Completed) -------------------------
export type IncompleteSparkLightningSendTransactionDetails = {
  amountReceived: Money;
  estimatedFee: Money;
  paymentRequest: string;
  paymentHash: string;
  amount: Money;
  fee: Money;
  sparkId?: string;
  sparkTransferId?: string;
  transferId?: string;
};
export type CompletedSparkLightningSendTransactionDetails =
  Required<IncompleteSparkLightningSendTransactionDetails> & {
    paymentPreimage: string;
    transferId?: string;
  };
export type SparkLightningSendTransactionDetails =
  | IncompleteSparkLightningSendTransactionDetails
  | CompletedSparkLightningSendTransactionDetails;

// --- Spark lightning receive (Incomplete | Completed) ----------------------
export type IncompleteSparkLightningReceiveTransactionDetails = {
  paymentRequest: string;
  paymentHash: string;
  sparkId: string;
  description?: string;
  amount: Money;
  transferId?: string;
};
export type CompletedSparkLightningReceiveTransactionDetails =
  IncompleteSparkLightningReceiveTransactionDetails & {
    paymentPreimage: string;
    sparkTransferId: string;
  };
export type SparkLightningReceiveTransactionDetails =
  | IncompleteSparkLightningReceiveTransactionDetails
  | CompletedSparkLightningReceiveTransactionDetails;

// --- The domain union ------------------------------------------------------
export type TransactionDetails =
  | CashuTokenSendTransactionDetails
  | CashuTokenReceiveTransactionDetails
  | CashuLightningSendTransactionDetails
  | CashuLightningReceiveTransactionDetails
  | SparkLightningReceiveTransactionDetails
  | SparkLightningSendTransactionDetails;
