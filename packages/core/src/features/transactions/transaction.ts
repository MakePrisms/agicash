import { z } from 'zod';
import { Money } from '../../lib/money';
import { CashuLightningReceiveTransactionDetailsSchema } from './transaction-details/cashu-lightning-receive-transaction-details';
import {
  CompletedCashuLightningSendTransactionDetailsSchema,
  IncompleteCashuLightningSendTransactionDetailsSchema,
} from './transaction-details/cashu-lightning-send-transaction-details';
import { CashuTokenReceiveTransactionDetailsSchema } from './transaction-details/cashu-token-receive-transaction-details';
import { CashuTokenSendTransactionDetailsSchema } from './transaction-details/cashu-token-send-transaction-details';
import {
  CompletedSparkLightningReceiveTransactionDetailsSchema,
  SparkLightningReceiveTransactionDetailsSchema,
} from './transaction-details/spark-lightning-receive-transaction-details';
import {
  CompletedSparkLightningSendTransactionDetailsSchema,
  IncompleteSparkLightningSendTransactionDetailsSchema,
} from './transaction-details/spark-lightning-send-transaction-details';
import { TransactionDetailsSchema } from './transaction-details/transaction-details-types';
import {
  TransactionDirectionSchema,
  TransactionStateSchema,
  TransactionTypeSchema,
} from './transaction-enums';

/**
 * Base schema for all transaction types.
 */
export const BaseTransactionSchema = z.object({
  /**
   * UUID of the transaction.
   */
  id: z.string(),
  /**
   * UUID of the user that the transaction belongs to.
   */
  userId: z.string(),
  /**
   * Direction of the transaction.
   */
  direction: TransactionDirectionSchema,
  /**
   * Type of the transaction.
   */
  type: TransactionTypeSchema,
  /**
   * State of the transaction.
   * Transaction states are:
   * - DRAFT: The transaction is drafted but might never be initiated and thus completed.
   * - PENDING: The transaction was initiated and is being processed.
   * - COMPLETED: The transaction has been completed. At this point the sender cannot reverse the transaction.
   * - FAILED: The transaction has failed.
   * - REVERSED: The transaction was reversed and money was returned to the account.
   */
  state: TransactionStateSchema,
  /**
   * UUID of the account that the transaction was sent from or received to.
   * For SEND transactions, it is the account that the transaction was sent from.
   * For RECEIVE transactions, it is the account that the transaction was received to.
   */
  accountId: z.string(),
  /**
   * Amount of the transaction.
   */
  amount: z.instanceof(Money),
  /**
   * Transaction details.
   */
  details: TransactionDetailsSchema,
  /**
   * UUID of the transaction that is reversed by this transaction.
   */
  reversedTransactionId: z.string().nullish(),
  /**
   * Whether or not the transaction has been acknowledged by the user.
   * - `null`: There is nothing to acknowledge.
   * - `pending`: The transaction has entered a state where the user should acknowledge it.
   * - `acknowledged`: The transaction has been acknowledged by the user.
   */
  acknowledgmentStatus: z.enum(['pending', 'acknowledged']).nullable(),
  /**
   * Date and time the transaction was created in ISO 8601 format.
   */
  createdAt: z.string(),
  /**
   * Date and time the transaction was set to pending in ISO 8601 format.
   */
  pendingAt: z.string().nullish(),
  /**
   * Date and time the transaction was completed in ISO 8601 format.
   */
  completedAt: z.string().nullish(),
  /**
   * Date and time the transaction failed in ISO 8601 format.
   */
  failedAt: z.string().nullish(),
  /**
   * Date and time the transaction was reversed in ISO 8601 format.
   */
  reversedAt: z.string().nullish(),
});

const CashuTokenSendTransactionSchema = BaseTransactionSchema.extend({
  type: z.literal('CASHU_TOKEN'),
  direction: z.literal('SEND'),
  details: CashuTokenSendTransactionDetailsSchema,
});

const CashuTokenReceiveTransactionSchema = BaseTransactionSchema.extend({
  type: z.literal('CASHU_TOKEN'),
  direction: z.literal('RECEIVE'),
  details: CashuTokenReceiveTransactionDetailsSchema,
});

const IncompleteCashuLightningSendTransactionSchema =
  BaseTransactionSchema.extend({
    type: z.literal('CASHU_LIGHTNING'),
    direction: z.literal('SEND'),
    state: z.enum(['PENDING', 'FAILED']),
    details: IncompleteCashuLightningSendTransactionDetailsSchema,
  });

const CompletedCashuLightningSendTransactionSchema =
  BaseTransactionSchema.extend({
    type: z.literal('CASHU_LIGHTNING'),
    direction: z.literal('SEND'),
    state: z.literal('COMPLETED'),
    details: CompletedCashuLightningSendTransactionDetailsSchema,
  });

const CashuLightningReceiveTransactionSchema = BaseTransactionSchema.extend({
  type: z.literal('CASHU_LIGHTNING'),
  direction: z.literal('RECEIVE'),
  details: CashuLightningReceiveTransactionDetailsSchema,
});

const IncompleteSparkLightningReceiveTransactionSchema =
  BaseTransactionSchema.extend({
    type: z.literal('SPARK_LIGHTNING'),
    direction: z.literal('RECEIVE'),
    state: z.enum(['DRAFT', 'PENDING', 'FAILED']),
    details: SparkLightningReceiveTransactionDetailsSchema,
  });

const CompletedSparkLightningReceiveTransactionSchema =
  BaseTransactionSchema.extend({
    type: z.literal('SPARK_LIGHTNING'),
    direction: z.literal('RECEIVE'),
    state: z.literal('COMPLETED'),
    details: CompletedSparkLightningReceiveTransactionDetailsSchema,
  });

const IncompleteSparkLightningSendTransactionSchema =
  BaseTransactionSchema.extend({
    type: z.literal('SPARK_LIGHTNING'),
    direction: z.literal('SEND'),
    state: z.enum(['DRAFT', 'PENDING', 'FAILED']),
    details: IncompleteSparkLightningSendTransactionDetailsSchema,
  });

const CompletedSparkLightningSendTransactionSchema =
  BaseTransactionSchema.extend({
    type: z.literal('SPARK_LIGHTNING'),
    direction: z.literal('SEND'),
    state: z.literal('COMPLETED'),
    details: CompletedSparkLightningSendTransactionDetailsSchema,
  });

/**
 * Schema for all transaction types.
 */
export const TransactionSchema = z.union([
  CashuTokenSendTransactionSchema,
  CashuTokenReceiveTransactionSchema,
  IncompleteCashuLightningSendTransactionSchema,
  CompletedCashuLightningSendTransactionSchema,
  CashuLightningReceiveTransactionSchema,
  IncompleteSparkLightningReceiveTransactionSchema,
  CompletedSparkLightningReceiveTransactionSchema,
  IncompleteSparkLightningSendTransactionSchema,
  CompletedSparkLightningSendTransactionSchema,
]);

export type Transaction = z.infer<typeof TransactionSchema>;
