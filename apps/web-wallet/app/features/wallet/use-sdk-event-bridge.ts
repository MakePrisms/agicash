import type { Sdk } from '@agicash/wallet-sdk';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAccountsCache } from '~/features/accounts/account-hooks';
import { useContactsCache } from '~/features/contacts/contact-hooks';
import { useSdk } from '~/features/shared/use-sdk';
import { useTransactionsCache } from '~/features/transactions/transaction-hooks';
import { useUserCache } from '~/features/user/user-hooks';

/**
 * The single SDK-events → TanStack-cache bridge (spec §5). Replaces every web
 * realtime change-handler + the per-quote trackers' live updates. Mounted once
 * in `Wallet` (all protected tabs, NOT leader-gated). The SDK owns reactivity;
 * this maps each event to a cache op against the SAME query keys S12 preserved.
 */
export function useSdkEventBridge(): void {
  const sdkPromise = useSdk();
  const queryClient = useQueryClient();
  const accountsCache = useAccountsCache();
  const transactionsCache = useTransactionsCache();
  const contactsCache = useContactsCache();
  const userCache = useUserCache();

  useEffect(() => {
    let teardowns: Array<() => void> = [];
    let disposed = false;

    void sdkPromise.then((sdk: Sdk) => {
      if (disposed) return;
      const on = sdk.events.on.bind(sdk.events);

      teardowns.push(
        on('transaction:created', ({ transaction }) => {
          transactionsCache.upsert(transaction);
          if (transaction.acknowledgmentStatus === 'pending') {
            // Literal mirrors TransactionsCache.UnacknowledgedCountKey
            queryClient.invalidateQueries({
              queryKey: ['unacknowledged-transactions-count'],
            });
          }
        }),
        on('transaction:updated', ({ transaction }) => {
          transactionsCache.upsert(transaction);
          // Always refetch — the count may have changed (e.g. pending → acknowledged)
          // Literal mirrors TransactionsCache.UnacknowledgedCountKey
          queryClient.invalidateQueries({
            queryKey: ['unacknowledged-transactions-count'],
          });
        }),
        on('account:updated', ({ account, op }) => {
          if (
            op === 'balance' &&
            account.type === 'spark' &&
            account.balance !== null
          ) {
            accountsCache.updateSparkAccountBalance({
              accountId: account.id,
              balance: account.balance,
            });
          } else {
            accountsCache.upsert(account);
          }
        }),
        on('user:updated', ({ user }) => userCache.set(user)),
        on('contact:created', ({ contact }) => contactsCache.add(contact)),
        on('contact:deleted', ({ contactId }) =>
          contactsCache.remove(contactId),
        ),

        // per-quote receive trackers: refetch the SAME key S12 reads (sdk.*.receive.get)
        on('receive:completed', ({ quoteId, transactionId, protocol }) => {
          refetchReceiveQuote(queryClient, protocol, quoteId);
          transactionsCache.invalidateTransaction(transactionId);
        }),
        on('receive:expired', ({ quoteId, protocol }) =>
          refetchReceiveQuote(queryClient, protocol, quoteId),
        ),
        on('receive:failed', ({ quoteId, protocol }) =>
          refetchReceiveQuote(queryClient, protocol, quoteId),
        ),

        // cashu send-swap active screen (the only per-quote SEND read): refetch sdk.cashu.send.get
        on('send:pending', ({ quoteId, protocol }) =>
          refetchCashuSendSwapIfPresent(queryClient, protocol, quoteId),
        ),
        on('send:completed', ({ quoteId, protocol }) =>
          refetchCashuSendSwapIfPresent(queryClient, protocol, quoteId),
        ),
        on('send:failed', ({ quoteId, protocol }) =>
          refetchCashuSendSwapIfPresent(queryClient, protocol, quoteId),
        ),

        // catch-up after reconnect (replaces use-track-wallet-changes onConnected 13-cache fan)
        on('realtime:connected', () => {
          // Literals mirror UserCache.Key / AccountsCache.Key / ContactsCache.Key / TransactionsCache.AllTransactionsKey
          queryClient.invalidateQueries({ queryKey: ['user'] });
          queryClient.invalidateQueries({ queryKey: ['accounts'] });
          queryClient.invalidateQueries({ queryKey: ['contacts'] });
          queryClient.invalidateQueries({ queryKey: ['all-transactions'] });
        }),

        // auth events — STUB through S13 (auth stays on OpenSecret, D13-1)
        on('auth:signed-in', () => {
          /* auth-slice */
        }),
        on('auth:signed-out', () => {
          /* auth-slice */
        }),
        on('auth:session-expired', () => {
          /* no SDK producer yet; auth-slice */
        }),
      );
    });

    return () => {
      disposed = true;
      for (const t of teardowns) t();
      teardowns = [];
    };
  }, [
    sdkPromise,
    queryClient,
    accountsCache,
    transactionsCache,
    contactsCache,
    userCache,
  ]);
}

/**
 * Invalidates the per-quote receive query for the given protocol.
 * Keys mirror CashuReceiveQuoteCache.Key='cashu-receive-quote' and
 * SparkReceiveQuoteCache.Key='spark-receive-quote'.
 */
function refetchReceiveQuote(
  queryClient: QueryClient,
  protocol: 'cashu' | 'spark',
  quoteId: string,
): void {
  const key =
    protocol === 'cashu' ? 'cashu-receive-quote' : 'spark-receive-quote';
  queryClient.invalidateQueries({ queryKey: [key, quoteId] });
}

/**
 * Invalidates the cashu send-swap per-quote query when the protocol is 'cashu'.
 * Key mirrors CashuSendSwapCache.Key='cashu-send-swap'.
 * Spark send has no equivalent read so no-op for 'spark'.
 */
function refetchCashuSendSwapIfPresent(
  queryClient: QueryClient,
  protocol: 'cashu' | 'spark',
  quoteId: string,
): void {
  if (protocol === 'cashu') {
    queryClient.invalidateQueries({ queryKey: ['cashu-send-swap', quoteId] });
  }
}
