import type { Sdk } from '@agicash/wallet-sdk';
import * as Sentry from '@sentry/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAccountsCache } from '~/features/accounts/account-hooks';
import { useContactsCache } from '~/features/contacts/contact-hooks';
import { featureFlagsQueryOptions } from '~/features/shared/feature-flags';
import { getSdk } from '~/features/shared/sdk';
import { useSdk } from '~/features/shared/use-sdk';
import { useTransactionsCache } from '~/features/transactions/transaction-hooks';
import { authStateQueryKey } from '~/features/user/auth';
import { useUserCache } from '~/features/user/user-hooks';
import { useToast } from '~/hooks/use-toast';

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
  const { toast } = useToast();

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

        // auth events (the SDK now owns the auth state machine + expiry timer)
        on('auth:signed-in', () => {
          queryClient.invalidateQueries({
            queryKey: [authStateQueryKey],
            refetchType: 'all',
          });
          queryClient.invalidateQueries({
            queryKey: featureFlagsQueryOptions.queryKey,
            refetchType: 'all',
          });
        }),
        on('auth:signed-out', () => {
          queryClient.clear();
          Sentry.setUser(null);
        }),
        on('auth:session-expired', () => {
          // Terminal full-account expiry only — guests self-heal silently in the
          // SDK and never emit this. The bridge runs on every tab (not leader-gated,
          // D13-8), so each tab toasts + calls signOut; both are idempotent and this
          // only fires on involuntary expiry, so N is acceptable (no single-owner gate).
          toast({
            title: 'Session expired',
            description:
              'Your session has expired. You will be redirected to the login page.',
          });
          void getSdk(new URL(window.location.origin).host).then((sdk) =>
            sdk.auth.signOut(),
          );
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
    toast,
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
