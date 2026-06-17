import type { Money } from '@agicash/utils/money';
import type { CashuAccount, SparkAccount } from '../accounts/account';
import type { CashuReceiveLightningQuote } from '../receive/cashu-receive-quote-core';
import type { SparkReceiveLightningQuote } from '../receive/spark-receive-quote-core';
import type { CashuLightningQuote } from '../send/cashu-send-quote';
import type { SparkLightningQuote } from '../send/spark-send-quote';

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

export type TransferSendSide =
  | { account: CashuAccount; lightningQuote: CashuLightningQuote }
  | { account: SparkAccount; lightningQuote: SparkLightningQuote };

export type TransferQuote = {
  amount: Money;
  amountToReceive: Money;
  totalFees: Money;
  totalCost: Money;
  receive: TransferReceiveSide;
  send: TransferSendSide;
};
