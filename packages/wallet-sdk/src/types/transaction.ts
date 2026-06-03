/**
 * Transaction domain types — §7 of the contract.
 *
 * Lifted verbatim (as the zod/mini `z.infer` shapes) from
 * `app/features/transactions/transaction.ts` + `transaction-enums.ts`:
 * a union of 9 (type × direction × state) variants ∧ a purpose-discriminator.
 * `purpose: 'TRANSFER'` injects `details: { transferId }`, else
 * `purpose: 'PAYMENT' | 'BUY_CASHAPP'`.
 */
import type { Money } from './money';
import type { AccountPurpose, AccountType } from './account';
import type {
  CashuLightningReceiveTransactionDetails,
  CashuTokenReceiveTransactionDetails,
  CashuTokenSendTransactionDetails,
  CompletedCashuLightningSendTransactionDetails,
  CompletedSparkLightningReceiveTransactionDetails,
  CompletedSparkLightningSendTransactionDetails,
  IncompleteCashuLightningSendTransactionDetails,
  IncompleteSparkLightningReceiveTransactionDetails,
  IncompleteSparkLightningSendTransactionDetails,
  TransactionDetails,
} from './transaction-details';

// --- enums (transaction-enums.ts) ------------------------------------------
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

// --- BaseTransaction -------------------------------------------------------
export type BaseTransaction = {
  id: string;
  userId: string;
  direction: TransactionDirection;
  type: TransactionType;
  state: TransactionState;
  /** null when the account was since deleted (denormalized fields still describe it). */
  accountId: string | null;
  accountName: string;
  accountType: AccountType;
  accountPurpose: AccountPurpose;
  amount: Money;
  details: TransactionDetails;
  reversedTransactionId?: string | null;
  purpose: TransactionPurpose;
  acknowledgmentStatus: 'pending' | 'acknowledged' | null;
  /** ISO 8601 */
  createdAt: string;
  pendingAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  reversedAt?: string | null;
  version: number;
};

// --- the 9 type×direction(×state) variants, each pinning a concrete `details`
type CashuTokenSendTransaction = BaseTransaction & {
  type: 'CASHU_TOKEN';
  direction: 'SEND';
  details: CashuTokenSendTransactionDetails;
};
type CashuTokenReceiveTransaction = BaseTransaction & {
  type: 'CASHU_TOKEN';
  direction: 'RECEIVE';
  details: CashuTokenReceiveTransactionDetails;
};
type IncompleteCashuLightningSendTransaction = BaseTransaction & {
  type: 'CASHU_LIGHTNING';
  direction: 'SEND';
  state: 'PENDING' | 'FAILED';
  details: IncompleteCashuLightningSendTransactionDetails;
};
type CompletedCashuLightningSendTransaction = BaseTransaction & {
  type: 'CASHU_LIGHTNING';
  direction: 'SEND';
  state: 'COMPLETED';
  details: CompletedCashuLightningSendTransactionDetails;
};
type CashuLightningReceiveTransaction = BaseTransaction & {
  type: 'CASHU_LIGHTNING';
  direction: 'RECEIVE';
  details: CashuLightningReceiveTransactionDetails;
};
type IncompleteSparkLightningReceiveTransaction = BaseTransaction & {
  type: 'SPARK_LIGHTNING';
  direction: 'RECEIVE';
  state: 'DRAFT' | 'PENDING' | 'FAILED';
  details: IncompleteSparkLightningReceiveTransactionDetails;
};
type CompletedSparkLightningReceiveTransaction = BaseTransaction & {
  type: 'SPARK_LIGHTNING';
  direction: 'RECEIVE';
  state: 'COMPLETED';
  details: CompletedSparkLightningReceiveTransactionDetails;
};
type IncompleteSparkLightningSendTransaction = BaseTransaction & {
  type: 'SPARK_LIGHTNING';
  direction: 'SEND';
  state: 'DRAFT' | 'PENDING' | 'FAILED';
  details: IncompleteSparkLightningSendTransactionDetails;
};
type CompletedSparkLightningSendTransaction = BaseTransaction & {
  type: 'SPARK_LIGHTNING';
  direction: 'SEND';
  state: 'COMPLETED';
  details: CompletedSparkLightningSendTransactionDetails;
};

/** Union of all transaction type/direction/state variants. */
type TransactionByType =
  | CashuTokenSendTransaction
  | CashuTokenReceiveTransaction
  | IncompleteCashuLightningSendTransaction
  | CompletedCashuLightningSendTransaction
  | CashuLightningReceiveTransaction
  | IncompleteSparkLightningReceiveTransaction
  | CompletedSparkLightningReceiveTransaction
  | IncompleteSparkLightningSendTransaction
  | CompletedSparkLightningSendTransaction;

export type Transaction =
  | (TransactionByType & {
      purpose: 'TRANSFER';
      details: { transferId: string };
    })
  | (TransactionByType & { purpose: 'PAYMENT' | 'BUY_CASHAPP' });

/** Cursor pagination (state-sorted: PENDING first). */
export type TransactionCursor = {
  stateSortOrder: number;
  createdAt: string;
  id: string;
};
