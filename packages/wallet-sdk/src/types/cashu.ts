// Cashu domain types — master verbatim
// send/cashu-send-quote.ts, send/cashu-send-swap.ts, receive/cashu-receive-quote.ts

import type { Proof } from '@cashu/cashu-ts';
import type { CashuProof } from './account';
import type { Money } from './money';

// ---- DestinationDetails (on lightning send) ----

export type DestinationDetails =
  | { sendType: 'AGICASH_CONTACT'; contactId: string }
  | { sendType: 'LN_ADDRESS'; lnAddress: string };

// ---- CashuSendQuote (lightning send) — states: UNPAID/PENDING/EXPIRED/FAILED/PAID ----

type CashuSendQuoteBase = {
  id: string;
  userId: string;
  accountId: string;
  transactionId: string;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
  paymentRequest: string;
  paymentHash: string;
  amountRequested: Money;
  amountRequestedInMsat: number;
  amountReceived: Money;
  lightningFeeReserve: Money;
  cashuFee: Money;
  quoteId: string; // melt quote id
  proofs: CashuProof[];
  amountReserved: Money;
  destinationDetails?: DestinationDetails; // undefined when paying a bolt11 directly
  keysetId: string;
  keysetCounter: number;
  numberOfChangeOutputs: number;
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

// ---- CashuSendSwap (token send) — states: DRAFT/PENDING/COMPLETED/FAILED/REVERSED ----
// NOTE: createdAt is Date (master z.date()), unlike the ISO string on other types.

type CashuSendSwapBase = {
  id: string;
  accountId: string;
  userId: string;
  transactionId: string;
  inputProofs: CashuProof[]; // reserved from the account
  inputAmount: Money;
  amountReceived: Money;
  amountToSend: Money;
  amountSpent: Money;
  cashuReceiveFee: Money;
  cashuSendFee: Money;
  totalFee: Money;
  // present only when a swap is needed to get exact proofs:
  keysetId?: string;
  keysetCounter?: number;
  outputAmounts?: { send: number[]; change: number[] };
  createdAt: Date; // <- Date, not ISO string (master verbatim)
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

// ---- CashuTokenMeltData (shared by cashu + spark receive token paths) ----

export type CashuTokenMeltData = {
  sourceMintUrl: string;
  tokenAmount: Money;
  /**
   * The proofs from the source cashu token that will be melted. Master:
   * `z.array(ProofSchema)` (`@cashu/cashu-ts` `Proof[]`).
   */
  tokenProofs: Proof[];
  meltQuoteId: string;
  /** Whether the melt has been initiated on the source mint. */
  meltInitiated: boolean;
  cashuReceiveFee: Money;
  lightningFeeReserve: Money;
  lightningFee?: Money;
};

// ---- CashuReceiveQuote ----
// Two orthogonal discriminators: type (LIGHTNING | CASHU_TOKEN) ∧ state

type CashuReceiveQuoteBase = {
  id: string;
  userId: string;
  accountId: string;
  transactionId: string;
  quoteId: string; // mint quote id
  amount: Money; // amount credited to the account
  description?: string;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
  paymentRequest: string;
  paymentHash: string;
  lockingDerivationPath: string; // BIP32 path for quote locking/signing
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

// ---- receiveToken result ----

export type ReceiveTokenResult =
  | { success: true; destinationAccount: { id: string; purpose: string } }
  | { success: false; message: string };
