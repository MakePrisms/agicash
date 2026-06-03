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

export type TransferLeg =
  | { account: CashuAccount; fee: Money }
  | { account: SparkAccount; fee: Money };

export type TransferQuote = {
  amount: Money;
  amountToReceive: Money;
  totalFees: Money;
  totalCost: Money;
  receive: TransferLeg;
  send: TransferLeg;
};

export type TransferResult = {
  transferId: string;
  receiveTransactionId: string;
  sendTransactionId: string;
};
