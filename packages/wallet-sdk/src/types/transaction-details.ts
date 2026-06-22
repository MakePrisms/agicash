import type { DestinationDetails } from './cashu';
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

// --- Cashu token send ------------------------------------------------------
/** Details of a CASHU_TOKEN SEND transaction. */
export type CashuTokenSendTransactionDetails = {
  /**
   * The amount of the token sent.
   * This is the sum of `amountReceived` and `cashuReceiveFee`.
   */
  tokenAmount: Money;
  /** The URL of the mint that issued the token. */
  tokenMintUrl: string;
  /**
   * Amount reserved for the send.
   * This is the sum of the input proofs and is greater or equal to `tokenAmount`.
   * When the source account doesn't have the exact amount of proofs required for `tokenAmount`, the transaction requires
   * a swap, which then also incurs `cashuSendFee`. When this happens this amount is greater than the `amountReceived`
   * plus `totalFee`.
   */
  amountReserved: Money;
  /**
   * Amount debited from the account.
   * When the transaction doesn't require a swap, this will be equal to `amountReserved`.
   * When the transaction requires a swap, this will be equal to `amountReserved` until the swap is completed.
   * After the swap is completed, this will be equal to the amount actually spent (`amountReceived` plus `totalFee`).
   * Change is returned to the source account when the swap is completed.
   */
  amount: Money;
  /**
   * Amount that the recipient receives.
   * This is `amount` minus `totalFee`.
   */
  amountReceived: Money;
  /** The fee that we include in the token for the receiver to claim exactly `amountReceived`. */
  cashuReceiveFee: Money;
  /**
   * The swap fee that will be incurred when swapping the input proofs to get `tokenAmount` worth of proofs to send.
   * When the `amountReserved` equals `tokenAmount`, no swap is needed and this will be zero.
   */
  cashuSendFee: Money;
  /**
   * The total fee for the transaction.
   * This is the sum of `cashuSendFee` and `cashuReceiveFee`.
   */
  totalFee: Money;
};

// --- Cashu token receive ---------------------------------------------------
/** Details of a CASHU_TOKEN RECEIVE transaction. */
export type CashuTokenReceiveTransactionDetails = {
  /** The amount of the token being claimed. */
  tokenAmount: Money;
  /** The URL of the mint that issued the token. */
  tokenMintUrl: string;
  /** The description of the transaction. */
  description?: string;
  /**
   * Amount credited to the account.
   * This is the `tokenAmount` minus `totalFee`.
   */
  amount: Money;
  /**
   * The cashu fee for the receive.
   * When receiving to the same mint as the one that issued the token, this is the fee for the swap inputs.
   * When receiving to a different mint or to Spark, this is the fee for the melt inputs.
   */
  cashuReceiveFee: Money;
  /**
   * The fee that the destination mint charged to mint the ecash.
   * This is defined only when the token is received to cashu account with mint different than the one that issued the token being received,
   * but only if the destination mint has a minting fee.
   * In this case the receiving account creates a mint quote, and then the ln invoice of the mint quote is paid by melting the token proofs.
   */
  mintingFee?: Money;
  /**
   * The fee reserved for the lightning payment.
   * This is defined when receving the token to spark account or cashu account with mint different than the one that issued the token being
   * received.
   */
  lightningFeeReserve?: Money;
  /**
   * The total fee for the transaction.
   * This is the sum of `cashuReceiveFee`, `lightningFeeReserve`, and `mintingFee`.
   * We are currently not returning the change to the user for cashu token receives over lightning which is why `lightningFeeReserve` is calculated
   * as the fee instead of the actual lightning fee for the melt.
   */
  totalFee: Money;
};

