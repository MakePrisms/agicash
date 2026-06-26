import type { Json } from 'supabase/database.types';
import { z } from 'zod/mini';
import { CashuLightningReceiveDbDataSchema } from '../../agicash-db/json-models/cashu-lightning-receive-db-data';
import { CashuLightningSendDbDataSchema } from '../../agicash-db/json-models/cashu-lightning-send-db-data';
import { CashuSwapReceiveDbDataSchema } from '../../agicash-db/json-models/cashu-swap-receive-db-data';
import { CashuSwapSendDbDataSchema } from '../../agicash-db/json-models/cashu-swap-send-db-data';
import { SparkLightningReceiveDbDataSchema } from '../../agicash-db/json-models/spark-lightning-receive-db-data';
import { SparkLightningSendDbDataSchema } from '../../agicash-db/json-models/spark-lightning-send-db-data';
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

export type TransactionDetailsParserShape = z.ZodMiniType<
  TransactionDetailsParserOutput,
  TransactionDetailsParserInput
>;
