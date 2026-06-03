/**
 * Transfer domain types — §9 of the contract (cross-account, cashu<->spark via LN).
 *
 * Shapes per the contract. `TransferQuote` is ephemeral (not persisted); the
 * paired send+receive quotes persist, linked by `transferId`.
 *
 * NOTE: the contract's `TransferLeg` ({ account; fee }) is a deliberately slimmer
 * public shape than master's internal `TransferReceiveSide`/`TransferSendSide`
 * (which also carry the live `lightningQuote`). PR1 follows the contract's public
 * shape; the internal sides stay SDK-internal (Slice 4).
 */
import type { CashuAccount, SparkAccount } from './account';
import type { Money } from './money';

/**
 * One side (source or destination) of a transfer: the account involved and the
 * fee charged on that leg. A deliberately slimmer public shape than master's
 * internal `TransferSendSide`/`TransferReceiveSide` (which also carry the live
 * lightning quote).
 */
export type TransferLeg =
  | { account: CashuAccount; fee: Money }
  | { account: SparkAccount; fee: Money };

/**
 * An ephemeral cost preview for a cross-account transfer (cashu↔spark via
 * Lightning), produced by {@link TransfersDomain.createQuote}. Not persisted —
 * the underlying paired send+receive quotes persist, linked by `transferId`.
 */
export type TransferQuote = {
  /** The amount the user asked to transfer. */
  amount: Money;
  /** What the destination account will actually receive after fees. */
  amountToReceive: Money;
  /** Sum of both legs' fees. */
  totalFees: Money;
  /** Total debited from the source: `amountToReceive` + `totalFees`. */
  totalCost: Money;
  /** The destination leg (account credited + its fee). */
  receive: TransferLeg;
  /** The source leg (account debited + its fee). */
  send: TransferLeg;
};

/**
 * The outcome of {@link TransfersDomain.executeQuote}. A transfer is TWO
 * transactions — a debit and a credit — linked by `transferId`; this returns the
 * ids of both plus the shared link.
 */
export type TransferResult = {
  /** Links the paired send + receive transactions. */
  transferId: string;
  /** UUID of the credit (receive) transaction. */
  receiveTransactionId: string;
  /** UUID of the debit (send) transaction. */
  sendTransactionId: string;
};
