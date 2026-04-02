export {
  TransactionRepository,
  type Cursor,
} from '@agicash/sdk/features/transactions/transaction-repository';

import { useWalletClient } from '../wallet/wallet-client';

export function useTransactionRepository() {
  const { transactionRepo } = useWalletClient().repos;
  return transactionRepo;
}
