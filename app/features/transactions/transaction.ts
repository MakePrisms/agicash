import { z } from 'zod';
import { Money } from '~/lib/money';

/**
 * Schema for sending cashu proofs from an account.
 */
export const CashuTokenSendTransactionDetailsSchema = z.object({
  /** This is the sum of `amountToReceive` and `totalFees`, and is the amount deducted from the account. */
  amountSpent: z.instanceof(Money),
  /** This is the amount the recipient will receive after fees have been paid. */
  amountToReceive: z.instanceof(Money),
  /** The fee incurred when creating sendable proofs. */
  cashuSendFee: z.instanceof(Money),
  /** The fee that we include in the token for the receiver to claim exactly `amountToReceive`. */
  cashuReceiveFee: z.instanceof(Money),
  /** The total fees for the transaction. Sum of cashuSendFee and cashuReceiveFee. */
  totalFees: z.instanceof(Money),
});

export type CashuTokenSendTransactionDetails = z.infer<
  typeof CashuTokenSendTransactionDetailsSchema
>;

/**
 * Schema for receiving cashu proofs to an account.
 */
export const CashuTokenReceiveTransactionDetailsSchema = z.object({
  /** This is the token amount minus the cashuReceiveFee, and is the amount added to the account. */
  amountReceived: z.instanceof(Money),
  /** The amount of the token being claimed. */
  tokenAmount: z.instanceof(Money),
  /** The fee that will be incurred when swapping proofs to the account. */
  cashuReceiveFee: z.instanceof(Money),
  /**
   * The fee reserved for the lightning payment to melt the proofs to the account.
   * This is defined when the token is melted from the source mint into this receiving account.
   * This will be undefined when receiving proofs to the source account which just requires a swap.
   */
  lightningFeeReserve: z.instanceof(Money).optional(),
  /** The fee that the mint charged to mint the ecash. */
  mintingFee: z.instanceof(Money).optional(),
  /** The total fees for the transaction. This is the sum of `cashuReceiveFee`, `lightningFeeReserve`, and `mintingFee`. */
  totalFees: z.instanceof(Money),
});

export type CashuTokenReceiveTransactionDetails = z.infer<
  typeof CashuTokenReceiveTransactionDetailsSchema
>;

/**
 * Schema for Agicash contact destination.
 */
export const AgicashContactDestinationSchema = z.object({
  sendType: z.literal('AGICASH_CONTACT'),
  /** The ID of the contact that the invoice was fetched from. */
  contactId: z.string(),
});

/**
 * Schema for Lightning address destination.
 */
export const LnAddressDestinationSchema = z.object({
  sendType: z.literal('LN_ADDRESS'),
  /** The lightning address that the invoice was fetched from. */
  lnAddress: z.string(),
});

/**
 * Schema for additional details related to the transaction destination.
 */
export const DestinationDetailsSchema = z.discriminatedUnion('sendType', [
  AgicashContactDestinationSchema,
  LnAddressDestinationSchema,
]);

export type DestinationDetails = z.infer<typeof DestinationDetailsSchema>;

/**
 * Base schema for cashu lightning send transaction details.
 */
const BaseCashuLightningSendTransactionDetailsSchema = z.object({
  /**
   * The sum of all proofs used as inputs to the cashu melt operation
   * converted from a number to Money in the currency of the account.
   * These proofs are reserved for the pending send quote.
   * When the transaction is completed, change will be returned to the account.
   */
  amountReserved: z.instanceof(Money),
  /**
   * Amount that the receiver will receive.
   *
   * This is the amount requested in the currency of the account we are sending from.
   * If the currency of the account we are sending from is not BTC, the mint will do
   * the conversion using their exchange rate at the time of quote creation.
   */
  amountToReceive: z.instanceof(Money),
  /**
   * The amount reserved upfront to cover the maximum potential Lightning Network fees.
   *
   * If the actual Lightning fee ends up being lower than this reserve,
   * the difference is returned as change to the user.
   */
  lightningFeeReserve: z.instanceof(Money),
  /** The fee incurred to spend the proofs in the cashu melt operation */
  cashuSendFee: z.instanceof(Money),
  /** The bolt11 payment request. */
  paymentRequest: z.string(),
  /**
   * Additional details related to the transaction.
   *
   * This will be undefined if the send is directly paying a bolt11.
   */
  destinationDetails: DestinationDetailsSchema.optional(),
});

/**
 * Schema for a cashu lightning send transaction that is not yet completed.
 */
export const IncompleteCashuLightningSendTransactionDetailsSchema =
  BaseCashuLightningSendTransactionDetailsSchema;

export type IncompleteCashuLightningSendTransactionDetails = z.infer<
  typeof IncompleteCashuLightningSendTransactionDetailsSchema
>;

/**
 * Schema for a cashu lightning send transaction that is completed.
 */
