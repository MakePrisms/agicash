// Transaction domain types — master verbatim
// app/features/transactions/transaction.ts + transaction-enums.ts
// app/features/transactions/transaction-details/transaction-details-types.ts

import type { AccountPurpose, AccountType } from './account';
import type { DestinationDetails } from './cashu';
import type { Money } from './money';

// ---- Enums ----

export type TransactionDirection = 'SEND' | 'RECEIVE';
export type TransactionType =
  | 'CASHU_LIGHTNING'
  | 'CASHU_TOKEN'
  | 'SPARK_LIGHTNING';
export type TransactionState =
  | 'DRAFT'
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REVERSED';
export type TransactionPurpose = 'PAYMENT' | 'BUY_CASHAPP' | 'TRANSFER';

// ---- Transaction Details — domain union (public) ----
// DB-data union and per-variant z.pipe parsers are SDK-internal (decision 7-ii).

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

export type CashuLightningReceiveTransactionDetails = {
  paymentRequest: string;
  paymentHash: string;
  description?: string;
  mintingFee?: Money;
  amount: Money;
  totalFee: Money;
  transferId?: string;
};

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

export type TransactionDetails =
  | CashuTokenSendTransactionDetails
  | CashuTokenReceiveTransactionDetails
  | CashuLightningSendTransactionDetails
  | CashuLightningReceiveTransactionDetails
  | SparkLightningReceiveTransactionDetails
  | SparkLightningSendTransactionDetails;

// ---- BaseTransaction ----

export type BaseTransaction = {
  id: string;
  userId: string;
  direction: TransactionDirection;
  type: TransactionType;
  state: TransactionState;
  /** null when the account was since deleted */
  accountId: string | null;
  accountName: string;
  accountType: AccountType;
  accountPurpose: AccountPurpose;
  amount: Money;
  details: TransactionDetails;
  reversedTransactionId?: string | null;
  purpose: TransactionPurpose;
  acknowledgmentStatus: 'pending' | 'acknowledged' | null;
  createdAt: string; // ISO 8601
  pendingAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  reversedAt?: string | null;
  version: number;
};

// The 9 type×direction(×state) variants are expressed via the base + purpose union.
// (Variant narrowing is the SDK implementation's responsibility.)

export type Transaction =
  | (BaseTransaction & {
      purpose: 'TRANSFER';
      details: BaseTransaction['details'] & { transferId: string };
    })
  | (BaseTransaction & { purpose: 'PAYMENT' | 'BUY_CASHAPP' });

export type TransactionCursor = {
  stateSortOrder: number;
  createdAt: string;
  id: string;
};
