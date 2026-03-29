import { z } from 'zod';
import {
  CashuLightningReceiveDbDataSchema,
  CashuSwapReceiveDbDataSchema,
  SparkLightningReceiveDbDataSchema,
} from '../../../db/json-models';
import { Money } from '../../../lib/money';
import { TransactionStateSchema } from '../transaction-enums';
import type { TransactionDetailsParserShape } from './transaction-details-types';

/**
 * Schema for cashu token receive transaction that is not yet completed.
 */
export const CashuTokenReceiveTransactionDetailsSchema = z.object({
  /**
   * The amount of the token being claimed.
   */
  tokenAmount: z.instanceof(Money),
  /**
   * The URL of the mint that issued the token.
   */
  tokenMintUrl: z.string(),
  /**
   * The description of the transaction.
   */
  description: z.string().optional(),
  /**
   * Amount credited to the account.
   * This is the `tokenAmount` minus `totalFee`.
   */
  amount: z.instanceof(Money),
  /**
   * The cashu fee for the receive.
   * When receiving to the same mint as the one that issued the token, this is the fee for the swap inputs.
   * When receiving to a different mint or to Spark, this is the fee for the melt inputs.
   */
  cashuReceiveFee: z.instanceof(Money),
  /**
   * The fee that the destination mint charged to mint the ecash.
   * This is defined only when the token is received to cashu account with mint different than the one that issued the token being received,
   * but only if the destination mint has a minting fee.
   * In this case the receiving account creates a mint quote, and then the ln invoice of the mint quote is paid by melting the token proofs.
   */
  mintingFee: z.instanceof(Money).optional(),
  /**
   * The fee reserved for the lightning payment.
   * This is defined when receving the token to spark account or cashu account with mint different than the one that issued the token being
   * received.
   */
  lightningFeeReserve: z.instanceof(Money).optional(),
  /**
   * The total fee for the transaction.
   * This is the sum of `cashuReceiveFee`, `lightningFeeReserve`, and `mintingFee`.
   * We are currently not returning the change to the user for cashu token receives over lightning which is why `lightningFeeReserve` is calculated
   * as the fee instead of the actual lightning fee for the melt.
   */
  totalFee: z.instanceof(Money),
});

export type CashuTokenReceiveTransactionDetails = z.infer<
  typeof CashuTokenReceiveTransactionDetailsSchema
>;

/**
 * CASHU_TOKEN receive can be done in three different ways:
 * 1. Cashu swap receive - the token is received to the same mint as the one that issued the token.
 * 2. Cashu lightning receive - the token is received to a different mint than the one that issued the token.
 * 3. Spark lightning receive - the token is received to a Spark account.
 *
 * For 1, decryptedTransactionDetails will be of type CashuSwapReceiveDbDataSchema.
 * For 2, decryptedTransactionDetails will be of type CashuLightningReceiveDbDataSchema (with cashuTokenData defined).
 * For 3, decryptedTransactionDetails will be of type SparkLightningReceiveDbDataSchema (with cashuTokenData defined).
 *
 * Thus CashuTokenReceiveTransactionDetailsParser will be a union of three parsers, one for each of the three cases.
 */

const CashuSwapReceiveParser = z
  .object({
    type: z.literal('CASHU_TOKEN'),
    direction: z.literal('RECEIVE'),
    state: TransactionStateSchema,
    decryptedTransactionDetails: CashuSwapReceiveDbDataSchema,
  })
  .transform(
    ({ decryptedTransactionDetails }): CashuTokenReceiveTransactionDetails => ({
      tokenAmount: decryptedTransactionDetails.tokenAmount,
      tokenMintUrl: decryptedTransactionDetails.tokenMintUrl,
      description: decryptedTransactionDetails.tokenDescription,
      amount: decryptedTransactionDetails.amountReceived,
      cashuReceiveFee: decryptedTransactionDetails.cashuReceiveFee,
      totalFee: decryptedTransactionDetails.cashuReceiveFee,
    }),
  ) satisfies TransactionDetailsParserShape;

const CashuLightningReceiveParser: TransactionDetailsParserShape = z
  .object({
    type: z.literal('CASHU_TOKEN'),
    direction: z.literal('RECEIVE'),
    state: TransactionStateSchema,
    decryptedTransactionDetails: CashuLightningReceiveDbDataSchema.required({
      cashuTokenMeltData: true,
    }),
  })
  .transform(
    ({ decryptedTransactionDetails }): CashuTokenReceiveTransactionDetails => ({
      tokenAmount: decryptedTransactionDetails.cashuTokenMeltData.tokenAmount,
      tokenMintUrl: decryptedTransactionDetails.cashuTokenMeltData.tokenMintUrl,
      description: decryptedTransactionDetails.description,
      amount: decryptedTransactionDetails.amountReceived,
      cashuReceiveFee:
        decryptedTransactionDetails.cashuTokenMeltData.cashuReceiveFee,
      mintingFee: decryptedTransactionDetails.mintingFee,
      lightningFeeReserve:
        decryptedTransactionDetails.cashuTokenMeltData.lightningFeeReserve,
      totalFee: decryptedTransactionDetails.totalFee,
    }),
  ) satisfies TransactionDetailsParserShape;

const SparkLightningReceiveParser = z
  .object({
    type: z.literal('CASHU_TOKEN'),
    direction: z.literal('RECEIVE'),
    state: TransactionStateSchema,
    decryptedTransactionDetails: SparkLightningReceiveDbDataSchema.required({
      cashuTokenMeltData: true,
    }),
  })
  .transform(
    ({ decryptedTransactionDetails }): CashuTokenReceiveTransactionDetails => ({
      tokenAmount: decryptedTransactionDetails.cashuTokenMeltData.tokenAmount,
      tokenMintUrl: decryptedTransactionDetails.cashuTokenMeltData.tokenMintUrl,
      description: decryptedTransactionDetails.description,
      amount: decryptedTransactionDetails.amountReceived,
      cashuReceiveFee:
        decryptedTransactionDetails.cashuTokenMeltData.cashuReceiveFee,
      lightningFeeReserve:
        decryptedTransactionDetails.cashuTokenMeltData.lightningFeeReserve,
      totalFee: decryptedTransactionDetails.totalFee,
    }),
  ) satisfies TransactionDetailsParserShape;

export const CashuTokenReceiveTransactionDetailsParser = z.union([
  CashuSwapReceiveParser,
  CashuLightningReceiveParser,
  SparkLightningReceiveParser,
]) satisfies TransactionDetailsParserShape;
