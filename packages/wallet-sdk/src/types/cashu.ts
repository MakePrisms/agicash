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
import type { CashuProof } from './account';

// ---------------------------------------------------------------------------
// DestinationDetails (discriminated on `sendType`)
// ---------------------------------------------------------------------------

export type DestinationDetails =
  | { sendType: 'AGICASH_CONTACT'; contactId: string }
  | { sendType: 'LN_ADDRESS'; lnAddress: string };

// ---------------------------------------------------------------------------
// Lightning send — CashuSendQuote (UNPAID/PENDING/EXPIRED/FAILED/PAID)
// ---------------------------------------------------------------------------

type CashuSendQuoteBase = {
  id: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  expiresAt: string;
  userId: string;
  accountId: string;
  paymentRequest: string;
  paymentHash: string;
  amountRequested: Money;
  amountRequestedInMsat: number;
  amountReceived: Money;
  lightningFeeReserve: Money;
  cashuFee: Money;
  /** ID of the melt quote. */
  quoteId: string;
  proofs: CashuProof[];
  amountReserved: Money;
  /** undefined when paying a bolt11 directly. */
  destinationDetails?: DestinationDetails;
  keysetId: string;
  keysetCounter: number;
  numberOfChangeOutputs: number;
  transactionId: string;
  version: number;
};

export type CashuSendQuote = CashuSendQuoteBase &
  (
    | { state: 'UNPAID' }
    | { state: 'PENDING' }
    | { state: 'EXPIRED' }
    | { state: 'FAILED'; failureReason: string }
    | {
        state: 'PAID';
        paymentPreimage: string;
        lightningFee: Money;
        amountSpent: Money;
        totalFee: Money;
      }
  );

// ---------------------------------------------------------------------------
// Token send — CashuSendSwap (DRAFT/PENDING/COMPLETED/FAILED/REVERSED)
// ---------------------------------------------------------------------------

type CashuSendSwapBase = {
  id: string;
  accountId: string;
  userId: string;
  /** Proofs from the account to be spent (reserved, removed from balance). */
  inputProofs: CashuProof[];
  /** Defined only when a swap is needed to get the exact proofs to send. */
  keysetId?: string;
  keysetCounter?: number;
  outputAmounts?: { send: number[]; change: number[] };
  inputAmount: Money;
  amountReceived: Money;
  cashuReceiveFee: Money;
  amountToSend: Money;
  cashuSendFee: Money;
  amountSpent: Money;
  totalFee: Money;
  transactionId: string;
  /** <- Date, not ISO string (master verbatim: `z.date()`). */
  createdAt: Date;
  version: number;
};

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
        tokenHash: string;
        proofsToSend: CashuProof[];
      }
    | { state: 'FAILED'; failureReason: string }
    | { state: 'REVERSED' }
  );

export type PendingCashuSendSwap = CashuSendSwap & { state: 'PENDING' };

// ---------------------------------------------------------------------------
// Cashu token melt data (shared by both CASHU_TOKEN receive variants)
// receive/cashu-token-melt-data.ts — lifted verbatim (full master shape)
// ---------------------------------------------------------------------------

export type CashuTokenMeltData = {
  sourceMintUrl: string;
  tokenAmount: Money;
  /**
   * The source-token proofs to be melted.
   * Master: `z.array(ProofSchema)` (@cashu/cashu-ts `Proof[]`); `CashuProtocolProof`
   * is a PR1 placeholder element type (see ./dependencies) — re-typed in Slice 2/3.
   */
  tokenProofs: CashuProtocolProof[];
  meltQuoteId: string;
  /** Whether the melt has been initiated on the source mint. */
  meltInitiated: boolean;
  cashuReceiveFee: Money;
  lightningFeeReserve: Money;
  /** Available only when the melt is completed. */
  lightningFee?: Money;
};

// ---------------------------------------------------------------------------
// Cashu receive — CashuReceiveQuote (type LIGHTNING|CASHU_TOKEN ∧ state)
// ---------------------------------------------------------------------------

type CashuReceiveQuoteBase = {
  id: string;
  userId: string;
  accountId: string;
  /** ID of the mint quote. */
  quoteId: string;
  /** Amount credited to the account. */
  amount: Money;
  description?: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  expiresAt: string;
  paymentRequest: string;
  paymentHash: string;
  /** BIP32 path for quote locking/signing. */
  lockingDerivationPath: string;
  transactionId: string;
  mintingFee?: Money;
  totalFee: Money;
  version: number;
};

export type CashuReceiveQuote = CashuReceiveQuoteBase &
  (
    | { type: 'LIGHTNING' }
    | { type: 'CASHU_TOKEN'; tokenReceiveData: CashuTokenMeltData }
  ) &
  (
    | { state: 'UNPAID' | 'EXPIRED' }
    | {
        state: 'PAID' | 'COMPLETED';
        keysetId: string;
        keysetCounter: number;
        outputAmounts: number[];
      }
    | { state: 'FAILED'; failureReason: string }
  );
