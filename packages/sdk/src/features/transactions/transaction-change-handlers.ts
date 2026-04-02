import type { AgicashDbTransaction } from '../../db/database';
import type { DatabaseChangeHandler } from '../wallet/database-change-handler';
import type { Transaction } from './transaction';
import type { TransactionsCache } from './transaction-queries';
import type { TransactionRepository } from './transaction-repository';

export function createTransactionChangeHandlers(
  transactionRepo: TransactionRepository,
  transactionsCache: TransactionsCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'TRANSACTION_CREATED',
      handleEvent: async (payload) => {
        const transaction = await transactionRepo.toTransaction(
          payload as AgicashDbTransaction,
        );
        transactionsCache.upsert(transaction);
        if (transaction.acknowledgmentStatus === 'pending') {
          transactionsCache.invalidateUnacknowledgedCount();
        }
      },
    },
    {
      event: 'TRANSACTION_UPDATED',
      handleEvent: async (payload) => {
        const typed = payload as AgicashDbTransaction & {
          previous_acknowledgment_status: Transaction['acknowledgmentStatus'];
        };
        const transaction = await transactionRepo.toTransaction(typed);
        transactionsCache.upsert(transaction);
        if (
          typed.previous_acknowledgment_status !==
          transaction.acknowledgmentStatus
        ) {
          transactionsCache.invalidateUnacknowledgedCount();
        }
      },
    },
  ];
}
