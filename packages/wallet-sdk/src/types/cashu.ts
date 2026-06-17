import type { CashuProof } from './account';
/**
 * Cashu quote / swap domain types — §5 of the contract.
 *
 * Lifted verbatim (as the zod/mini `z.infer` shapes) from:
 *   - `app/features/send/cashu-send-quote.ts`   (CashuSendQuote + DestinationDetails)
 *   - `app/features/send/cashu-send-swap.ts`     (CashuSendSwap — token send)
 *   - `app/features/receive/cashu-receive-quote.ts` (CashuReceiveQuote)
 *   - `app/features/receive/cashu-token-melt-data.ts` (CashuTokenMeltData)
 *
 * Token-send (`CashuSendSwap`) is structurally distinct from lightning-send
 * (`CashuSendQuote`) per decision 7-ii. NOTE the `CashuSendSwap.createdAt: Date`
 * quirk (master uses `z.date()` there, unlike every ISO-string `createdAt`).
 */
import type { CashuProtocolProof } from './dependencies';
import type { Money } from './money';

// ---------------------------------------------------------------------------
// DestinationDetails (discriminated on `sendType`)
// ---------------------------------------------------------------------------

/**
 * Additional details about where a lightning send is going, discriminated on
 * `sendType`. Undefined on the quote when paying a bolt11 invoice directly.
 */
export type DestinationDetails =
  | {
      sendType: 'AGICASH_CONTACT';
      /** The ID of the Agicash contact receiving the payment. */
      contactId: string;
    }
  | {
      sendType: 'LN_ADDRESS';
      /** The lightning address that the invoice was fetched from. */
      lnAddress: string;
    };

// ---------------------------------------------------------------------------
// Lightning send — CashuSendQuote (UNPAID/PENDING/EXPIRED/FAILED/PAID)
// ---------------------------------------------------------------------------

type CashuSendQuoteBase = {
  /** UUID of the quote. */
  id: string;
  /** Date and time the send was created in ISO 8601 format. */
  createdAt: string;
  /** Date and time the send quote expires in ISO 8601 format. */
  expiresAt: string;
  /** UUID of the user that the quote belongs to. */
  userId: string;
  /** UUID of the Agicash account to send from. */
  accountId: string;
  /** Bolt 11 payment request that is a destination of the send. */
  paymentRequest: string;
  /** Payment hash of the lightning invoice. */
  paymentHash: string;
  /**
   * Amount requested to send.
   * For payment requests that have the amount defined, the amount will match what is defined in the request and will always be in BTC currency.
   * For amountless payment requests, the amount will be the amount defined by the sender (what gets sent to mint in this case is this amount converted to BTC using our exchange rate at the time of quote creation).
   */
  amountRequested: Money;
  /**
   * Amount requested to send converted to milli-satoshis.
   * For amountless payment requests, this is the amount that gets sent to the mint when creating a melt quote.
   * It will be the amount requested converted to milli-satoshis using our exchange rate at the time of quote creation.
   */
  amountRequestedInMsat: number;
  /**
   * Amount that the receiver receives.
   * This is the amount requested in the currency of the account we are sending from.
   * If the currency of the account we are sending from is not BTC, the mint will do the conversion using their exchange rate at the time of quote creation.
   */
  amountReceived: Money;
  /**
   * Fee reserve for the lightning network fee.
   * Currency will be the same as the currency of the account we are sending from.
   * If payment ends up being cheaper than the fee reserve, the difference will be returned as change.
   */
  lightningFeeReserve: Money;
  /**
   * Cashu mint fee for the proofs used.
   * Currency will be the same as the currency of the account we are sending from.
   */
  cashuFee: Money;
  /** ID of the melt quote. */
  quoteId: string;
  /**
   * Cashu proofs to melt.
   * Amounts are denominated in the cashu units (e.g. sats for BTC accounts, cents for USD accounts).
   * Sum of the proof amounts is equal or greater than the amount to send plus the fee reserve. Any overflow will be returned as change.
   */
  proofs: CashuProof[];
  /**
   * The amount reserved for the send.
   * This is the sum of all proofs used as inputs to the cashu melt operation.
   * These proofs are reserved until the send is completed or failed.
   * When the send is completed, the change is returned to the account.
   */
  amountReserved: Money;
  /**
   * Destination details of the send.
   * This will be undefined if the send is directly paying a bolt11.
   */
  destinationDetails?: DestinationDetails;
  /** ID of the keyset used for the send. */
  keysetId: string;
  /** Counter value for the keyset at the time the time of send. */
  keysetCounter: number;
  /** Number of ouputs that will be used for the send change. */
  numberOfChangeOutputs: number;
  /** UUID of the corresponding transaction. */
  transactionId: string;
  /**
   * Version of the send quote.
   * Can be used for optimistic locking.
   */
  version: number;
};