export const CompletedCashuLightningSendTransactionDetailsSchema =
  BaseCashuLightningSendTransactionDetailsSchema.extend({
    /** This is the sum of `amountToReceive` and `totalFees`. This is the amount deducted from the account. */
    amountSpent: z.instanceof(Money),
    /**
     * The preimage of the lightning payment.
     * If the lightning payment is settled internally in the mint, this will be an empty string or '0x0000000000000000000000000000000000000000000000000000000000000000'
     */
    preimage: z.string(),
    /**
     * The actual Lightning Network fee that was charged after the transaction completed.
     * This may be less than the `lightningFeeReserve` if the payment was cheaper than expected.
     *
     * The difference between the `lightningFeeReserve` and the `lightningFee` is returned as change to the user.
     */
    lightningFee: z.instanceof(Money),
    /** The actual fees for the transaction. Sum of lightningFee and cashuSendFee. */
    totalFees: z.instanceof(Money),
  });

export type CompletedCashuLightningSendTransactionDetails = z.infer<
  typeof CompletedCashuLightningSendTransactionDetailsSchema
>;

/**
 * Schema for receiving cashu lightning payments to an account.
 */
export const CashuLightningReceiveTransactionDetailsSchema = z.object({
  /**
   * The amount of the bolt11 payment request.
   * This amount is added to the account.
   */
  amountReceived: z.instanceof(Money),
  /** The bolt11 payment request. */
  paymentRequest: z.string(),
  /** The description of the transaction. */
  description: z.string().optional(),
  /** The fee charged by the mint to deposit money into the account. */
  mintingFee: z.instanceof(Money).optional(),
});

export type CashuLightningReceiveTransactionDetails = z.infer<
  typeof CashuLightningReceiveTransactionDetailsSchema
>;

/**
 * Schema for Spark lightning receive transaction.
 */
export const SparkLightningReceiveTransactionDetailsSchema = z.object({
  /**
   * The amount of the bolt11 payment request.
   * This amount is added to the account.
   */
  amountReceived: z.instanceof(Money),
  /** The bolt11 payment request. */
  paymentRequest: z.string(),
  /** The description of the transaction. */
  description: z.string().optional(),
});

export type SparkLightningReceiveTransactionDetails = z.infer<
  typeof SparkLightningReceiveTransactionDetailsSchema
>;

/**
 * Schema for completed Spark lightning receive transaction.
 */
export const CompletedSparkLightningReceiveTransactionDetailsSchema =
  SparkLightningReceiveTransactionDetailsSchema.extend({
    /** The payment preimage of the lightning payment. */
    paymentPreimage: z.string(),
    /** The ID of the transfer in Spark system. */
    sparkTransferId: z.string(),
  });

export type CompletedSparkLightningReceiveTransactionDetails = z.infer<
  typeof CompletedSparkLightningReceiveTransactionDetailsSchema
>;

/**
 * Schema for a Spark lightning send transaction that is not yet completed.
 */
export const IncompleteSparkLightningSendTransactionDetailsSchema = z.object({
  /**
   * Amount that the receiver will receive.
   *
   * This is the invoice amount in the currency of the account we are sending from.
   */
  amountToReceive: z.instanceof(Money),
  /**
   * The estimated fee for the Lightning Network payment.
   *
   * If the actual fee ends up being different than this estimate,
   * the completed transaction will reflect the actual fee paid.
   */
  estimatedFee: z.instanceof(Money),
  /** The bolt11 payment request. */
  paymentRequest: z.string(),
  /**
   * This is the sum of `amountToReceive` and `fee`. This is the amount deducted from the account.
   * Available after the payment is initiated.
   */
  amountSpent: z.instanceof(Money).optional(),
  /**
   * The ID of the send request in Spark system.
   * Available after the payment is initiated.
   */
  sparkId: z.string().optional(),
  /**
   * The ID of the transfer in Spark system.
   * Available after the payment is initiated.
   */
  sparkTransferId: z.string().optional(),
  /**
   * The actual fee for the Lightning Network payment.
   * Available after the payment is initiated.
   */
  fee: z.instanceof(Money).optional(),
});

export type IncompleteSparkLightningSendTransactionDetails = z.infer<
  typeof IncompleteSparkLightningSendTransactionDetailsSchema
>;

/**
 * Schema for a Spark lightning send transaction that is completed.
 */
export const CompletedSparkLightningSendTransactionDetailsSchema =
  IncompleteSparkLightningSendTransactionDetailsSchema.required().extend({
    /** The preimage of the lightning payment. */
    paymentPreimage: z.string(),
  });

export type CompletedSparkLightningSendTransactionDetails = z.infer<
  typeof CompletedSparkLightningSendTransactionDetailsSchema
>;

/**
 * Base schema for all transaction types.
 */
