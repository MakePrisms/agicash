import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getSdk } from '~/lib/sdk';

/**
 * Variant B has no transaction row events. The SDK's core lifecycle events fire
 * once on a terminal transition (on every instance) and carry the transactionId,
 * so we invalidate the kept transaction queries on them. This gives the detail
 * page + list + unacknowledged count terminal-transition liveness without a tx
 * store or row events.
 *
 * The query keys are the literals from `TransactionsCache` in
 * `~/features/transactions/transaction-hooks` (Key / AllTransactionsKey /
 * UnacknowledgedCountKey). BW-T9 exports a key-holder and reconciles this import.
 */
export function useTransactionLifecycleSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const sdk = getSdk();

    const invalidate = (transactionId?: string) => {
      if (transactionId) {
        queryClient.invalidateQueries({
          queryKey: ['transactions', transactionId],
        });
      }
      queryClient.invalidateQueries({ queryKey: ['all-transactions'] });
      queryClient.invalidateQueries({
        queryKey: ['unacknowledged-transactions-count'],
      });
    };

    const offs = [
      sdk.on('send:completed', ({ transactionId }) =>
        invalidate(transactionId),
      ),
      sdk.on('send:failed', ({ transactionId }) => invalidate(transactionId)),
      sdk.on('receive:completed', ({ transactionId }) =>
        invalidate(transactionId),
      ),
      sdk.on('receive:failed', () => invalidate()),
      sdk.on('receive:expired', () => invalidate()),
    ];

    return () => {
      for (const off of offs) {
        off();
      }
    };
  }, [queryClient]);
}
