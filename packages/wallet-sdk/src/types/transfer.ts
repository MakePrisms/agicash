// Transfer domain types

import type { CashuAccount, SparkAccount } from './account';
import type { Money } from './money';

export type TransferLeg =
  | { account: CashuAccount; fee: Money }
  | { account: SparkAccount; fee: Money };

/**
 * Ephemeral cost-preview — not persisted.
 * The paired send+receive quotes persist, linked by transferId.
 */
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
