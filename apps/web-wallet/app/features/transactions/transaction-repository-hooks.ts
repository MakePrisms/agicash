import { TransactionRepository } from '@agicash/wallet-sdk/temporary';
import { agicashDbClient } from '~/features/agicash-db/database.client';
import { useEncryption } from '~/features/shared/encryption-hooks';

export function useTransactionRepository() {
  const encryption = useEncryption();
  return new TransactionRepository(agicashDbClient, encryption);
}