/**
 * A LIGHTNING send quote (`send/cashu-send-quote.ts`). Drives a bolt11 / ln-address
 * payment funded by melting cashu proofs. Structurally distinct from the token-send
 * {@link CashuSendSwap}; carries no `token` field. The `state` union narrows the
 * payment lifecycle UNPAID → PENDING → PAID (or EXPIRED / FAILED) and is the
 * canonical progress signal (no separate result type).
 */
export type CashuSendQuote = CashuSendQuoteBase &
  (
    | { state: 'UNPAID' }
    | { state: 'PENDING' }
    | { state: 'EXPIRED' }
    | {
        state: 'FAILED';
        /** Reason for the failure of the send quote. */
        failureReason: string;
      }
    | {
        state: 'PAID';
        /** Lightning payment preimage. */
        paymentPreimage: string;
        /**
         * Actual Lightning Network fee that was charged.
         * Currency will be the same as the currency of the account we are sending from.
         * This will be undefined until the send is completed.
         */
        lightningFee: Money;
        /**
         * Total amount spent on the lightning payment.
         * This is the amount to send plus the actual fee paid to the lightning network.
         * Currency will be the same as the currency of the account we are sending from.
         */
        amountSpent: Money;
        /**
         * The total fee for the transaction.
         * This is the sum of `lightningFee` and `cashuFee`.
         */
        totalFee: Money;
      }
  );

// ---------------------------------------------------------------------------
// Token send — CashuSendSwap (DRAFT/PENDING/COMPLETED/FAILED/REVERSED)
// ---------------------------------------------------------------------------

type CashuSendSwapBase = {
  /** The UUID of the swap. */
  id: string;
  /** The UUID of the account that the swap belongs to. */
  accountId: string;
  /** The UUID of the user that the swap belongs to. */
  userId: string;
  /**
   * The proofs from the account that will be spent.
   * These are reserved and thus removed from the account's balance.
   */
  inputProofs: CashuProof[];
  /**
   * The keyset id used to generate the output data at the time the swap was created.
   * This will be defined only when the cashu swap is needed to get the exact amount of proofs to send.
   */
  keysetId?: string;
  /**
   * The keyset counter used to generate the output data at the time the swap was created.
   * This will be defined only when the cashu swap is needed to get the exact amount of proofs to send.
   */
  keysetCounter?: number;
  /**
   * The output data used for deterministic outputs when we swap the inputProofs for proofsToSend.
   * This will be defined only when the cashu swap is needed to get the exact amount of proofs to send.
   */
  outputAmounts?: {
    /** The output amounts to use when constructing the send output data. */
    send: number[];
    /** The output amounts to use when constructing the change output data. */
    change: number[];
  };
  /** The sum of the inputProofs. */
  inputAmount: Money;
  /** The amount received by the receiver. */
  amountReceived: Money;
  /** The swap fee that will be incurred when the receiver claims the token. */
  cashuReceiveFee: Money;
  /**
   * Amount that sender needs to create a token for in order for the receiver to receive exactly `amountReceived`.
   * This is `amountReceived` plus `cashuReceiveFee`.
   */
  amountToSend: Money;
  /**
   * The swap fee that will be incurred when swapping the input proofs to get `amountToSend` worth of proofs to send.
   * When the `inputAmount` equals `amountToSend`, no swap is needed and this will be zero.
   */
  cashuSendFee: Money;
  /**
   * The total amount spent.
   * This is the sum of `amountToSend` and `cashuSendFee`.
   */
  amountSpent: Money;
  /**
   * The total fee for the transaction.
   * This is the sum of `cashuSendFee` and `cashuReceiveFee`.
   */
  totalFee: Money;
  /** The UUID of the transaction that the swap belongs to. */
  transactionId: string;
  /**
   * The date the swap was created.
   * NOTE: a `Date`, not an ISO string (master verbatim: `z.date()`).
   */
  createdAt: Date;
  /**
   * Version of the send swap.
   * Can be used for optimistic locking.
   */
  version: number;
};

