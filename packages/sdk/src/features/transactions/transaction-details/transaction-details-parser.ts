import { z } from 'zod';
import { CashuLightningReceiveTransactionDetailsParser } from './cashu-lightning-receive-transaction-details';
import { CashuLightningSendTransactionDetailsParser } from './cashu-lightning-send-transaction-details';
import { CashuTokenReceiveTransactionDetailsParser } from './cashu-token-receive-transaction-details';
import { CashuTokenSendTransactionDetailsParser } from './cashu-token-send-transaction-details';
import { SparkLightningReceiveTransactionDetailsParser } from './spark-lightning-receive-transaction-details';
import { SparkLightningSendTransactionDetailsParser } from './spark-lightning-send-transaction-details';
import type { TransactionDetailsParserShape } from './transaction-details-types';

export const TransactionDetailsParser: TransactionDetailsParserShape = z.union([
  CashuLightningReceiveTransactionDetailsParser,
  CashuLightningSendTransactionDetailsParser,
  CashuTokenReceiveTransactionDetailsParser,
  CashuTokenSendTransactionDetailsParser,
  SparkLightningReceiveTransactionDetailsParser,
  SparkLightningSendTransactionDetailsParser,
]);
