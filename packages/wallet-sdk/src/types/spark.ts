/**
 * Spark quote domain types — §6 of the contract.
 *
 * Lifted verbatim (as the zod/mini `z.infer` shapes) from:
 *   - `app/features/send/spark-send-quote.ts`      (SparkSendQuote)
 *   - `app/features/receive/spark-receive-quote.ts` (SparkReceiveQuote)
 */
import type { Money } from './money';
import type { CashuTokenMeltData } from './cashu';

// ---------------------------------------------------------------------------
// Spark send — SparkSendQuote (UNPAID/PENDING/COMPLETED/FAILED)
// ---------------------------------------------------------------------------

type SparkSendQuoteBase = {
  id: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601; nullish */
  expiresAt?: string | null;
  amount: Money;
  estimatedFee: Money;
  paymentRequest: string;
  paymentHash: string;
  transactionId: string;
  userId: string;
  accountId: string;
  version: number;
  /** When true, `amount` holds the user-specified amount. */
  paymentRequestIsAmountless: boolean;
};

export type SparkSendQuote = SparkSendQuoteBase &
  (
    | { state: 'UNPAID' }
    | { state: 'PENDING'; sparkId: string; sparkTransferId: string; fee: Money }
    | {
        state: 'COMPLETED';
        sparkId: string;
        sparkTransferId: string;
        fee: Money;
        paymentPreimage: string;
      }
    | {
        state: 'FAILED';
        failureReason: string;
        sparkId?: string;
        sparkTransferId?: string;
        fee?: Money;
      }
  );

// ---------------------------------------------------------------------------
// Spark receive — SparkReceiveQuote (type LIGHTNING|CASHU_TOKEN ∧ state)
// ---------------------------------------------------------------------------

type SparkReceiveQuoteBase = {
  id: string;
  sparkId: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  expiresAt: string;
  amount: Money;
  description?: string;
  paymentRequest: string;
  paymentHash: string;
  receiverIdentityPubkey?: string;
  transactionId: string;
  userId: string;
  accountId: string;
  totalFee: Money;
  version: number;
};

export type SparkReceiveQuote = SparkReceiveQuoteBase &
  ({ type: 'LIGHTNING' } | { type: 'CASHU_TOKEN'; tokenReceiveData: CashuTokenMeltData }) &
  (
    | { state: 'UNPAID' | 'EXPIRED' }
    | { state: 'PAID'; paymentPreimage: string; sparkTransferId: string }
    | { state: 'FAILED'; failureReason: string }
  );
