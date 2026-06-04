// Spark domain types — master verbatim
// send/spark-send-quote.ts, receive/spark-receive-quote.ts

import type { CashuTokenMeltData } from './cashu';
import type { Money } from './money';

// ---- SparkSendQuote — states: UNPAID/PENDING/COMPLETED/FAILED ----

type SparkSendQuoteBase = {
  id: string;
  userId: string;
  accountId: string;
  transactionId: string;
  amount: Money;
  estimatedFee: Money;
  paymentRequest: string;
  paymentHash: string;
  paymentRequestIsAmountless: boolean;
  createdAt: string; // ISO 8601
  expiresAt?: string | null; // ISO 8601; nullish
  version: number;
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

// ---- SparkReceiveQuote ----
// Two orthogonal discriminators: type (LIGHTNING | CASHU_TOKEN) ∧ state

type SparkReceiveQuoteBase = {
  id: string;
  sparkId: string;
  userId: string;
  accountId: string;
  transactionId: string;
  amount: Money;
  paymentRequest: string;
  paymentHash: string;
  description?: string;
  receiverIdentityPubkey?: string;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
  totalFee: Money;
  version: number;
};

export type SparkReceiveQuote = SparkReceiveQuoteBase &
  (
    | { type: 'LIGHTNING' }
    | { type: 'CASHU_TOKEN'; tokenReceiveData: CashuTokenMeltData }
  ) &
  (
    | { state: 'UNPAID' | 'EXPIRED' }
    | { state: 'PAID'; paymentPreimage: string; sparkTransferId: string }
    | { state: 'FAILED'; failureReason: string }
  );
