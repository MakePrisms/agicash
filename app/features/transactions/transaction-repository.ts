export {
  TransactionRepository,
  type Cursor,
} from '@agicash/sdk/features/transactions/transaction-repository';

import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';
import { TransactionRepository } from '@agicash/sdk/features/transactions/transaction-repository';

export function useTransactionRepository() {
  const encryption = useEncryption();
  return new TransactionRepository(agicashDbClient, encryption);
}
