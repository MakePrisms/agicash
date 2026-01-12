import { z } from 'zod';
import { Money } from '~/lib/money';
import { CashuTokenMeltDataSchema } from './cashu-token-melt-data';

const CashuReceiveQuoteBaseSchema = z.object({
  /**
   * UUID of the quote.
   */
  id: z.string(),
  /**
   * UUID of the user that the quote belongs to.
   */
  userId: z.string(),
  /**
   * UUID of the Agicash account that the quote belongs to.
   */
  accountId: z.string(),
  /**
   * ID of the mint quote.
   * Once the quote is paid, the mint quote id is used to mint the tokens.
   */
  quoteId: z.string(),
  /**
   * Amount of the quote.
   * This is the amount that gets credited to the account.
   */
  amount: z.instanceof(Money),
  /**
   * Description of the receive.
   */
  description: z.string().optional(),
  /**
   * Date and time the receive quote was created in ISO 8601 format.
   */
  createdAt: z.string(),
  /**
   * Date and time the receive quote expires in ISO 8601 format.
   */
  expiresAt: z.string(),
  /**
   * Bolt 11 payment request for the quote.
   */
  paymentRequest: z.string(),
  /**
   * Payment hash of the quote's lightning invoice.
   */
  paymentHash: z.string(),
  /**
   * BIP32 derivation path used for locking and signing the quote.
   * This is the full path used to derive the locking key from the cashu seed.
   * The last index is unhardened so that we can derive public keys without requiring the private key.
   * @example "m/129372'/0'/0'/4321"
   */
  lockingDerivationPath: z.string(),
  /**
   * UUID of the corresponding transaction.
   */
  transactionId: z.string(),
  /**
   * Optional fee that the mint charges to mint ecash.
   * This amount is added to the payment request amount so the amount in the payment request is equal to `amount` plus `mintingFee`.
   * The sender pays the fee. The receiver will receive `amount` worth of ecash, while the mint keeps the `mintingFee`.
   */
  mintingFee: z.instanceof(Money).optional(),
  /**
   * The total fee for the transaction.
   * For receives of type LIGHTNING, this will be zero.
   * For receive of type CASHU_TOKEN, this will be the sum of the `mintingFee` (if it exists), `cashuReceiveFee` and `lightningFeeReserve`.
   * `mintingFee` is included for cashu token receives because the receiver of the token needs to make a lightning payment to the destination
   * mint so it practically becomes a part of the receive fee.
   *
   * For CASHU_TOKEN receives, we are currently not returning the change to the user. If we ever do, the totalFee should be updated
   * to use lightningFee instead of lightningFeeReserve once actual fee is known.
   */
  totalFee: z.instanceof(Money),
  /**
   * Version of the receive quote.
   * Can be used for optimistic locking.
   */
  version: z.number(),
});

const CashuReceiveQuoteLightningTypeSchema = z.object({
  /**
   * Type of the receive.
   * LIGHTNING - The money is received via Lightning.
   */
  type: z.literal('LIGHTNING'),
});

const CashuReceiveQuoteCashuTokenTypeSchema = z.object({
  /**
   * Type of the receive.
   * CASHU_TOKEN - The money is received as cashu token. Those proofs are then used to mint tokens for the receiver's account via Lightning.
   *               Used for cross-account cashu token receives where the receiver chooses to claim a token to an account different from the mint/unit the token originated from, thus requiring a lightning payment.
   */
  type: z.literal('CASHU_TOKEN'),
  /**
   * Data related to cashu token receive.
   */
  tokenReceiveData: CashuTokenMeltDataSchema,
});

const CashuReceiveQuoteUnpaidExpiredStateSchema = z.object({
  /**
   * State of the cashu receive quote.
   */
  state: z.enum(['UNPAID', 'EXPIRED']),
});

const CashuReceiveQuotePaidCompletedStateSchema = z.object({
  /**
   * State of the cashu receive quote.
   */
  state: z.enum(['PAID', 'COMPLETED']),
  /**
   * ID of the keyset used to create the blinded messages.
   */
  keysetId: z.string(),
  /**
   * Counter value for the keyset at the time of quote payment.
   */
  keysetCounter: z.number(),
  /**
   * Amounts for each blinded message created for this receive.
   */
  outputAmounts: z.array(z.number()),
});

const CashuReceiveQuoteFailedStateSchema = z.object({
  /**
   * State of the cashu receive quote.
   */
  state: z.literal('FAILED'),
  /**
   * Reason this quote was failed.
   */
  failureReason: z.string(),
});

/**
 * Schema for cashu receive quote.
 */
export const CashuReceiveQuoteSchema = z.intersection(
  CashuReceiveQuoteBaseSchema,
  z.intersection(
    z.union([
      CashuReceiveQuoteLightningTypeSchema,
      CashuReceiveQuoteCashuTokenTypeSchema,
    ]),
    z.union([
      CashuReceiveQuoteUnpaidExpiredStateSchema,
      CashuReceiveQuotePaidCompletedStateSchema,
      CashuReceiveQuoteFailedStateSchema,
    ]),
  ),
);

export type CashuReceiveQuote = z.infer<typeof CashuReceiveQuoteSchema>;
