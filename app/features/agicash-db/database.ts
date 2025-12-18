import type { createClient } from '@supabase/supabase-js';
import type {
  Database as DatabaseGenerated,
  Json,
} from 'supabase/database.types';
import type { MergeDeep } from 'type-fest';
import type { Currency, CurrencyUnit } from '~/lib/money';
import type { AccountType } from '../accounts/account';
import type { SparkReceiveQuote } from '../receive/spark-receive-quote';
import type { CashuSendSwap } from '../send/cashu-send-swap';
import type { Transaction } from '../transactions/transaction';

type UpsertUserWithAccountsResult = {
  user: AgicashDbUser;
  accounts: AgicashDbAccountWithProofs[];
};

type CashuReceiveQuotePaymentResult = {
  quote: AgicashDbCashuReceiveQuote;
  account: AgicashDbAccountWithProofs;
};

type CompleteCashuReceiveQuoteResult = {
  quote: AgicashDbCashuReceiveQuote;
  account: AgicashDbAccountWithProofs;
  added_proofs: AgicashDbCashuProof[];
};

type CreateCashuSendQuoteResult = {
  quote: AgicashDbCashuSendQuote;
  account: AgicashDbAccountWithProofs;
  reserved_proofs: AgicashDbCashuProof[];
};

type MarkCashuSendQuoteAsPendingResult = {
  quote: AgicashDbCashuSendQuote;
  proofs: AgicashDbCashuProof[];
};

type CompleteCashuSendQuoteResult = {
  quote: AgicashDbCashuSendQuote;
  account: AgicashDbAccountWithProofs;
  spent_proofs: AgicashDbCashuProof[];
  change_proofs: AgicashDbCashuProof[];
};

type ExpireCashuSendQuoteResult = {
  quote: AgicashDbCashuSendQuote;
  account: AgicashDbAccountWithProofs;
  released_proofs: AgicashDbCashuProof[];
};

type FailCashuSendQuoteResult = {
  quote: AgicashDbCashuSendQuote;
  account: AgicashDbAccountWithProofs;
  released_proofs: AgicashDbCashuProof[];
};

type CreateCashuTokenSwapResult = {
  swap: AgicashDbCashuTokenSwap;
  account: AgicashDbAccountWithProofs;
};

type CompleteCashuTokenSwapResult = {
  swap: AgicashDbCashuTokenSwap;
  account: AgicashDbAccountWithProofs;
  added_proofs: AgicashDbCashuProof[];
};

type CreateCashuSendSwapResult = {
  swap: AgicashDbCashuSendSwap;
  account: AgicashDbAccountWithProofs;
  reserved_proofs: AgicashDbCashuProof[];
};

type CommitProofsToSendResult = {
  swap: AgicashDbCashuSendSwap;
  account: AgicashDbAccountWithProofs;
  spent_proofs: AgicashDbCashuProof[];
  reserved_proofs: AgicashDbCashuProof[];
  change_proofs: AgicashDbCashuProof[];
};

type CompleteCashuSendSwapResult =
  | {
      result: 'COMPLETED';
      swap: AgicashDbCashuSendSwap;
      account: AgicashDbAccountWithProofs;
      spent_proofs: AgicashDbCashuProof[];
      failure_reason: null;
    }
  | {
      result: 'FAILED';
      swap: AgicashDbCashuSendSwap;
      account: null;
      spent_proofs: null;
      failure_reason: string;
    };

type FailCashuSendSwapResult = {
  swap: AgicashDbCashuSendSwap;
  account: AgicashDbAccountWithProofs;
  released_proofs: AgicashDbCashuProof[];
};

