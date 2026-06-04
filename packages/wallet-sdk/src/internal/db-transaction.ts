/**
 * Internal `wallet.transactions` DB row type — Slice 4 (transactions).
 *
 * Lifted from master `agicash-db/database.ts#AgicashDbTransaction`
 * (`Database['wallet']['Tables']['transactions']['Row']`, generated in
 * `supabase/database.types.ts`). Hand-written here (as in `db-account.ts` / the quote repos)
 * so the SDK can type the otherwise-untyped Supabase reads without pulling the full generated
 * `Database` types (lifted in a later slice). The `list_transactions` RPC returns this same
 * row shape.
 *
 * `encrypted_transaction_details` is ENCRYPTED ciphertext (the per-variant `*DbData` jsonb,
 * decrypted + parsed by {@link TransactionRepository.toTransaction}); `transaction_details` is
 * the small unencrypted jsonb the parsers also read (`paymentHash` / `sparkId` / `transferId`).
 *
 * @module
 */
import type { Json } from '@agicash/db-types';
import type { AccountPurpose, AccountType } from '../types/account';
import type { Currency } from '../types/money';
import type {
  TransactionDirection,
  TransactionState,
  TransactionType,
} from '../types/transaction';

/** Small unencrypted `transactions.transaction_details` jsonb the parsers read (master `Json`). */
type AgicashDbTransactionDetailsJson = Json | null;

/**
 * A row of the `wallet.transactions` table (and the shape returned by the `list_transactions`
 * RPC). Verbatim columns from the generated `transactions` Row.
 */
export type AgicashDbTransaction = {
  /** UUID primary key. */
  id: string;
  /** Owning user id. */
  user_id: string;
  /** Account the transaction debited/credited; null if that account was since deleted. */
  account_id: string | null;
  /** Denormalized account name at transaction time. */
  account_name: string;
  /** Denormalized account type at transaction time. */
  account_type: AccountType;
  /** Denormalized account purpose at transaction time. */
  account_purpose: AccountPurpose;
  /** Account currency. */
  currency: Currency;
  /** SEND or RECEIVE. */
  direction: TransactionDirection;
  /** Protocol + rail. */
  type: TransactionType;
  /** Lifecycle state. */
  state: TransactionState;
  /** Encrypted per-variant details jsonb (decrypted + parsed in `toTransaction`). */
  encrypted_transaction_details: string;
  /** Small unencrypted details jsonb (paymentHash / sparkId / transferId). */
  transaction_details: AgicashDbTransactionDetailsJson;
  /** `'PAYMENT' | 'BUY_CASHAPP' | 'TRANSFER'`. */
  purpose: TransactionPurposeColumn;
  /** Tri-state ack column. */
  acknowledgment_status: 'pending' | 'acknowledged' | null;
  /** UUID of the transaction this one reverses, if any. */
  reversed_transaction_id: string | null;
  /** State-derived sort key (PENDING sorts first); computed DB-side. */
  state_sort_order: number | null;
  /** Row creation time, ISO 8601. */
  created_at: string;
  /** When set to pending, ISO 8601. */
  pending_at: string | null;
  /** When completed, ISO 8601. */
  completed_at: string | null;
  /** When failed, ISO 8601. */
  failed_at: string | null;
  /** When reversed, ISO 8601. */
  reversed_at: string | null;
  /** Row version (optimistic lock). */
  version: number;
};

/** The `transactions.purpose` enum column. */
type TransactionPurposeColumn = 'PAYMENT' | 'BUY_CASHAPP' | 'TRANSFER';