/**
 * A TOKEN send (`send/cashu-send-swap.ts`). Spends proofs from an account (or
 * swaps them if there is no exact amount with available proofs) and encodes them
 * into a token to share with the receiver.
 *
 * If the source account has exact amount of proofs to send, no swap is needed and
 * the send swap is created in the PENDING state. Otherwise, the swap is done to get
 * the exact amount of proofs to send, so the send swap is created in the DRAFT state.
 *
 * When in the DRAFT state, the proofs from the account that we will use for the
 * swap have been reserved for this send swap. To move the swap to the PENDING state,
 * the inputProofs are swapped for proofsToSend.
 *
 * When PENDING, the proofsToSend exist and we are just waiting for them to be spent.
 * In this state, the transaction can be reversed by swapping the proofsToSend back
 * into the account (see {@link CashuSendOps.reverse}).
 *
 * Once the proofsToSend are spent, the swap is COMPLETED.
 */
export type CashuSendSwap = CashuSendSwapBase &
  (
    | {
        state: 'DRAFT';
        keysetId: string;
        keysetCounter: number;
        outputAmounts: { send: number[]; change: number[] };
      }
    | {
        state: 'PENDING' | 'COMPLETED';
        /** The hash of the token being sent. */
        tokenHash: string;
        /**
         * The proofs that will be sent. If we have the exact proofs to send,
         * then this will be the same as inputProofs and no cashu swap will occur.
         * If the inputProofs sum to more than the amount to send, then this
         * will be the result of swapping the inputProofs for the amount to send.
         */
        proofsToSend: CashuProof[];
      }
    | { state: 'FAILED'; failureReason: string }
    | { state: 'REVERSED' }
  );

/** A {@link CashuSendSwap} narrowed to the PENDING state (reclaimable via reverse). */
export type PendingCashuSendSwap = CashuSendSwap & { state: 'PENDING' };

// ---------------------------------------------------------------------------
// Cashu token melt data (shared by both CASHU_TOKEN receive variants)
// receive/cashu-token-melt-data.ts — lifted verbatim (full master shape)
// ---------------------------------------------------------------------------

/**
 * Data related to cross-account cashu token receives.
 * Cross-account (to a different cashu account or a spark account) cashu token receives
 * always require a melt operation where token proofs are melted to make a lightning payment.
 * Shared by both CASHU_TOKEN receive variants (cashu + spark).
 */
export type CashuTokenMeltData = {
  /** URL of the source mint where the token proofs originate from. */
  sourceMintUrl: string;
  /** The amount of the token melted. */
  tokenAmount: Money;
  /**
   * The proofs from the source cashu token that will be melted.
   * Master: `z.array(ProofSchema)` (@cashu/cashu-ts `Proof[]`); `CashuProtocolProof`
   * is a PR1 placeholder element type (see ./dependencies) — re-typed in Slice 2/3.
   */
  tokenProofs: CashuProtocolProof[];
  /** ID of the melt quote on the source mint. */
  meltQuoteId: string;
  /** Whether the melt has been initiated on the source mint. */
  meltInitiated: boolean;
  /** The fee that is paid for spending the token proofs as inputs to the melt operation. */
  cashuReceiveFee: Money;
  /** The fee reserved for the lightning payment to destination account. */
  lightningFeeReserve: Money;
  /**
   * The actual Lightning Network fee that was charged after the transaction completed.
   * This may be less than the `lightningFeeReserve` if the payment was cheaper than expected.
   * The difference between the `lightningFeeReserve` and the `lightningFee` is a change.
   * For cashu token receives over lightning, we are currently not returning the change to the user.
   * Available only when the melt is completed.
   */
  lightningFee?: Money;
};

// ---------------------------------------------------------------------------
// Same-mint token receive — CashuReceiveSwap (PENDING|COMPLETED|FAILED)
// ---------------------------------------------------------------------------