// Use when you need to fix/improve generated types
// See https://supabase.com/docs/guides/api/rest/generating-types#helper-types-for-tables-and-joins
export type Database = MergeDeep<
  DatabaseGenerated,
  {
    wallet: {
      Tables: {
        users: {
          Row: {
            default_currency: Currency;
          };
          Insert: {
            default_currency?: Currency;
          };
          Update: {
            default_currency?: Currency;
          };
        };
        accounts: {
          Row: {
            currency: Currency;
            type: AccountType;
          };
          Insert: {
            currency: Currency;
            type: AccountType;
          };
          Update: {
            currency?: Currency;
            type?: AccountType;
          };
        };
        cashu_receive_quotes: {
          Row: {
            currency: Currency;
            unit: CurrencyUnit;
          };
          Insert: {
            currency: Currency;
            unit: CurrencyUnit;
          };
          Update: {
            currency?: Currency;
            unit?: CurrencyUnit;
          };
        };
        cashu_token_swaps: {
          Row: {
            currency: Currency;
            unit: CurrencyUnit;
          };
          Insert: {
            currency: Currency;
            unit: CurrencyUnit;
          };
          Update: {
            currency?: Currency;
            unit?: CurrencyUnit;
          };
        };
        cashu_send_quotes: {
          Row: {
            currency: Currency;
            unit: CurrencyUnit;
            currency_requested: Currency;
          };
          Insert: {
            currency: Currency;
            unit: CurrencyUnit;
            currency_requested: Currency;
          };
          Update: {
            currency?: Currency;
            unit?: CurrencyUnit;
            currency_requested?: Currency;
          };
        };
        cashu_send_swaps: {
          Row: {
            state: CashuSendSwap['state'];
            currency: Currency;
            unit: CurrencyUnit;
          };
          Insert: {
            state: CashuSendSwap['state'];
            currency: Currency;
            unit: CurrencyUnit;
          };
          Update: {
            state?: CashuSendSwap['state'];
            currency?: Currency;
            unit?: CurrencyUnit;
          };
        };
        spark_receive_quotes: {
          Row: {
            type: SparkReceiveQuote['type'];
            state: SparkReceiveQuote['state'];
            currency: Currency;
            unit: CurrencyUnit;
          };
          Insert: {
            type: SparkReceiveQuote['type'];
            state?: SparkReceiveQuote['state'];
            currency: Currency;
            unit: CurrencyUnit;
          };
          Update: {
            type?: SparkReceiveQuote['type'];
            state?: SparkReceiveQuote['state'];
            currency?: Currency;
            unit?: CurrencyUnit;
          };
        };
        spark_send_quotes: {
          Row: {
            currency: Currency;
            unit: CurrencyUnit;
          };
        };
        transactions: {
          Row: {
            currency: Currency;
            unit: CurrencyUnit;
            reversed_transaction_id: string | null;
            direction: Transaction['direction'];
            type: Transaction['type'];
            state: Transaction['state'];
            acknowledgment_status: Transaction['acknowledgmentStatus'];
            transaction_details: { [key: string]: Json | undefined } | null;
          };
        };
      };
      Functions: {
        upsert_user_with_accounts: {
          Args: {
            p_email: string | null;
          };
          Returns: UpsertUserWithAccountsResult;
        };
        create_cashu_receive_quote: {
          Returns: AgicashDbCashuReceiveQuote;
        };
        process_cashu_receive_quote_payment: {
          Returns: CashuReceiveQuotePaymentResult;
        };
        complete_cashu_receive_quote: {
          Returns: CompleteCashuReceiveQuoteResult;
        };
        create_cashu_token_swap: {
          Returns: CreateCashuTokenSwapResult;
        };
        complete_cashu_token_swap: {
          Returns: CompleteCashuTokenSwapResult;
        };
        create_cashu_send_quote: {
          Returns: CreateCashuSendQuoteResult;
        };
        mark_cashu_send_quote_as_pending: {
          Returns: MarkCashuSendQuoteAsPendingResult;
        };
        complete_cashu_send_quote: {
          Returns: CompleteCashuSendQuoteResult;
        };
        expire_cashu_send_quote: {
          Returns: ExpireCashuSendQuoteResult;
        };
        fail_cashu_send_quote: {
          Returns: FailCashuSendQuoteResult;
        };
        fail_cashu_token_swap: {
          Returns: AgicashDbCashuTokenSwap;
        };
        create_cashu_send_swap: {
          Returns: CreateCashuSendSwapResult;
        };
        commit_proofs_to_send: {
          Returns: CommitProofsToSendResult;
        };
        complete_cashu_send_swap: {
          Returns: CompleteCashuSendSwapResult;
        };
        fail_cashu_send_swap: {
          Returns: FailCashuSendSwapResult;
        };
        list_transactions: {
          Args: {
            p_user_id: string;
            p_cursor_state_sort_order?: number | null;
            p_cursor_created_at?: string | null;
            p_cursor_id?: string | null;
            p_page_size?: number;
          };
          Returns: AgicashDbTransaction[];
        };
        create_spark_receive_quote: {
          Args: {
            p_currency: Currency;
            p_unit: CurrencyUnit;
            p_receiver_identity_pubkey: string | null;
          };
          Returns: AgicashDbSparkReceiveQuote;
        };
        complete_spark_receive_quote: {
          Returns: AgicashDbSparkReceiveQuote;
        };
        expire_spark_receive_quote: {
          Returns: AgicashDbSparkReceiveQuote;
        };
        create_spark_send_quote: {
          Returns: AgicashDbSparkSendQuote;
        };
        mark_spark_send_quote_as_pending: {
          Returns: AgicashDbSparkSendQuote;
        };
        complete_spark_send_quote: {
          Returns: AgicashDbSparkSendQuote;
        };
        fail_spark_send_quote: {
          Returns: AgicashDbSparkSendQuote;
        };
      };
      CompositeTypes: {
        cashu_receive_quote_payment_result: CashuReceiveQuotePaymentResult;
        complete_cashu_receive_quote_result: CompleteCashuReceiveQuoteResult;
        create_cashu_send_quote_result: CreateCashuSendQuoteResult;
        mark_cashu_send_quote_as_pending_result: MarkCashuSendQuoteAsPendingResult;
        complete_cashu_send_quote_result: CompleteCashuSendQuoteResult;
        expire_cashu_send_quote_result: ExpireCashuSendQuoteResult;
        fail_cashu_send_quote_result: FailCashuSendQuoteResult;
        create_cashu_token_swap_result: CreateCashuTokenSwapResult;
        complete_cashu_token_swap_result: CompleteCashuTokenSwapResult;
        create_cashu_send_swap_result: CreateCashuSendSwapResult;
        commit_proofs_to_send_result: CommitProofsToSendResult;
        complete_cashu_send_swap_result: CompleteCashuSendSwapResult;
        fail_cashu_send_swap_result: FailCashuSendSwapResult;
      };
    };
  }
