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

/** Whether the transaction sends money out or receives it in. */
export type TransactionDirection = 'SEND' | 'RECEIVE';

/** Protocol + rail of the transaction. */
export type TransactionType =
  | 'CASHU_LIGHTNING'
  | 'CASHU_TOKEN'
  | 'SPARK_LIGHTNING';

/**
 * State of the transaction.
 * - DRAFT: The transaction is drafted but might never be initiated and thus completed.
 * - PENDING: The transaction was initiated and is being processed.
 * - COMPLETED: The transaction has been completed. At this point the sender cannot reverse the transaction.
 * - FAILED: The transaction has failed.
 * - REVERSED: The transaction was reversed and money was returned to the account.
 */
export type TransactionState =
  | 'DRAFT'
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REVERSED';

/** Why the transaction exists: an organic payment, a Cash App buy, or an internal transfer leg. */
export type TransactionPurpose = 'PAYMENT' | 'BUY_CASHAPP' | 'TRANSFER';

// --- BaseTransaction -------------------------------------------------------

/** Fields shared by every transaction variant. */
export type BaseTransaction = {
  /** UUID of the transaction. */
  id: string;
  /** UUID of the user that the transaction belongs to. */
  userId: string;
  /** Direction of the transaction. */
  direction: TransactionDirection;
  /** Type of the transaction. */
  type: TransactionType;
  /**
   * State of the transaction.
   * Transaction states are:
   * - DRAFT: The transaction is drafted but might never be initiated and thus completed.
   * - PENDING: The transaction was initiated and is being processed.
   * - COMPLETED: The transaction has been completed. At this point the sender cannot reverse the transaction.
   * - FAILED: The transaction has failed.
   * - REVERSED: The transaction was reversed and money was returned to the account.
   */
  state: TransactionState;
  /**
   * UUID of the account that the transaction was sent from or received to.
   * For SEND transactions, it is the account that the transaction was sent from.
   * For RECEIVE transactions, it is the account that the transaction was received to.
   * Null when the account has since been deleted; the denormalized
   * accountName/Type/Purpose fields still describe the account at the time
   * of the transaction.
   */
  accountId: string | null;
  /** Name of the account at the time this transaction was created. */
  accountName: string;
  /** Type of the account at the time this transaction was created. */
  accountType: AccountType;
  /** Purpose of the account at the time this transaction was created. */
  accountPurpose: AccountPurpose;
  /** Amount of the transaction. */
  amount: Money;
  /** Transaction details. */
  details: TransactionDetails;
  /** UUID of the transaction that is reversed by this transaction. */
  reversedTransactionId?: string | null;
  /**
   * The purpose of this transaction (e.g. a Cash App buy or an internal transfer).
   * Defaults to 'PAYMENT' for organic send/receive transactions.
   */
  purpose: TransactionPurpose;
  /**
   * Whether or not the transaction has been acknowledged by the user.
   * - `null`: There is nothing to acknowledge.
   * - `pending`: The transaction has entered a state where the user should acknowledge it.
   * - `acknowledged`: The transaction has been acknowledged by the user.
   */
  acknowledgmentStatus: 'pending' | 'acknowledged' | null;
  /** Date and time the transaction was created in ISO 8601 format. */
  createdAt: string;
  /** Date and time the transaction was set to pending in ISO 8601 format. */
  pendingAt?: string | null;
  /** Date and time the transaction was completed in ISO 8601 format. */
  completedAt?: string | null;
  /** Date and time the transaction failed in ISO 8601 format. */
  failedAt?: string | null;
  /** Date and time the transaction was reversed in ISO 8601 format. */
  reversedAt?: string | null;
  /**
   * Version of the transaction.
   * Incremented on every update.
   */
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

/**
 * A wallet transaction — the public history item. The union of the 9
 * type/direction/state variants intersected with a purpose discriminator:
 * `purpose: 'TRANSFER'` injects `details: { transferId }` (the leg of an internal
 * transfer), otherwise `purpose: 'PAYMENT' | 'BUY_CASHAPP'`.
 */
export type Transaction =
  | (TransactionByType & {
      purpose: 'TRANSFER';
      details: { transferId: string };
    })
  | (TransactionByType & { purpose: 'PAYMENT' | 'BUY_CASHAPP' });

/**
 * Opaque pagination cursor for {@link TransactionsDomain.list}. Encodes the
 * state-sort key (PENDING first) plus `createdAt`/`id` for stable ordering.
 */
export type TransactionCursor = {
  /** Sort rank derived from transaction state (PENDING sorts first). */
  stateSortOrder: number;
  /** ISO 8601 creation time of the boundary row. */
  createdAt: string;
  /** UUID of the boundary row (tie-breaker). */
  id: string;
};