type CashuReceiveSwapBase = {
  tokenHash: string;
  /**
   * The token's input proofs. `tokenProofs` are the proofs from the
   * received token; `outputAmounts` are the deterministic outputs.
   */
  tokenProofs: CashuProtocolProof[];
  tokenDescription?: string;
  userId: string;
  accountId: string;
  inputAmount: Money;
  amountReceived: Money;
  feeAmount: Money;
  keysetId: string;
  keysetCounter: number;
  outputAmounts: number[];
  transactionId: string;
  createdAt: string;
  version: number;
};

/**
 * A same-mint cashu token claim (receive-swap). Returned by `receiveToken` when
 * the token is claimed to its own mint (no Lightning round-trip). `tokenProofs`
 * are the token's input proofs; `outputAmounts` the deterministic outputs.
 */
export type CashuReceiveSwap = CashuReceiveSwapBase &
  (
    | { state: 'PENDING' | 'COMPLETED' }
    | { state: 'FAILED'; failureReason: string }
  );

// ---------------------------------------------------------------------------
// Cashu receive — CashuReceiveQuote (type LIGHTNING|CASHU_TOKEN ∧ state)
// ---------------------------------------------------------------------------

type CashuReceiveQuoteBase = {
  /** UUID of the quote. */
  id: string;
  /** UUID of the user that the quote belongs to. */
  userId: string;
  /** UUID of the Agicash account that the quote belongs to. */
  accountId: string;
  /**
   * ID of the mint quote.
   * Once the quote is paid, the mint quote id is used to mint the tokens.
   */
  quoteId: string;
  /**
   * Amount of the quote.
   * This is the amount that gets credited to the account.
   */
  amount: Money;
  /** Description of the receive. */
  description?: string;
  /** Date and time the receive quote was created in ISO 8601 format. */
  createdAt: string;
  /** Date and time the receive quote expires in ISO 8601 format. */
  expiresAt: string;
  /** Bolt 11 payment request for the quote. */
  paymentRequest: string;
  /** Payment hash of the quote's lightning invoice. */
  paymentHash: string;
  /**
   * BIP32 derivation path used for locking and signing the quote.
   * This is the full path used to derive the locking key from the cashu seed.
   * The last index is unhardened so that we can derive public keys without requiring the private key.
   * @example "m/129372'/0'/0'/4321"
   */
  lockingDerivationPath: string;
  /** UUID of the corresponding transaction. */
  transactionId: string;
  /**
   * Optional fee that the mint charges to mint ecash.
   * This amount is added to the payment request amount so the amount in the payment request is equal to `amount` plus `mintingFee`.
   * The sender pays the fee. The receiver will receive `amount` worth of ecash, while the mint keeps the `mintingFee`.
   */
  mintingFee?: Money;
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
  totalFee: Money;
  /**
   * Version of the receive quote.
   * Can be used for optimistic locking.
   */
  version: number;
};

/**
 * A cashu receive quote (`receive/cashu-receive-quote.ts`). Two orthogonal
 * discriminators: `type` (LIGHTNING vs CASHU_TOKEN) ∧ `state` (UNPAID/EXPIRED,
 * PAID/COMPLETED, FAILED). A CASHU_TOKEN receive carries the {@link CashuTokenMeltData}
 * needed to melt the source token to a Lightning payment for cross-account claims.
 */
export type CashuReceiveQuote = CashuReceiveQuoteBase &
  (
    | {
        /** The money is received via Lightning. */
        type: 'LIGHTNING';
      }
    | {
        /**
         * The money is received as a cashu token. Those proofs are then used to mint tokens for the receiver's account via Lightning.
         * Used for cross-account cashu token receives where the receiver chooses to claim a token to an account different from the mint/unit the token originated from, thus requiring a lightning payment.
         */
        type: 'CASHU_TOKEN';
        /** Data related to cashu token receive. */
        tokenReceiveData: CashuTokenMeltData;
      }
  ) &
  (
    | { state: 'UNPAID' | 'EXPIRED' }
    | {
        state: 'PAID' | 'COMPLETED';
        /** ID of the keyset used to create the blinded messages. */
        keysetId: string;
        /** Counter value for the keyset at the time of quote payment. */
        keysetCounter: number;
        /** Amounts for each blinded message created for this receive. */
        outputAmounts: number[];
      }
    | {
        state: 'FAILED';
        /** Reason this quote was failed. */
        failureReason: string;
      }
  );