>;

export type AgicashDb = ReturnType<typeof createClient<Database>>;

export type AgicashDbUser = Database['wallet']['Tables']['users']['Row'];
export type AgicashDbAccount = Database['wallet']['Tables']['accounts']['Row'];
export type AgicashDbCashuProof =
  Database['wallet']['Tables']['cashu_proofs']['Row'];
/**
 * Account joined with cashu_proofs. For non-cashu accounts, cashu_proofs is an empty array and can be ignored.
 */
export type AgicashDbAccountWithProofs = AgicashDbAccount & {
  cashu_proofs: AgicashDbCashuProof[];
};
export type AgicashDbCashuReceiveQuote =
  Database['wallet']['Tables']['cashu_receive_quotes']['Row'];
export type AgicashDbCashuTokenSwap =
  Database['wallet']['Tables']['cashu_token_swaps']['Row'];
export type AgicashDbCashuSendQuote =
  Database['wallet']['Tables']['cashu_send_quotes']['Row'];
export type AgicashDbTransaction =
  Database['wallet']['Tables']['transactions']['Row'];
export type AgicashDbContact = Database['wallet']['Tables']['contacts']['Row'];
export type AgicashDbCashuSendSwap =
  Database['wallet']['Tables']['cashu_send_swaps']['Row'];
export type AgicashDbSparkReceiveQuote =
  Database['wallet']['Tables']['spark_receive_quotes']['Row'];
export type AgicashDbSparkSendQuote =
  Database['wallet']['Tables']['spark_send_quotes']['Row'];