// --- Cashu lightning send (Incomplete | Completed) -------------------------
/** Details of a CASHU_LIGHTNING SEND transaction that is not yet completed. */
export type IncompleteCashuLightningSendTransactionDetails = {
  /** The bolt11 payment request the the transaction is paying. */
  paymentRequest: string;
  /** Payment hash of the lightning invoice. */
  paymentHash: string;
  /**
   * Additional details related to the transaction.
   * This will be undefined if the send is directly paying a bolt11.
   */
  destinationDetails?: DestinationDetails;
  /**
   * The amount reserved for the send.
   * This is the sum of all proofs used as inputs to the cashu melt operation.
   * These proofs are reserved until the send is completed or failed.
   * When the send is completed, the change is returned to the account.
   */
  amountReserved: Money;
  /**
   * Amount that the receiver receives.
   * This is the amount requested in the currency of the account we are sending from.
   * If the currency of the account we are sending from is not BTC, the mint will do
   * the conversion using their exchange rate at the time of quote creation.
   */
  amountReceived: Money;
  /**
   * The amount reserved to cover the maximum potential Lightning Network fee.
   * If the actual Lightning fee ends up being lower than this reserve,
   * the difference is returned as change to the user.
   */
  lightningFeeReserve: Money;
  /** The fee incurred to spend the proofs in the cashu melt operation. */
  cashuSendFee: Money;
  /**
   * Estimated total fee for the transaction.
   * This is the sum of `lightningFeeReserve` and `cashuSendFee` and is the max potential fee for the transaction.
   */
  estimatedTotalFee: Money;
  /**
   * The amount debited from the account.
   * When the transaction is not completed, this is equal to `amountReserved`.
   * When the transaction is completed, this is equal to the sum of `amountReceived` and `totalFee`.
   * This is the sum of `amountReceived` and `totalFee`.
   */
  amount: Money;
  /** UUID linking paired send/receive transactions for internal transfers. */
  transferId?: string;
};
/** Details of a completed CASHU_LIGHTNING SEND transaction. */
export type CompletedCashuLightningSendTransactionDetails =
  IncompleteCashuLightningSendTransactionDetails & {
    /**
     * The preimage of the lightning payment.
     * If the lightning payment is settled internally in the mint, this will be an empty string or '0x0000000000000000000000000000000000000000000000000000000000000000'
     */
    preimage: string;
    /**
     * The actual Lightning Network fee that was charged after the transaction completed.
     * This may be less than the `lightningFeeReserve` if the payment was cheaper than expected.
     * The difference between `lightningFeeReserve` and `lightningFee`, along with any overpaid inputs, is returned as change to the user.
     */
    lightningFee: Money;
    /**
     * The total fee for the transaction.
     * This is the sum of `lightningFee` and `cashuSendFee`.
     */
    totalFee: Money;
  };
/** Details of a CASHU_LIGHTNING SEND transaction (incomplete or completed). */
export type CashuLightningSendTransactionDetails =
  | IncompleteCashuLightningSendTransactionDetails
  | CompletedCashuLightningSendTransactionDetails;

// --- Cashu lightning receive ----------------------------------------------
/** Details of a CASHU_LIGHTNING RECEIVE transaction. */
export type CashuLightningReceiveTransactionDetails = {
  /**
   * The bolt11 payment request.
   * If the mint has a minting fee, the amount in the payment request will be a sum of `amount` and `mintingFee`.
   */
  paymentRequest: string;
  /** The payment hash of the lightning invoice. */
  paymentHash: string;
  /** The description of the transaction. */
  description?: string;
  /**
   * Optional fee charged by the mint to deposit money into the account.
   * The payer of the lightning invoice pays this fee.
   */
  mintingFee?: Money;
  /** The amount credited to the account. */
  amount: Money;
  /**
   * The total fee for the receive.
   * In this case it is equal to `mintingFee` or zero if the mint has no minting fee.
   */
  totalFee: Money;
  /** UUID linking paired send/receive transactions for internal transfers. */
  transferId?: string;
};

