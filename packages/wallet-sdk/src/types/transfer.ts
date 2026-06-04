/**
 * Transfer domain types — §9 of the contract (cross-account, cashu<->spark via LN).
 *
 * `TransferQuote` is the VERBATIM-FULL master shape (`app/features/transfer/transfer-service.ts`
 * `getTransferQuote`'s return): each leg carries its live per-leg Lightning quote as a VISIBLE,
 * plain-data field. This deliberately DIVERGES from the no-cache PR6's slim cost-preview (which
 * stashed the live legs on a non-enumerable symbol — serialization-fragile). Here the legs are
 * just data: {@link TransfersDomain.executeQuote} reads them DIRECTLY off the full quote (no
 * symbol recovery, no "must be created via createQuote" guard).
 *
 * `TransferQuote` is EPHEMERAL (not persisted). Executing it persists the paired send+receive
 * quotes, linked by a `transferId`; the receive is AUTO-FAILED if the send fails to persist.
 *
 * @module
 */
import type { CashuReceiveLightningQuote } from '../internal/cashu-receive-quote-core';
import type { CashuLightningQuote } from '../internal/cashu-send-quote-service';
import type { SparkReceiveLightningQuote } from '../internal/spark-receive-quote-core';
import type { SparkLightningQuote } from '../internal/spark-send-quote-service';
import type { CashuAccount, SparkAccount } from './account';
import type { Money } from './money';

/**
 * The destination (receive) leg of a {@link TransferQuote}: the account being credited, the fee
 * charged on that leg, and the live Lightning RECEIVE quote (the mint/Breez quote the receive is
 * later persisted from). VERBATIM from master `TransferReceiveSide` — the `lightningQuote` is a
 * VISIBLE field (no symbol).
 */
export type TransferReceiveSide =
  | {
      account: CashuAccount;
      fee: Money;
      lightningQuote: CashuReceiveLightningQuote;
    }
  | {
      account: SparkAccount;
      fee: Money;
      lightningQuote: SparkReceiveLightningQuote;
    };

/**
 * The source (send) leg of a {@link TransferQuote}: the account being debited and the live
 * Lightning SEND quote (the quote the send is later persisted from — its `estimatedTotalFee` is
 * the send-leg fee, so unlike the receive leg there is no separate `fee` field). VERBATIM from
 * master `TransferSendSide` — the `lightningQuote` is a VISIBLE field (no symbol).
 */
export type TransferSendSide =
  | { account: CashuAccount; lightningQuote: CashuLightningQuote }
  | { account: SparkAccount; lightningQuote: SparkLightningQuote };

/**
 * An ephemeral quote for a cross-account transfer (cashu↔spark via Lightning), produced by
 * {@link TransfersDomain.createQuote}. The VERBATIM-FULL master shape: both legs expose their
 * live per-leg Lightning quote as plain data, so {@link TransfersDomain.executeQuote} reads them
 * directly. Not persisted — the underlying paired send+receive quotes persist, linked by a
 * `transferId`.
 */
export type TransferQuote = {
  /** The amount the user asked to transfer. */
  amount: Money;
  /** What the destination account will actually receive after fees. */
  amountToReceive: Money;
  /** Sum of both legs' fees (the send leg's `estimatedTotalFee` + the receive leg's `fee`). */
  totalFees: Money;
  /** Total debited from the source: `amountToReceive` + `totalFees`. */
  totalCost: Money;
  /** The destination leg (account credited + its fee + the live receive Lightning quote). */
  receive: TransferReceiveSide;
  /** The source leg (account debited + the live send Lightning quote). */
  send: TransferSendSide;
};

/**
 * The outcome of {@link TransfersDomain.executeQuote}. A transfer is TWO transactions — a debit
 * and a credit — linked by `transferId`; this returns the ids of both plus the shared link.
 */
export type TransferResult = {
  /** Links the paired send + receive transactions. */
  transferId: string;
  /** UUID of the credit (receive) transaction. */
  receiveTransactionId: string;
  /** UUID of the debit (send) transaction. */
  sendTransactionId: string;
};
