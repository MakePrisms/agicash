import { z } from 'zod';
import { ProofSchema } from '~/lib/cashu';
import { Money } from '~/lib/money';

/**
 * Schema for data related to cross-account cashu token receives.
 * Present only for TOKEN type quotes.
 */
export const CashuReceiveQuoteTokenReceiveDataSchema = z.object({
  /** URL of the source mint where the token proofs originate from. */
  sourceMintUrl: z.string(),
  /** The amount of the token melted. */
  tokenAmount: z.instanceof(Money),
  /** The proofs from the source cashu token that will be melted. */
  tokenProofs: z.array(ProofSchema),
  /** ID of the melt quote on the source mint. */
  meltQuoteId: z.string(),
  /** Whether the melt has been initiated on the source mint. */
  meltInitiated: z.boolean(),
  /** The fee that is paid for spending the token proofs as inputs to the melt operation. */
  cashuReceiveFee: z.instanceof(Money),
  /** The fee reserved for the lightning payment to melt the token proofs to this account. */
  lightningFeeReserve: z.instanceof(Money),
});

export type CashuReceiveQuoteTokenReceiveData = z.infer<
  typeof CashuReceiveQuoteTokenReceiveDataSchema
>;

const CashuReceiveQuoteBaseSchema = z.object({
  id: z.string(),
  /** ID of the user that the quote belongs to. */
  userId: z.string(),
  /** ID of the Agicash account that the quote belongs to. */
  accountId: z.string(),
  /**
   * ID of the mint quote.
   * Once the quote is paid, the mint quote id is used to mint the tokens.
   */
  quoteId: z.string(),
  /** Amount of the quote. */
  amount: z.instanceof(Money),
  /** Description of the receive quote. */
  description: z.string().optional(),
  /** Date and time the receive quote was created in ISO 8601 format. */
  createdAt: z.string(),
  /** Date and time the receive quote expires in ISO 8601 format. */
  expiresAt: z.string(),
  /** Payment request for the quote. */
  paymentRequest: z.string(),
  /** Payment hash of the quote's lightning invoice. */
  paymentHash: z.string(),
  /**
   * Row version.
   * Used for optimistic locking.
   */
  version: z.number(),
  /**
   * BIP32 derivation path used for locking and signing the quote.
   * This is the full path used to derive the locking key from the cashu seed.
   * The last index is unhardened so that we can derive public keys without requiring the private key.
   * @example "m/129372'/0'/0'/4321"
   */
  lockingDerivationPath: z.string(),
  /** ID of the corresponding transaction. */
  transactionId: z.string(),
  /** Optional fee that the mint charges to mint ecash. This amount is added to the payment request amount. */
  mintingFee: z.instanceof(Money).optional(),
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
  /** Data related to cross-account cashu token receives. */
  tokenReceiveData: CashuReceiveQuoteTokenReceiveDataSchema,
});

const CashuReceiveQuoteUnpaidExpiredStateSchema = z.object({
  /** State of the cashu receive quote. */
  state: z.enum(['UNPAID', 'EXPIRED']),
});

const CashuReceiveQuotePaidCompletedStateSchema = z.object({
  /** State of the cashu receive quote. */
  state: z.enum(['PAID', 'COMPLETED']),
  /** ID of the keyset used to create the blinded messages. */
  keysetId: z.string(),
  /** Counter value for the keyset at the time of quote payment. */
  keysetCounter: z.number(),
  /** Amounts for each blinded message created for this receive. */
  outputAmounts: z.array(z.number()),
});

const CashuReceiveQuoteFailedStateSchema = z.object({
  /** State of the cashu receive quote. */
  state: z.literal('FAILED'),
  /** Reason this quote was failed. */
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