// --- Spark lightning send (Incomplete | Completed) -------------------------
/** Details of a SPARK_LIGHTNING SEND transaction that is not yet completed. */
export type IncompleteSparkLightningSendTransactionDetails = {
  /**
   * Amount that the receiver receives.
   * This is the invoice amount in the currency of the account we are sending from.
   */
  amountReceived: Money;
  /**
   * The estimated fee for the Lightning Network payment.
   * If the actual fee ends up being different than this estimate, the completed transaction will reflect the actual fee paid.
   */
  estimatedFee: Money;
  /** Bolt 11 payment request. */
  paymentRequest: string;
  /** The payment hash of the lightning invoice. */
  paymentHash: string;
  /**
   * Amount debited from the account.
   * While the transaction is not initiated yet and actual fee is not known, this will be the sum of `amountReceived` and `estimatedFee`.
   * This should be a very brief period of time, since the payment is initiated immediately after the quote is created.
   * When the transaction is initiated, and the actual fee is known, this will be the sum of `amountReceived` and `totalFee`.
   */
  amount: Money;
  /**
   * The actual fee for the transaction.
   * While the transaction is not initiated yet and actual fee is not known, this will be equal to `estimatedFee`.
   * This should be a very brief period of time, since the payment is initiated immediately after the quote is created.
   * Once the transaction is initiated, this will be set to actual fee spent for the transaction.
   */
  fee: Money;
  /**
   * The ID of the send request in Spark system.
   * Available after the payment is initiated.
   */
  sparkId?: string;
  /**
   * The ID of the transfer in Spark system.
   * Available after the payment is initiated.
   */
  sparkTransferId?: string;
  /** UUID linking paired send/receive transactions for internal transfers. */
  transferId?: string;
};
/** Details of a completed SPARK_LIGHTNING SEND transaction. */
export type CompletedSparkLightningSendTransactionDetails = Omit<
  Required<IncompleteSparkLightningSendTransactionDetails>,
  'transferId'
> & {
  /** The preimage of the lightning payment. */
  paymentPreimage: string;
  /** Present only for TRANSFER transactions. */
  transferId?: string;
};
/** Details of a SPARK_LIGHTNING SEND transaction (incomplete or completed). */
export type SparkLightningSendTransactionDetails =
  | IncompleteSparkLightningSendTransactionDetails
  | CompletedSparkLightningSendTransactionDetails;

// --- Spark lightning receive (Incomplete | Completed) ----------------------
/** Details of a SPARK_LIGHTNING RECEIVE transaction that is not yet completed. */
export type IncompleteSparkLightningReceiveTransactionDetails = {
  /** Bolt 11 payment request. */
  paymentRequest: string;
  /** The payment hash of the lightning invoice. */
  paymentHash: string;
  /** The ID of the receive request in Spark system. */
  sparkId: string;
  /** The description of the transaction. */
  description?: string;
  /**
   * Amount credited to the account.
   * This is the amount of the bolt 11 payment request.
   */
  amount: Money;
  /** UUID linking paired send/receive transactions for internal transfers. */
  transferId?: string;
};
/** Details of a completed SPARK_LIGHTNING RECEIVE transaction. */
export type CompletedSparkLightningReceiveTransactionDetails =
  IncompleteSparkLightningReceiveTransactionDetails & {
    /** The payment preimage of the lightning payment. */
    paymentPreimage: string;
    /** The ID of the transfer in Spark system. */
    sparkTransferId: string;
  };
/** Details of a SPARK_LIGHTNING RECEIVE transaction (incomplete or completed). */
export type SparkLightningReceiveTransactionDetails =
  | IncompleteSparkLightningReceiveTransactionDetails
  | CompletedSparkLightningReceiveTransactionDetails;

// --- The domain union ------------------------------------------------------
/**
 * The protocol-specific detail payload carried by a {@link Transaction}, narrowed
 * by the transaction's type/direction/state. The SDK owns and exposes this domain
 * union; the parallel DB-data union and its parsers stay SDK-internal.
 */
export type TransactionDetails =
  | CashuTokenSendTransactionDetails
  | CashuTokenReceiveTransactionDetails
  | CashuLightningSendTransactionDetails
  | CashuLightningReceiveTransactionDetails
  | SparkLightningReceiveTransactionDetails
  | SparkLightningSendTransactionDetails;
