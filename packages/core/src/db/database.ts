import type { createClient } from '@supabase/supabase-js';
import type { MergeDeep } from 'type-fest';
import type { Database as DatabaseGenerated } from './database-generated.types';
import {
  type CashuAccountDetailsDbData,
  CashuAccountDetailsDbDataSchema,
} from './json-models/cashu-account-details-db-data';
import {
  type SparkAccountDetailsDbData,
  SparkAccountDetailsDbDataSchema,
} from './json-models/spark-account-details-db-data';

// These row types are defined from DatabaseGenerated (before Database) to
// break a circular reference: result types -> row types -> Database -> result types.
// The MergeDeep below only overrides Functions/CompositeTypes, not Tables,
// so these are identical to Database row types.
export type AgicashDbUser =
  DatabaseGenerated['wallet']['Tables']['users']['Row'];
export type AgicashDbAccount =
  DatabaseGenerated['wallet']['Tables']['accounts']['Row'];
export type AgicashDbCashuProof =
  DatabaseGenerated['wallet']['Tables']['cashu_proofs']['Row'];
/**
 * Account joined with cashu_proofs. For non-cashu accounts, cashu_proofs is an empty array and can be ignored.
 */
export type AgicashDbAccountWithProofs = AgicashDbAccount & {
  cashu_proofs: AgicashDbCashuProof[];
};
export type AgicashDbCashuReceiveQuote =
  DatabaseGenerated['wallet']['Tables']['cashu_receive_quotes']['Row'];
export type AgicashDbCashuReceiveSwap =
  DatabaseGenerated['wallet']['Tables']['cashu_receive_swaps']['Row'];
export type AgicashDbCashuSendQuote =
  DatabaseGenerated['wallet']['Tables']['cashu_send_quotes']['Row'];
export type AgicashDbCashuSendSwap =
  DatabaseGenerated['wallet']['Tables']['cashu_send_swaps']['Row'];
export type AgicashDbTransaction =
  DatabaseGenerated['wallet']['Tables']['transactions']['Row'];
export type AgicashDbContact =
  DatabaseGenerated['wallet']['Tables']['contacts']['Row'];
export type AgicashDbSparkReceiveQuote =
  DatabaseGenerated['wallet']['Tables']['spark_receive_quotes']['Row'];
export type AgicashDbSparkSendQuote =
  DatabaseGenerated['wallet']['Tables']['spark_send_quotes']['Row'];

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

type CreateCashuReceiveSwapResult = {
  swap: AgicashDbCashuReceiveSwap;
  account: AgicashDbAccountWithProofs;
};

type CompleteCashuReceiveSwapResult = {
  swap: AgicashDbCashuReceiveSwap;
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
      Functions: {
        upsert_user_with_accounts: {
          Args: {
            p_email: string | null;
          };
          Returns: UpsertUserWithAccountsResult;
        };
        process_cashu_receive_quote_payment: {
          Returns: CashuReceiveQuotePaymentResult;
        };
        complete_cashu_receive_quote: {
          Returns: CompleteCashuReceiveQuoteResult;
        };
        create_cashu_receive_swap: {
          Returns: CreateCashuReceiveSwapResult;
        };
        complete_cashu_receive_swap: {
          Returns: CompleteCashuReceiveSwapResult;
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
            p_cursor_state_sort_order?: number | null;
            p_cursor_created_at?: string | null;
            p_cursor_id?: string | null;
          };
        };
        create_spark_receive_quote: {
          Args: {
            p_receiver_identity_pubkey: string | null;
          };
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
        create_cashu_receive_swap_result: CreateCashuReceiveSwapResult;
        complete_cashu_receive_swap_result: CompleteCashuReceiveSwapResult;
        create_cashu_send_swap_result: CreateCashuSendSwapResult;
        commit_proofs_to_send_result: CommitProofsToSendResult;
        complete_cashu_send_swap_result: CompleteCashuSendSwapResult;
        fail_cashu_send_swap_result: FailCashuSendSwapResult;
      };
    };
  }
>;

export type AgicashDb = ReturnType<typeof createClient<Database>>;

/**
 * Checks if the account is a cashu account.
 * @param data Database account data.
 * @returns True if the account is a cashu account, false otherwise.
 * @throws If the account is of type 'cashu' but the details are not valid.
 */
export function isCashuAccount(
  data: AgicashDbAccount,
): data is AgicashDbAccount & {
  type: 'cashu';
  details: CashuAccountDetailsDbData;
} {
  if (data.type !== 'cashu') {
    return false;
  }

  CashuAccountDetailsDbDataSchema.parse(data.details);
  return true;
}

/**
 * Checks if the account is a spark account.
 * @param data Database account data.
 * @returns True if the account is a spark account, false otherwise.
 * @throws If the account is of type 'spark' but the details are not valid.
 */
export function isSparkAccount(
  data: AgicashDbAccount,
): data is AgicashDbAccount & {
  type: 'spark';
  details: SparkAccountDetailsDbData;
} {
  if (data.type !== 'spark') {
    return false;
  }

  SparkAccountDetailsDbDataSchema.parse(data.details);
  return true;
}
