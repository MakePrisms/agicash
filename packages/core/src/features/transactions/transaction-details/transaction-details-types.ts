import { z } from 'zod';
import type { Json } from '../../../db/database-generated.types';
import {
  CashuLightningReceiveDbDataSchema,
  CashuLightningSendDbDataSchema,
  CashuSwapReceiveDbDataSchema,
  CashuSwapSendDbDataSchema,
  SparkLightningReceiveDbDataSchema,
  SparkLightningSendDbDataSchema,
} from '../../../db/json-models';
import type {
  TransactionDirection,
  TransactionState,
  TransactionType,
} from '../transaction-enums';
import { CashuLightningReceiveTransactionDetailsSchema } from './cashu-lightning-receive-transaction-details';
import { CashuLightningSendTransactionDetailsSchema } from './cashu-lightning-send-transaction-details';
import { CashuTokenReceiveTransactionDetailsSchema } from './cashu-token-receive-transaction-details';
import { CashuTokenSendTransactionDetailsSchema } from './cashu-token-send-transaction-details';
import { SparkLightningReceiveTransactionDetailsSchema } from './spark-lightning-receive-transaction-details';
import { SparkLightningSendTransactionDetailsSchema } from './spark-lightning-send-transaction-details';

export const TransactionDetailsDbDataSchema = z.union([
  CashuLightningReceiveDbDataSchema,
  CashuLightningSendDbDataSchema,
  CashuSwapReceiveDbDataSchema,
  CashuSwapSendDbDataSchema,
  SparkLightningReceiveDbDataSchema,
  SparkLightningSendDbDataSchema,
]);

export const TransactionDetailsSchema = z.union([
  CashuTokenSendTransactionDetailsSchema,
  CashuTokenReceiveTransactionDetailsSchema,
  CashuLightningSendTransactionDetailsSchema,
  CashuLightningReceiveTransactionDetailsSchema,
  SparkLightningReceiveTransactionDetailsSchema,
  SparkLightningSendTransactionDetailsSchema,
]);

export type TransactionDetails = z.infer<typeof TransactionDetailsSchema>;

export type TransactionDetailsParserInput = {
  type: TransactionType;
  direction: TransactionDirection;
  state: TransactionState;
  transactionDetails?: Json;
  decryptedTransactionDetails: z.input<typeof TransactionDetailsDbDataSchema>;
};

type TransactionDetailsParserOutput = TransactionDetails;

export type TransactionDetailsParserShape = z.ZodType<
  TransactionDetailsParserOutput,
  TransactionDetailsParserInput
>;