const BaseTransactionSchema = z.object({
  /** ID of the transaction. */
  id: z.string(),
  /** ID of the user that the transaction belongs to. */
  userId: z.string(),
  /** Direction of the transaction. */
  direction: z.enum(['SEND', 'RECEIVE']),
  /** Type of the transaction. */
  type: z.enum(['CASHU_LIGHTNING', 'CASHU_TOKEN', 'SPARK_LIGHTNING']),
  /**
   * State of the transaction.
   * Transaction states are:
   * - DRAFT: The transaction is drafted but might never be initiated and thus completed.
   * - PENDING: The transaction was initiated and is being processed.
   * - COMPLETED: The transaction has been completed. At this point the sender cannot reverse the transaction.
   * - FAILED: The transaction has failed.
   * - REVERSED: The transaction was reversed and money was returned to the account.
   */
  state: z.enum(['DRAFT', 'PENDING', 'COMPLETED', 'FAILED', 'REVERSED']),
  /**
   * ID of the account that the transaction was sent from or received to.
   * For SEND transactions, it is the account that the transaction was sent from.
   * For RECEIVE transactions, it is the account that the transaction was received to.
   */
  accountId: z.string(),
  /** Amount of the transaction. */
  amount: z.instanceof(Money),
  /** Transaction details. */
  details: z.object({}),
  /** ID of the transaction that is reversed by this transaction. */
  reversedTransactionId: z.string().nullish(),
  /**
   * Whether or not the transaction has been acknowledged by the user.
   *
   * - `null`: There is nothing to acknowledge.
   * - `pending`: The transaction has entered a state where the user should acknowledge it.
   * - `acknowledged`: The transaction has been acknowledged by the user.
   */
  acknowledgmentStatus: z.enum(['pending', 'acknowledged']).nullable(),
  /** Date and time the transaction was created in ISO 8601 format. */
  createdAt: z.string(),
  /** Date and time the transaction was set to pending in ISO 8601 format. */
  pendingAt: z.string().nullish(),
  /** Date and time the transaction was completed in ISO 8601 format. */
  completedAt: z.string().nullish(),
  /** Date and time the transaction failed in ISO 8601 format. */
  failedAt: z.string().nullish(),
  /** Date and time the transaction was reversed in ISO 8601 format. */
  reversedAt: z.string().nullish(),
});

// Cashu Token Send Transaction
const CashuTokenSendTransactionSchema = BaseTransactionSchema.extend({
  type: z.literal('CASHU_TOKEN'),
  direction: z.literal('SEND'),
  details: CashuTokenSendTransactionDetailsSchema,
});

// Cashu Token Receive Transaction
const CashuTokenReceiveTransactionSchema = BaseTransactionSchema.extend({
  type: z.literal('CASHU_TOKEN'),
  direction: z.literal('RECEIVE'),
  details: CashuTokenReceiveTransactionDetailsSchema,
});

// Cashu Lightning Send Pending/Failed Transaction
const CashuLightningSendPendingTransactionSchema = BaseTransactionSchema.extend(
  {
    type: z.literal('CASHU_LIGHTNING'),
    direction: z.literal('SEND'),
    state: z.enum(['PENDING', 'FAILED']),
    details: IncompleteCashuLightningSendTransactionDetailsSchema,
  },
);

// Cashu Lightning Send Completed Transaction
const CashuLightningSendCompletedTransactionSchema =
  BaseTransactionSchema.extend({
    type: z.literal('CASHU_LIGHTNING'),
    direction: z.literal('SEND'),
    state: z.literal('COMPLETED'),
    details: CompletedCashuLightningSendTransactionDetailsSchema,
  });

// Cashu Lightning Receive Transaction
const CashuLightningReceiveTransactionSchema = BaseTransactionSchema.extend({
  type: z.literal('CASHU_LIGHTNING'),
  direction: z.literal('RECEIVE'),
  details: CashuLightningReceiveTransactionDetailsSchema,
});

// Spark Lightning Receive Incomplete Transaction
const SparkLightningReceiveIncompleteTransactionSchema =
  BaseTransactionSchema.extend({
    type: z.literal('SPARK_LIGHTNING'),
    direction: z.literal('RECEIVE'),
    state: z.enum(['DRAFT', 'PENDING', 'FAILED']),
    details: SparkLightningReceiveTransactionDetailsSchema,
  });

// Spark Lightning Receive Completed Transaction
const SparkLightningReceiveCompletedTransactionSchema =
  BaseTransactionSchema.extend({
    type: z.literal('SPARK_LIGHTNING'),
    direction: z.literal('RECEIVE'),
    state: z.literal('COMPLETED'),
    details: CompletedSparkLightningReceiveTransactionDetailsSchema,
  });

// Spark Lightning Send Pending/Failed Transaction
const SparkLightningSendPendingTransactionSchema = BaseTransactionSchema.extend(
  {
    type: z.literal('SPARK_LIGHTNING'),
    direction: z.literal('SEND'),
    state: z.enum(['PENDING', 'FAILED']),
    details: IncompleteSparkLightningSendTransactionDetailsSchema,
  },
);

// Spark Lightning Send Completed Transaction
const SparkLightningSendCompletedTransactionSchema =
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
  CashuLightningSendPendingTransactionSchema,
  CashuLightningSendCompletedTransactionSchema,
  CashuLightningReceiveTransactionSchema,
  SparkLightningReceiveIncompleteTransactionSchema,
  SparkLightningReceiveCompletedTransactionSchema,
  SparkLightningSendPendingTransactionSchema,
  SparkLightningSendCompletedTransactionSchema,
]);

export type Transaction = z.infer<typeof TransactionSchema>;
