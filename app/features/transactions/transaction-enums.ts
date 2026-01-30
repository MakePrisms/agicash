import { z } from 'zod';

export const TransactionDirectionSchema = z.enum(['SEND', 'RECEIVE']);

export type TransactionDirection = z.infer<typeof TransactionDirectionSchema>;

export const TransactionTypeSchema = z.enum([
  'CASHU_LIGHTNING',
  'CASHU_TOKEN',
  'SPARK_LIGHTNING',
]);

export type TransactionType = z.infer<typeof TransactionTypeSchema>;

/**
 * State of the transaction.
 * - DRAFT: The transaction is drafted but might never be initiated and thus completed.
 * - PENDING: The transaction was initiated and is being processed.
 * - COMPLETED: The transaction has been completed. At this point the sender cannot reverse the transaction.
 * - FAILED: The transaction has failed.
 * - REVERSED: The transaction was reversed and money was returned to the account.
 */
export const TransactionStateSchema = z.enum([
  'DRAFT',
  'PENDING',
  'COMPLETED',
  'FAILED',
  'REVERSED',
]);

export type TransactionState = z.infer<typeof TransactionStateSchema>;
